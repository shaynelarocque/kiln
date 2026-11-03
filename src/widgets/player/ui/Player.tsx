import { RotateCw, X } from "lucide-react"
import { BUTTON_KEYS } from "@/shared/lvgl"
import { Hint, IconButton } from "@/shared/ui"
import { usePlayer } from "../model/use-player"
import s from "./player.module.css"

export function Player() {
  const vm = usePlayer()
  const { width, height, round } = vm.project.target.display
  const scale = Math.max(1, Math.min(3, Math.floor(560 / Math.max(width, height))))
  return (
    <div className={s.overlay}>
      <div className={s.stage}>
        <div className={s.top}>
          <span className={s.live}>● Live on LVGL 9.6</span>
          <span>{vm.screenName}</span>
          <span className={s.tools}>
            <IconButton label='Restart' onClick={vm.restart}>
              <RotateCw />
            </IconButton>
            <IconButton label='Close (Esc)' onClick={vm.close}>
              <X />
            </IconButton>
          </span>
        </div>
        <div
          className={`${s.device} ${round ? s.round : ""}`}
          style={{ width: width * scale, height: height * scale }}
        >
          <canvas
            ref={vm.canvas}
            width={width}
            height={height}
            className={s.screen}
            onPointerDown={vm.onPointerDown}
            onPointerMove={vm.onPointerMove}
            onPointerUp={vm.onPointerUp}
          />
        </div>
        {vm.buttons.length > 0 && (
          <div className={s.buttons}>
            {vm.buttons.map(b => {
              const key = BUTTON_KEYS.find(k => k.value === b.key)
              return (
                <button
                  key={b.id}
                  className={s.hwButton}
                  data-held={vm.isHeld(b) || undefined}
                  title={`${key?.label}: GPIO${b.pin}`}
                  onPointerDown={e => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    vm.buttonDown(b)
                  }}
                  onPointerUp={() => vm.buttonUp(b)}
                  onPointerCancel={() => vm.buttonUp(b)}
                >
                  <span className={s.cap} aria-hidden />
                  <strong>{b.name}</strong>
                  <small>
                    {key?.label} · <kbd>{key?.keyboard}</kbd>
                  </small>
                </button>
              )
            })}
          </div>
        )}
        {vm.failure && <Hint tone='error'>{vm.failure}</Hint>}
        <Hint>
          Pixel-exact: the same LVGL build, RGB565 colour and fonts the board gets.{" "}
          {vm.project.target.display.touch
            ? "Tap and drag like the touch screen."
            : vm.buttons.length
              ? "The board has buttons and no touch panel, so tapping here is a preview-only shortcut."
              : "Tap and drag to try it; on the board, add a touch panel or buttons to make it interactive."}
        </Hint>
      </div>
      <aside className={s.side}>
        <h3>Variables</h3>
        {vm.project.variables.length === 0 && <Hint>No variables yet.</Hint>}
        {vm.project.variables
          .filter(v => v.type === "int")
          .map(v => (
            <label key={v.id} className={s.var}>
              <span>
                <code>{v.name}</code>
                <strong>{vm.values[v.id] ?? v.initial}</strong>
              </span>
              <input
                type='range'
                min={Math.min(v.min, v.max)}
                max={Math.max(v.min, v.max)}
                value={vm.values[v.id] ?? Number(v.initial)}
                onChange={e => vm.setValue(v.id, Number(e.target.value))}
              />
              {v.sim.kind !== "none" && <small>simulated: {v.sim.kind}</small>}
            </label>
          ))}
      </aside>
    </div>
  )
}
