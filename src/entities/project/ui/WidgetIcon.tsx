import {
  ChartLine,
  ChevronsUpDown,
  CircleGauge,
  Frame,
  Gauge,
  Image,
  Lightbulb,
  List,
  LoaderCircle,
  Monitor,
  MousePointerClick,
  RectangleHorizontal,
  SlidersHorizontal,
  SquareCheck,
  ToggleRight,
  Type,
  type LucideProps,
} from "lucide-react"
import type { WidgetType } from "@/shared/lvgl"

const ICONS: Record<WidgetType, React.ComponentType<LucideProps>> = {
  screen: Monitor,
  container: Frame,
  label: Type,
  button: MousePointerClick,
  image: Image,
  arc: Gauge,
  bar: RectangleHorizontal,
  slider: SlidersHorizontal,
  switch: ToggleRight,
  checkbox: SquareCheck,
  spinner: LoaderCircle,
  led: Lightbulb,
  dropdown: ChevronsUpDown,
  roller: List,
  scale: CircleGauge,
  chart: ChartLine,
}

export function WidgetIcon({ type, ...props }: { type: WidgetType } & LucideProps) {
  const Icon = ICONS[type]
  return <Icon {...props} />
}
