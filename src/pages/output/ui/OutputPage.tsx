import { OutputPanel } from "@/widgets/output-panel"

/** The output window: the build log and serial monitor, apart from the editor. */
export function OutputPage() {
  return (
    <div style={{ height: "100%" }}>
      <OutputPanel docked={false} />
    </div>
  )
}
