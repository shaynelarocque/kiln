import { checkPins, findBoard, pinMap, useBoards } from "@/entities/board"
import { allNodes, createVariable, edit, useProjectStore, type Phase, type Variable } from "@/entities/project"
import { pinClaims } from "@/features/export-firmware"

/** View-model for the data panel: variables, their simulations and their pins. */
export function useData() {
  const project = useProjectStore(s => s.project)
  const { boards } = useBoards()
  const board = findBoard(boards, project.target.board)
  const mcu = board?.mcu ?? "ESP32C3"
  const problems = checkPins(mcu, pinClaims(project))
  const nodes = allNodes(project)

  const update = (id: string, recipe: (v: Variable) => void, phase?: Phase) =>
    edit(d => {
      const v = d.variables.find(x => x.id === id)
      if (v) recipe(v)
    }, phase)

  return {
    project,
    variables: project.variables,
    mcu,
    pins: pinMap(mcu),
    problems,
    /** problems on the pins this variable reads or drives */
    problemsFor: (v: Variable) => {
      const pins = [v.source && "pin" in v.source ? v.source.pin : -1, v.sink?.pin ?? -1]
      return problems.filter(p => pins.includes(p.pin))
    },
    uses: (id: string) => nodes.filter(n => n.bindings.some(b => b.variable === id)).map(n => n.name),
    add: () =>
      edit(d => {
        const taken = new Set(d.variables.map(v => v.name))
        let name = "value"
        for (let i = 2; taken.has(name); i++) name = `value_${i}`
        d.variables.push(createVariable(name))
      }),
    remove: (id: string) =>
      edit(d => {
        d.variables = d.variables.filter(v => v.id !== id)
        // drop bindings and actions that pointed at it
        const prune = (n: (typeof d.screens)[number]["children"][number]) => {
          n.bindings = n.bindings.filter(b => b.variable !== id)
          n.events = n.events.filter(e => !("variable" in e.action) || e.action.variable !== id)
          n.children.forEach(prune)
        }
        d.screens.forEach(prune)
      }),
    update,
  }
}
