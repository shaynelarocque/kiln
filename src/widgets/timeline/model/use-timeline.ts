import { useState } from "react"
import { editorApi, useEditorStore } from "@/entities/editor"
import { createAnimation, edit, findNode, newId, useProjectStore, type Animation, type Keyframe, type Phase, type Track } from "@/entities/project"
import { ANIM_PROPS, type AnimProp } from "@/shared/lvgl"

const START: Record<AnimProp["unit"], [number | string, number | string]> = {
  px: [20, 0],
  opa: [0, 255],
  scale: [192, 256],
  angle: [0, 900],
  color: ["#ff6a00", "#ffffff"],
  int: [0, 100],
}

/** View-model for the timeline: the open animation, its tracks and keyframes, and edits to them. */
export function useTimeline() {
  const project = useProjectStore(s => s.project)
  const animationId = useEditorStore(s => s.animation)
  const selection = useEditorStore(s => s.selection)
  const [picked, setPicked] = useState<{ track: string; index: number } | null>(null)
  const anim = project.animations.find(a => a.id === animationId) ?? project.animations[0]
  const target = selection.length === 1 ? findNode(project, selection[0]) : undefined
  const duration = Math.max(1000, ...(anim?.tracks.flatMap(t => t.keyframes.map(k => k.t)) ?? [0])) + 200

  const update = (recipe: (a: Animation) => void, phase?: Phase) =>
    anim &&
    edit(d => {
      const a = d.animations.find(x => x.id === anim.id)
      if (a) recipe(a)
    }, phase)

  const updateTrack = (trackId: string, recipe: (t: Track) => void, phase?: Phase) =>
    update(a => {
      const t = a.tracks.find(x => x.id === trackId)
      if (t) recipe(t)
    }, phase)

  const pickedKey = picked && anim?.tracks.find(t => t.id === picked.track)?.keyframes[picked.index]

  return {
    project,
    anim,
    target: target && target.widget !== "screen" ? target : undefined,
    duration,
    picked,
    pickedKey,
    pickedTrack: picked ? anim?.tracks.find(t => t.id === picked.track) : undefined,
    props: (widget?: string) => ANIM_PROPS.filter(p => !p.widgets || (widget && p.widgets.includes(widget as never))),
    nodeName: (id: string) => findNode(project, id)?.name ?? "missing",
    open: (id: string) => editorApi.getState().set({ animation: id }),
    close: () => editorApi.getState().set({ timelineOpen: false }),
    create: () => {
      const a = createAnimation(`animation_${project.animations.length + 1}`)
      edit(d => void d.animations.push(a))
      editorApi.getState().set({ animation: a.id })
    },
    remove: () => {
      if (!anim) return
      edit(d => {
        d.animations = d.animations.filter(a => a.id !== anim.id)
        const prune = (n: (typeof d.screens)[number]["children"][number]) => {
          n.events = n.events.filter(e => e.action.type !== "play" || e.action.animation !== anim.id)
          n.children.forEach(prune)
        }
        d.screens.forEach(prune)
      })
      editorApi.getState().set({ animation: null })
    },
    update,
    addTrack: (prop: string) => {
      if (!target || !anim) return
      const unit = ANIM_PROPS.find(p => p.value === prop)!.unit
      const [from, to] = START[unit]
      update(a =>
        void a.tracks.push({
          id: newId(),
          node: target.id,
          prop,
          keyframes: [
            { t: 0, value: from, easing: "ease-out" },
            { t: 400, value: to, easing: "linear" },
          ],
        }),
      )
    },
    removeTrack: (id: string) => update(a => void (a.tracks = a.tracks.filter(t => t.id !== id))),
    /** Adds a keyframe at `t`, holding the value of the keyframe before it. */
    addKey: (trackId: string, t: number) =>
      updateTrack(trackId, tr => {
        const before = [...tr.keyframes].filter(k => k.t <= t).sort((a, b) => b.t - a.t)[0] ?? tr.keyframes[0]
        tr.keyframes.push({ t: Math.round(t / 10) * 10, value: before.value, easing: before.easing })
        tr.keyframes.sort((a, b) => a.t - b.t)
      }),
    moveKey: (trackId: string, index: number, t: number, phase?: Phase) =>
      updateTrack(trackId, tr => void (tr.keyframes[index].t = Math.max(0, Math.round(t / 10) * 10)), phase),
    setKey: (patch: Partial<Keyframe>, phase?: Phase) => picked && updateTrack(picked.track, tr => void Object.assign(tr.keyframes[picked.index], patch), phase),
    removeKey: () => {
      if (!picked) return
      updateTrack(picked.track, tr => void (tr.keyframes.length > 2 && tr.keyframes.splice(picked.index, 1)))
      setPicked(null)
    },
    pick: (track: string, index: number) => setPicked({ track, index }),
    unpick: () => setPicked(null),
    preview: () => anim && editorApi.getState().set({ playing: true, preview: anim.id }),
  }
}
