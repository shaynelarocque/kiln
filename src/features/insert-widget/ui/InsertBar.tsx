import { WidgetIcon } from "@/entities/project"
import { INSERTABLE, WIDGETS } from "@/shared/lvgl"
import { IconButton } from "@/shared/ui"
import { insertWidget } from "../model/insert"

export function InsertBar() {
  return (
    <>
      {INSERTABLE.map(type => (
        <IconButton
          key={type}
          label={`Add ${WIDGETS[type].label.toLowerCase()}`}
          onClick={() => insertWidget(type)}
        >
          <WidgetIcon type={type} />
        </IconButton>
      ))}
    </>
  )
}
