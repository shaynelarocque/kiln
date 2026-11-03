import { projectApi, useProjectStore } from "@/entities/project"

export const undo = () => projectApi.getState().undo()
export const redo = () => projectApi.getState().redo()

export function useHistory() {
  const canUndo = useProjectStore(s => s.past.length > 0)
  const canRedo = useProjectStore(s => s.future.length > 0)
  return { canUndo, canRedo, undo, redo }
}
