import { Component } from "lucide-react"
import { useMemo } from "react"
import { isLibrary, useProjectStore } from "@/entities/project"
import { insertInstance } from "../model/components"
import s from "./component-menu.module.css"

/** Toolbar menu: drop an instance of any main component onto the current screen. */
export function ComponentMenu() {
  // select the stable screens array; deriving a new one inside the selector loops zustand forever
  const screens = useProjectStore(st => st.project.screens)
  const mains = useMemo(() => screens.filter(isLibrary).flatMap(sc => sc.children), [screens])
  if (!mains.length) return null
  return (
    <label className={s.menu} title='Insert a component'>
      <Component />
      <select
        value=''
        aria-label='Insert a component'
        onChange={e => e.target.value && insertInstance(e.target.value)}
      >
        <option value='' disabled>
          Insert component
        </option>
        {mains.map(m => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  )
}
