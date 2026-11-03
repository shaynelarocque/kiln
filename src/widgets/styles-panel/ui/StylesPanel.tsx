import { Minus, Plus } from "lucide-react"
import { ColorInput, Field, Hint, IconButton, Section, StyleProps, Toggle } from "@/shared/ui"
import { useStyles } from "../model/use-styles"
import s from "./styles-panel.module.css"

function NameInput({ value, onRename, label }: { value: string; onRename: (v: string) => void; label: string }) {
  return (
    <input
      key={value}
      className={s.tokenName}
      defaultValue={value}
      aria-label={label}
      onClick={e => e.stopPropagation()}
      onBlur={e => e.target.value.trim() && e.target.value !== value && onRename(e.target.value.trim())}
      onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  )
}

export function StylesPanel() {
  const vm = useStyles()
  const { project } = vm
  return (
    <div className={s.panel}>
      <Section title='Theme'>
        <Hint>LVGL's default theme colours every widget from these until you style it yourself.</Hint>
        <Field label='Primary'>
          <ColorInput value={project.theme.primary} onChange={(v, phase) => vm.setTheme("primary", v, phase)} />
        </Field>
        <Field label='Secondary'>
          <ColorInput value={project.theme.secondary} onChange={(v, phase) => vm.setTheme("secondary", v, phase)} />
        </Field>
        <Field label='Dark'>
          <Toggle checked={project.theme.dark} onChange={vm.setDark} />
        </Field>
      </Section>

      <Section
        title='Colour tokens'
        actions={
          <IconButton label='Add token' onClick={vm.addToken}>
            <Plus />
          </IconButton>
        }
      >
        <Hint>Like CSS variables: change one and everything using it follows. Exported as {"UI_COLOR_*"} macros.</Hint>
        {project.tokens.map(t => (
          <div key={t.id} className={s.token}>
            <NameInput value={t.name} label='Token name' onRename={name => vm.renameToken(t.id, name)} />
            <ColorInput value={t.value} onChange={(v, phase) => vm.setTokenValue(t.id, v, phase)} />
            <IconButton label='Delete token' onClick={() => vm.removeToken(t.id)}>
              <Minus />
            </IconButton>
          </div>
        ))}
      </Section>

      <Section
        title='Shared styles'
        actions={
          <IconButton label='Add style' onClick={vm.addStyle}>
            <Plus />
          </IconButton>
        }
      >
        <Hint>Like CSS classes: apply one to many widgets from the inspector. Each becomes a shared lv_style_t.</Hint>
        {project.styles.map(style => (
          <div key={style.id} className={s.style}>
            <header onClick={() => vm.toggle(style.id)}>
              <NameInput value={style.name} label='Style name' onRename={name => vm.renameStyle(style.id, name)} />
              <small>
                {Object.keys(style.props).length} props · {vm.usesOf(style.id)} uses · <code>{vm.names[style.id]}</code>
              </small>
              <IconButton label='Delete style' onClick={e => (e.stopPropagation(), vm.removeStyle(style.id))}>
                <Minus />
              </IconButton>
            </header>
            {vm.open === style.id && (
              <StyleProps props={style.props} onChange={(name, value, phase) => vm.setStyleProp(style.id, name, value, phase)} tokens={project.tokens} assets={project.assets} />
            )}
          </div>
        ))}
      </Section>
    </div>
  )
}
