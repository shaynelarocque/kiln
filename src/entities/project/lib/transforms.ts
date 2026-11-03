import { resolveScreens } from "../model/components"
import type { Node, Project, StyleProps } from "../model/types"
import { trackTargets } from "./targets"
import { allNodes } from "./tree"

/**
 * How a node is transformed at its most expensive: rotated at all, its smallest scale
 * (256 = 100%), and how far its shadow reaches past its box.
 */
export type Transform = { node: Node; rotates: boolean; minScale: number; shadow: number }

const SCALES = ["transform_scale_x", "transform_scale_y"]

/**
 * Nodes LVGL draws through a transform layer at some point, keyed by built node id (instance
 * copies included): rotated or scaled in any state, by their own style or a class, or by an
 * animation. LVGL renders those into a layer on its heap, which costs RAM on the board.
 */
export function transformedNodes(project: Project): Map<string, Transform> {
  const built = { ...project, screens: resolveScreens(project, false) }
  const out = new Map<string, Transform>()
  const maps = (n: Node): StyleProps[] => [
    ...Object.values(n.style),
    ...n.classes.flatMap(c => project.styles.filter(s => s.id === c.style).map(s => s.props)),
  ]
  // how far a shadow reaches past the box: LVGL draws it into the same layer
  const shadowOf = (n: Node) =>
    Math.max(
      0,
      ...maps(n).map(
        m =>
          Number(m.shadow_width ?? 0) +
          Number(m.shadow_spread ?? 0) +
          Math.max(
            Math.abs(Number(m.shadow_offset_x ?? 0)),
            Math.abs(Number(m.shadow_offset_y ?? 0)),
          ),
      ),
    )
  const note = (node: Node, rotates: boolean, scale: number) => {
    const t = out.get(node.id) ?? { node, rotates: false, minScale: 256, shadow: shadowOf(node) }
    out.set(node.id, { ...t, rotates: t.rotates || rotates, minScale: Math.min(t.minScale, scale) })
  }
  const nodes = new Map(allNodes(built).map(n => [n.id, n]))
  for (const n of nodes.values())
    for (const m of maps(n)) {
      const rotates = Boolean(Number(m.transform_rotation ?? 0))
      const scales = SCALES.map(k => Number(m[k] ?? 256)).filter(Number.isFinite)
      if (rotates || scales.some(s => s !== 256)) note(n, rotates, Math.min(256, ...scales))
    }
  const targets = trackTargets(project, built)
  for (const anim of project.animations)
    for (const track of anim.tracks) {
      if (track.prop !== "scale" && track.prop !== "rotation") continue
      const scale =
        track.prop === "scale"
          ? Math.min(256, ...track.keyframes.map(k => Number(k.value)).filter(Number.isFinite))
          : 256
      for (const id of targets(track.node)) note(nodes.get(id)!, track.prop === "rotation", scale)
    }
  return out
}
