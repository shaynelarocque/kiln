import { useMemo } from "react"
import { editorApi, useEditorStore } from "@/entities/editor"
import { cNames, edit, findNode, findParent, useProjectStore, type Layout, type Node, type Phase } from "@/entities/project"
import { updateNode } from "@/features/node-actions"
import { MAIN_DEFAULT, STATES, WIDGETS } from "@/shared/lvgl"

type Value = string | number | boolean

/** View-model for the inspector: the selected node plus every edit the panels make to it. */
export function useInspector() {
  const project = useProjectStore(s => s.project)
  const selection = useEditorStore(s => s.selection)
  const selector = useEditorStore(s => s.selector)
  const tab = useEditorStore(s => s.rightTab)
  const names = useMemo(() => cNames(project), [project])

  const node = selection.length === 1 ? findNode(project, selection[0]) : undefined
  const parent = node ? findParent(project, node.id) : undefined
  const def = node ? WIDGETS[node.widget] : undefined
  const [part, stateKey = "default"] = selector.split(":")
  const states = stateKey.split("+")

  const set = (recipe: (n: Node) => void, phase?: Phase) => node && updateNode(node.id, recipe, phase)

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
    tokens: project.tokens,
    assets: project.assets,
    setTab: (rightTab: "design" | "bind" | "interact") => editorApi.getState().set({ rightTab }),
    setSelector: (p: string, st: string[]) => editorApi.getState().set({ selector: selectorFor(p, st) }),
    resetSelector: () => editorApi.getState().set({ selector: MAIN_DEFAULT }),
    /** selectors on this node that have local styles, for the dots on parts/states */
    styled: new Set(node ? Object.keys(node.style).filter(k => Object.keys(node.style[k]).length) : []),
    set,
    setLayout: <K extends keyof Layout>(key: K, value: Layout[K], phase?: Phase) => set(n => void (n.layout[key] = value), phase),
    setProp: (key: string, value: Value | null, phase?: Phase) => set(n => void (n.props[key] = value), phase),
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
    editProject: edit,
  }
}

export type InspectorViewModel = ReturnType<typeof useInspector>
