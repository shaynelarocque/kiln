import { editorApi } from "@/entities/editor"
import {
  canContain,
  createNode,
  edit,
  insertNode,
  locate,
  projectApi,
  uniqueName,
} from "@/entities/project"
import { WIDGETS, type WidgetType } from "@/shared/lvgl"

/** Adds a widget inside the selected container (or next to the selected widget), centred. */
export function insertWidget(type: WidgetType) {
  const { project } = projectApi.getState()
  const hit = locate(project, editorApi.getState().selection[0] ?? "")
  const parent = hit
    ? canContain(hit.node)
      ? hit.node
      : (hit.parent ?? hit.node)
    : project.screens[0]
  const node = createNode(type, { name: uniqueName(project, WIDGETS[type].label) })
  const [pw, ph] = [parent.layout.w, parent.layout.h]
  const [w, h] = [node.layout.w, node.layout.h]
  if (!parent.layout.flex) {
    node.layout.x = typeof pw === "number" && typeof w === "number" ? Math.round((pw - w) / 2) : 10
    node.layout.y = typeof ph === "number" && typeof h === "number" ? Math.round((ph - h) / 2) : 10
  }
  edit(d => insertNode(d, parent.id, node))
  editorApi.getState().select([node.id])
}
