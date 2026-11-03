import { ChevronDown, ChevronRight, Eye, EyeOff, Lock, LockOpen, Plus, Trash } from "lucide-react"
import { useState } from "react"
import { WidgetIcon } from "@/entities/project"
import { IconButton, Section } from "@/shared/ui"
import { useLayers, type Row } from "../model/use-layers"
import s from "./layers.module.css"

export function LayersPanel() {
  const vm = useLayers()
  return (
    <div className={s.panel}>
      <Section
        title='Screens'
        actions={
          <IconButton label='Add screen' onClick={vm.addScreen}>
            <Plus />
          </IconButton>
        }
      >
        <ul className={s.list}>
          {vm.project.screens.map(screen => (
            <li
              key={screen.id}
              className={`${s.row} ${vm.selection.includes(screen.id) ? s.on : ""} ${vm.active.id === screen.id ? s.active : ""}`}
              onClick={e => vm.select(screen.id, e.shiftKey)}
            >
              <WidgetIcon type='screen' className={s.icon} />
              <Name value={screen.name} onRename={name => vm.rename(screen.id, name)} />
              {vm.project.screens.length > 1 && (
                <IconButton label='Delete screen' className={s.tool} onClick={e => (e.stopPropagation(), vm.deleteScreen(screen.id))}>
                  <Trash />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={`Layers · ${vm.active.name}`} collapsible={false}>
        {vm.rows.length === 0 && <p className={s.empty}>Add widgets from the toolbar.</p>}
        <ul className={s.list} onDragLeave={e => e.currentTarget === e.target && vm.clearDrop()}>
          {vm.rows.map(row => (
            <LayerRow key={row.node.id} row={row} vm={vm} />
          ))}
        </ul>
      </Section>
    </div>
  )
}

function LayerRow({ row, vm }: { row: Row; vm: ReturnType<typeof useLayers> }) {
  const { node } = row
  const drop = vm.drop?.id === node.id ? vm.drop.where : null
  return (
    <li
      className={`${s.row} ${vm.selection.includes(node.id) ? s.on : ""} ${vm.hover === node.id ? s.hovered : ""} ${node.hidden || row.hiddenByParent ? s.muted : ""} ${drop ? s[drop] : ""}`}
      style={{ paddingLeft: 8 + row.depth * 14 }}
      draggable
      onDragStart={e => e.dataTransfer.setData("text/kiln-node", node.id)}
      onDragOver={e => (e.preventDefault(), vm.dropAt(row, e))}
      onDrop={e => vm.finishDrop(e.dataTransfer.getData("text/kiln-node"))}
      onClick={e => vm.select(node.id, e.shiftKey)}
      onPointerEnter={() => vm.hoverRow(node.id)}
      onPointerLeave={() => vm.hoverRow(null)}
    >
      <button className={s.twisty} onClick={e => (e.stopPropagation(), vm.toggle(node.id))} disabled={!row.container} aria-label='Expand'>
        {row.container && (row.collapsed ? <ChevronRight /> : <ChevronDown />)}
      </button>
      <WidgetIcon type={node.widget} className={s.icon} />
      <Name value={node.name} onRename={name => vm.rename(node.id, name)} />
      <IconButton label={node.locked ? "Unlock" : "Lock"} className={`${s.tool} ${node.locked ? s.pinned : ""}`} onClick={e => (e.stopPropagation(), vm.toggleLocked(node.id))}>
        {node.locked ? <Lock /> : <LockOpen />}
      </IconButton>
      <IconButton label={node.hidden ? "Show" : "Hide"} className={`${s.tool} ${node.hidden ? s.pinned : ""}`} onClick={e => (e.stopPropagation(), vm.toggleHidden(node.id))}>
        {node.hidden ? <EyeOff /> : <Eye />}
      </IconButton>
    </li>
  )
}

function Name({ value, onRename }: { value: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  if (!editing)
    return (
      <span className={s.name} onDoubleClick={() => setEditing(true)}>
        {value}
      </span>
    )
  return (
    <input
      className={s.rename}
      autoFocus
      defaultValue={value}
      onClick={e => e.stopPropagation()}
      onBlur={e => {
        const name = e.target.value.trim()
        if (name && name !== value) onRename(name)
        setEditing(false)
      }}
      onKeyDown={e => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
        if (e.key === "Escape") setEditing(false)
      }}
    />
  )
}
