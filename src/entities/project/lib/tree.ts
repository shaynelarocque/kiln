import type { Node, Project, Screen } from "../model/types"

/** Depth-first, parents before children (creation order). */
export function walk(node: Node, visit: (node: Node, parent: Node | null) => void, parent: Node | null = null) {
  visit(node, parent)
  for (const child of node.children) walk(child, visit, node)
}

export function findNode(project: Project, id: string): Node | undefined {
  for (const screen of project.screens) {
    let found: Node | undefined
    walk(screen, n => {
      if (n.id === id) found = n
    })
    if (found) return found
  }
}

export function findParent(project: Project, id: string): Node | undefined {
  for (const screen of project.screens) {
    let found: Node | undefined
    walk(screen, (n, parent) => {
      if (n.id === id && parent) found = parent
    })
    if (found) return found
  }
}

export function screenOf(project: Project, id: string): Screen | undefined {
  return project.screens.find(s => {
    let hit = false
    walk(s, n => {
      hit ||= n.id === id
    })
    return hit
  })
}

export function allNodes(project: Project): Node[] {
  const out: Node[] = []
  for (const screen of project.screens) walk(screen, n => void out.push(n))
  return out
}
