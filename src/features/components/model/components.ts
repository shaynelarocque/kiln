import { editorApi } from "@/entities/editor"
import { createInstance, detachInstance, edit, findMain, insertNode, isLibrary, locate, makeComponent, projectApi, screenOf } from "@/entities/project"

/** Turns the selected node into a main component, leaving an instance where it was. */
export function componentFromSelection() {
  const id = editorApi.getState().selection[0]
  if (!id) return
  let instanceId: string | null = null
  edit(d => void (instanceId = makeComponent(d, id)))
  if (instanceId) editorApi.getState().select([instanceId])
}

/** Adds an instance of a main component to the screen being worked on. */
export function insertInstance(mainId: string) {
  const { project } = projectApi.getState()
  const main = findMain(project, mainId)
  if (!main) return
  const selected = editorApi.getState().selection[0]
  const screen = (selected && screenOf(project, selected)) || project.screens.find(s => !isLibrary(s))!
  if (isLibrary(screen)) return
  const count = project.screens.flatMap(s => s.children).filter(n => n.component === mainId).length
  const instance = createInstance(project, mainId, `${main.name}_${count + 1}`)!
  edit(d => insertNode(d, screen.id, instance))
  editorApi.getState().select([instance.id])
}

export function detach(instanceId: string) {
  edit(d => detachInstance(d, instanceId))
}

export function goToMain(instanceId: string) {
  const node = locate(projectApi.getState().project, instanceId)?.node
  if (node?.component) editorApi.getState().select([node.component])
}
