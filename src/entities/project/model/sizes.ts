import type { Draft } from "immer"
import { WIDGETS } from "@/shared/lvgl"
import { walk } from "../lib/tree"
import type { Node, Project, Screen, SizePatch, StyleMap } from "./types"

/**
 * Props a size can have its own of: a node's graphics (images, sprites, their zoom), since a
 * different panel usually wants different art. Text and the other props stay shared.
 */
export const graphicProps = (n: Node) =>
  WIDGETS[n.widget].props
    .filter(p => p.type === "image" || p.type === "sprite" || p.type === "scale")
    .map(p => p.key)

type Patch = Record<string, unknown>

/** `base` with `patch` laid over it; a null in the patch removes that key. */
function patched<T extends object>(base: T, patch: Patch): T {
  const out: Patch = { ...(base as Patch) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else out[k] = v
  }
  return out as T
}

function patchedStyle(style: StyleMap, patch: NonNullable<SizePatch["style"]>): StyleMap {
  const out = { ...style }
  for (const [selector, props] of Object.entries(patch)) {
    const merged = patched(style[selector] ?? {}, props)
    if (Object.keys(merged).length) out[selector] = merged
    else delete out[selector]
  }
  return out
}

/** A node and its subtree at one size; untouched subtrees come back as the same objects. */
function nodeAt(n: Node, sizeId: string): Node {
  const children = n.children.map(c => nodeAt(c, sizeId))
  const p = n.at?.[sizeId]
  const same = children.every((c, i) => c === n.children[i])
  if (!p) return same ? n : { ...n, children }
  return {
    ...n,
    layout: p.layout ? patched(n.layout, p.layout) : n.layout,
    style: p.style ? patchedStyle(n.style, p.style) : n.style,
    hidden: p.hidden ?? n.hidden,
    props: p.props ? patched(n.props, p.props) : n.props,
    children,
  }
}

/** How far canvas positions stretch at a size, so bigger screens don't overlap. */
const stretch = (doc: Project, sizeId: string) => {
  const size = doc.sizes.find(s => s.id === sizeId)!
  return [
    size.target.display.width / doc.target.display.width,
    size.target.display.height / doc.target.display.height,
  ]
}

/**
 * The document as one size sees it: that size's board and display, every node with its patch
 * for the size, and screens filling the display. The base size (null) is the document itself.
 */
export function atSize(doc: Project, sizeId: string | null): Project {
  const size = sizeId ? doc.sizes.find(s => s.id === sizeId) : undefined
  if (!size) return doc
  const { width, height } = size.target.display
  const [fx, fy] = stretch(doc, size.id)
  return {
    ...doc,
    target: size.target,
    screens: doc.screens.map(sc => ({
      ...(nodeAt(sc, size.id) as Screen),
      layout: { ...sc.layout, w: width, h: height },
      frame: { x: Math.round(sc.frame.x * fx), y: Math.round(sc.frame.y * fy) },
    })),
  }
}

/** Fields of `a` that differ from `b`, with null for ones `a` doesn't have. */
function difference(a: object, b: object): Patch | undefined {
  const out: Patch = {}
  const ra = a as Patch
  const rb = b as Patch
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
    if (JSON.stringify(ra[k]) !== JSON.stringify(rb[k])) out[k] = ra[k] === undefined ? null : ra[k]
  return Object.keys(out).length ? out : undefined
}

/** How a node seen at a size differs from its base: the patch to keep for that size. */
function patchFor(n: Node, base: Node, screen: boolean): SizePatch | undefined {
  const patch: SizePatch = {}
  // screens always fill the display, so their size is never a difference
  const layout = screen ? undefined : difference(n.layout, base.layout)
  if (layout) patch.layout = layout as SizePatch["layout"]
  const style: NonNullable<SizePatch["style"]> = {}
  for (const selector of new Set([...Object.keys(n.style), ...Object.keys(base.style)])) {
    const d = difference(n.style[selector] ?? {}, base.style[selector] ?? {})
    if (d) style[selector] = d as Record<string, null>
  }
  if (Object.keys(style).length) patch.style = style
  if (Boolean(n.hidden) !== Boolean(base.hidden)) patch.hidden = Boolean(n.hidden)
  const keys = graphicProps(n)
  const pick = (props: Node["props"]) =>
    Object.fromEntries(keys.filter(k => k in props).map(k => [k, props[k]]))
  const props = difference(pick(n.props), pick(base.props))
  if (props) patch.props = props as SizePatch["props"]
  return Object.keys(patch).length ? patch : undefined
}

/**
 * Folds an edit made at a size back into the document. Layout, style, visibility and graphics
 * become the size's patch, diffed against the base, so setting a base value back drops it.
 * Everything else (structure, names, text, bindings, the shared lists) changes the base, and the
 * board or display edited becomes the size's own.
 */
export function unsize(doc: Project, before: Project, after: Project, sizeId: string): Project {
  if (!doc.sizes.some(s => s.id === sizeId)) return after
  const base = new Map<string, Node>()
  const seen = new Map<string, Node>()
  for (const sc of doc.screens) walk(sc, n => void base.set(n.id, n))
  for (const sc of before.screens) walk(sc, n => void seen.set(n.id, n))
  const [fx, fy] = stretch(doc, sizeId)

  const back = (n: Node, screen: boolean): Node => {
    const b = base.get(n.id)
    // immer hands back the very same objects for subtrees the edit didn't touch
    if (b && seen.get(n.id) === n) return b
    const children = n.children.map(c => back(c, false))
    if (!b) return { ...n, children }
    const at = { ...b.at }
    const patch = patchFor(n, b, screen)
    if (patch) at[sizeId] = patch
    else delete at[sizeId]
    // the base keeps its own graphics; other prop edits reach it
    const props = { ...n.props }
    for (const k of graphicProps(n)) {
      if (k in b.props) props[k] = b.props[k]
      else delete props[k]
    }
    const out: Node = { ...n, layout: b.layout, style: b.style, hidden: b.hidden, props, children }
    if (Object.keys(at).length) out.at = at
    else delete out.at
    return out
  }

  const screens = after.screens.map(sc => {
    const b = base.get(sc.id) as Screen | undefined
    const out = back(sc, true) as Screen
    if (out === b) return b
    const prev = seen.get(sc.id) as Screen | undefined
    const moved = !prev || prev.frame.x !== sc.frame.x || prev.frame.y !== sc.frame.y
    const { width, height } = doc.target.display
    return {
      ...out,
      layout: b ? b.layout : { ...sc.layout, w: width, h: height },
      frame:
        !moved && b ? b.frame : { x: Math.round(sc.frame.x / fx), y: Math.round(sc.frame.y / fy) },
    }
  })

  return {
    ...after,
    target: doc.target,
    sizes: after.sizes.map(s =>
      s.id === sizeId && s.target !== after.target ? { ...s, target: after.target } : s,
    ),
    screens,
  }
}

/** Drops a size and every node's patch for it. */
export function removeSize(d: Draft<Project>, sizeId: string) {
  d.sizes = d.sizes.filter(s => s.id !== sizeId)
  for (const sc of d.screens)
    walk(sc as Node, n => {
      if (n.at?.[sizeId]) delete n.at[sizeId]
      if (n.at && !Object.keys(n.at).length) delete n.at
    })
}
