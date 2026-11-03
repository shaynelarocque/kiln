import { instancesOf } from "../model/components"
import type { Project } from "../model/types"
import { walk } from "./tree"

/** Node ids a document node maps to once instances are expanded (see trackTargets). */
export type Targets = (nodeId: string) => string[]

/**
 * Where an animated node ends up in the built UI: the node itself (unless it sits on the
 * Components screen, which isn't built), its copies inside instances (ids ending in /<id>),
 * and, for a main component, every instance of it, nested ones included.
 */
export function trackTargets(source: Project, resolved: Project): Targets {
  const ids: string[] = []
  for (const s of resolved.screens) walk(s, n => void ids.push(n.id))
  return nodeId => {
    const from = [nodeId, ...instancesOf(source, nodeId).map(i => i.id)]
    return ids.filter(id => from.some(f => id === f || id.endsWith(`/${f}`)))
  }
}
