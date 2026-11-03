import { useMemo } from "react"
import { transformLayerBytes } from "@/entities/board"
import { editorApi, nodeBoxes, useEditorStore } from "@/entities/editor"
import {
  cNames,
  edit,
  findMain,
  findNode,
  findParent,
  instancesOf,
  locate,
  isLibrary,
  transformedNodes,
  useProjectStore,
  type Layout,
  type Node,
  type Phase,
} from "@/entities/project"
import { updateNode } from "@/features/node-actions"
import { resetAtSize } from "@/features/sizes"
import { MAIN_DEFAULT, STATES, WIDGETS } from "@/shared/lvgl"

type Value = string | number | boolean

/** View-model for the inspector: the selected node plus every edit the panels make to it. */
export function useInspector() {
  const project = useProjectStore(s => s.project)
  const selection = useEditorStore(s => s.selection)
  const selector = useEditorStore(s => s.selector)
  const tab = useEditorStore(s => s.rightTab)
  const rects = useEditorStore(s => s.rects)
  const doc = useProjectStore(s => s.doc)
  const size = useProjectStore(s => s.size)
  const names = useMemo(() => cNames(project), [project])
  const transforms = useMemo(() => transformedNodes(project), [project])

  const node = selection.length === 1 ? findNode(project, selection[0]) : undefined
  const parent = node ? findParent(project, node.id) : undefined
  const def = node ? WIDGETS[node.widget] : undefined
  const [part, stateKey = "default"] = selector.split(":")
  const states = stateKey.split("+")

  const set = (recipe: (n: Node) => void, phase?: Phase) =>
    node && updateNode(node.id, recipe, phase)
  const main = node?.component ? findMain(project, node.component) : undefined
  const isMain = Boolean(
    node &&
    parent &&
    project.screens.some(sc => isLibrary(sc) && sc.children.some(c => c.id === node.id)),
  )

  /** The selector key for a part and a set of states, in LVGL's state order. */
  const selectorFor = (p: string, st: string[]) => {
    const ordered = STATES.map(x => x.value).filter(v => st.includes(v) && v !== "default")
    return `${p}:${ordered.length ? ordered.join("+") : "default"}`
  }

  return {
    project,
    node,
    parent,
    def,
    tab,
    selection,
    selector,
    part,
    states,
    cName: node ? names[node.id] : "",
    /** the size being edited, if not the base, and whether this node differs there */
    atSize: size
      ? {
          name: doc.sizes.find(x => x.id === size)?.name ?? "",
          differs: Boolean(node && locate(doc, node.id)?.node.at?.[size]),
          reset: () => node && resetAtSize(node.id),
        }
      : null,
    /** the layer the board's LVGL draws this node into while it's rotated or scaled */
    transformLayer: (() => {
      const t = node && transforms.get(node.id)
      const box = node && nodeBoxes(rects).get(node.id)
      return t && box
        ? {
            ...box,
            rotates: t.rotates,
            bytes: transformLayerBytes(box.w, box.h, t, project.target.display.bufferRows),
          }
        : null
    })(),
    tokens: project.tokens,
    assets: project.assets,
    sprites: project.sprites,
    fonts: project.fonts,
    setTab: (rightTab: "design" | "bind" | "interact") => editorApi.getState().set({ rightTab }),
    setSelector: (p: string, st: string[]) =>
      editorApi.getState().set({ selector: selectorFor(p, st) }),
    resetSelector: () => editorApi.getState().set({ selector: MAIN_DEFAULT }),
    /** selectors on this node that have local styles, for the dots on parts/states */
    styled: new Set(
      node ? Object.keys(node.style).filter(k => Object.keys(node.style[k]).length) : [],
    ),
    set,
    setLayout: <K extends keyof Layout>(key: K, value: Layout[K], phase?: Phase) =>
      set(n => void (n.layout[key] = value), phase),
    setProp: (key: string, value: Value | null, phase?: Phase) =>
      set(n => void (n.props[key] = value), phase),
    setStyle: (name: string, value: Value | undefined, phase?: Phase) =>
      set(n => {
        const map = (n.style[selector] ??= {})
        if (value === undefined) delete map[name]
        else map[name] = value
        if (!Object.keys(map).length) delete n.style[selector]
      }, phase),
    /** Reads a style prop as LVGL would resolve it from the node's local style (main part, default state). */
    mainStyle: (name: string) => node?.style[MAIN_DEFAULT]?.[name],
    setMainStyle: (name: string, value: Value | undefined, phase?: Phase) =>
      set(n => {
        const map = (n.style[MAIN_DEFAULT] ??= {})
        if (value === undefined) delete map[name]
        else map[name] = value
      }, phase),
    rename: (name: string) => set(n => void (n.name = name)),
    /** components: the main this instance follows, or how many instances follow this main */
    main,
    isMain,
    instanceCount: node && isMain ? instancesOf(project, node.id).length : 0,
    /** set (or with undefined, clear) an instance's override of one of its main's props */
    overrideProp: (mainNodeId: string, key: string, value: string | number | boolean | undefined) =>
      set(n => {
        const o = ((n.overrides ??= {})[mainNodeId] ??= {})
        if (value === undefined) delete o.props?.[key]
        else (o.props ??= {})[key] = value
      }),
    overrideVariable: (mainNodeId: string, variable: string | undefined) =>
      set(n => {
        const o = ((n.overrides ??= {})[mainNodeId] ??= {})
        if (variable) o.variable = variable
        else delete o.variable
      }),
    editProject: edit,
  }
}

export type InspectorViewModel = ReturnType<typeof useInspector>
