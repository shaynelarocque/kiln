import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  Group,
  Trash,
} from "lucide-react"
import { WidgetIcon } from "@/entities/project"
import {
  alignSelection,
  deleteSelection,
  distributeSelection,
  groupSelection,
  type AlignEdge,
} from "@/features/node-actions"
import { Button, Hint, IconButton, Tabs } from "@/shared/ui"
import { useInspector } from "../model/use-inspector"
import { BindTab } from "./BindTab"
import { DesignTab } from "./DesignTab"
import { InteractTab } from "./InteractTab"
import s from "./inspector.module.css"

const ALIGNS: [AlignEdge, string, React.ReactNode][] = [
  ["left", "Align left (⌥A)", <AlignStartVertical />],
  ["hcenter", "Align horizontal centres (⌥H)", <AlignCenterVertical />],
  ["right", "Align right (⌥D)", <AlignEndVertical />],
  ["top", "Align top (⌥W)", <AlignStartHorizontal />],
  ["vcenter", "Align vertical centres (⌥V)", <AlignCenterHorizontal />],
  ["bottom", "Align bottom (⌥S)", <AlignEndHorizontal />],
]

export function Inspector() {
  const vm = useInspector()

  if (vm.selection.length > 1)
    return (
      <div className={s.empty}>
        <strong>{vm.selection.length} layers selected</strong>
        <div className={s.alignBar}>
          {ALIGNS.map(([edge, label, icon]) => (
            <IconButton key={edge} label={label} onClick={() => alignSelection(edge)}>
              {icon}
            </IconButton>
          ))}
          <span className={s.alignGap} />
          <IconButton
            label='Distribute horizontal spacing (⌃⌥H)'
            disabled={vm.selection.length < 3}
            onClick={() => distributeSelection("x")}
          >
            <AlignHorizontalSpaceBetween />
          </IconButton>
          <IconButton
            label='Distribute vertical spacing (⌃⌥V)'
            disabled={vm.selection.length < 3}
            onClick={() => distributeSelection("y")}
          >
            <AlignVerticalSpaceBetween />
          </IconButton>
        </div>
        <div className={s.actions}>
          <Button icon={<Group />} onClick={groupSelection}>
            Group
          </Button>
          <Button icon={<Trash />} variant='danger' onClick={deleteSelection}>
            Delete
          </Button>
        </div>
      </div>
    )

  if (!vm.node)
    return (
      <div className={s.empty}>
        <strong>Nothing selected</strong>
        <Hint>
          Click a widget on the canvas, or a screen's name to edit the screen. Space-drag pans,
          pinch or ⌘-scroll zooms.
        </Hint>
      </div>
    )

  return (
    <div className={s.inspector}>
      <header className={s.head}>
        <WidgetIcon type={vm.node.widget} className={s.headIcon} />
        <input
          key={vm.node.id}
          className={s.headName}
          defaultValue={vm.node.name}
          aria-label='Name'
          onBlur={e =>
            e.target.value.trim() &&
            e.target.value !== vm.node!.name &&
            vm.rename(e.target.value.trim())
          }
          onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <code title='The variable this widget gets in the generated C'>{vm.cName}</code>
      </header>
      <Tabs
        value={vm.tab}
        onChange={vm.setTab}
        tabs={[
          { value: "design", label: "Design" },
          {
            value: "bind",
            label: `Bind${vm.node.bindings.length ? ` · ${vm.node.bindings.length}` : ""}`,
          },
          {
            value: "interact",
            label: `Interact${vm.node.events.length ? ` · ${vm.node.events.length}` : ""}`,
          },
        ]}
      />
      <div className={s.scroll}>
        {vm.tab === "design" && <DesignTab vm={vm} />}
        {vm.tab === "bind" && <BindTab vm={vm} />}
        {vm.tab === "interact" && <InteractTab vm={vm} />}
      </div>
    </div>
  )
}
