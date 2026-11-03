import { useMemo, useState } from "react"
import { allNodes, cNames, edit, newId, useProjectStore, type Node, type Phase, type Project } from "@/entities/project"

type Value = string | number | boolean

const pruneClasses = (d: Project, styleId: string) => {
  const prune = (n: Node) => {
    n.classes = n.classes.filter(c => c.style !== styleId)
    n.children.forEach(prune)
  }
  d.screens.forEach(prune)
}

/** View-model for the styles panel: the theme, colour tokens and shared styles. */
export function useStyles() {
  const project = useProjectStore(s => s.project)
  const [open, setOpen] = useState<string | null>(project.styles[0]?.id ?? null)
  const names = useMemo(() => cNames(project), [project])
  const nodes = allNodes(project)

  const token = (id: string, recipe: (t: { name: string; value: string }) => void, phase?: Phase) =>
    edit(d => {
      const t = d.tokens.find(x => x.id === id)
      if (t) recipe(t)
    }, phase)

  return {
    project,
    open,
    names,
    toggle: (id: string) => setOpen(o => (o === id ? null : id)),
    usesOf: (styleId: string) => nodes.filter(n => n.classes.some(c => c.style === styleId)).length,
    setTheme: (key: "primary" | "secondary", v: string, phase?: Phase) => edit(d => void (d.theme[key] = v), phase),
    setDark: (dark: boolean) => edit(d => void (d.theme.dark = dark)),
    addToken: () => edit(d => void d.tokens.push({ id: newId(), name: `color_${d.tokens.length + 1}`, value: "#73d0ff" })),
    renameToken: (id: string, name: string) => token(id, t => void (t.name = name)),
    setTokenValue: (id: string, value: string, phase?: Phase) => token(id, t => void (t.value = value), phase),
    removeToken: (id: string) => edit(d => void (d.tokens = d.tokens.filter(t => t.id !== id))),
    addStyle: () => {
      const id = newId()
      edit(d => void d.styles.push({ id, name: `style_${d.styles.length + 1}`, props: {} }))
      setOpen(id)
    },
    renameStyle: (id: string, name: string) => edit(d => void (d.styles.find(x => x.id === id)!.name = name)),
    removeStyle: (id: string) =>
      edit(d => {
        d.styles = d.styles.filter(x => x.id !== id)
        pruneClasses(d, id)
      }),
    setStyleProp: (id: string, name: string, value: Value | undefined, phase?: Phase) =>
      edit(d => {
        const st = d.styles.find(x => x.id === id)
        if (!st) return
        if (value === undefined) delete st.props[name]
        else st.props[name] = value
      }, phase),
  }
}
