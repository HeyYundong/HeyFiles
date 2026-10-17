import { HugeiconsIcon } from "@hugeicons/react"
import {
  ComputerIcon,
  LaptopIcon,
  SmartPhone01Icon,
  Tablet01Icon,
} from "@hugeicons/core-free-icons"

import type { DeviceKind } from "@/lib/device"

const icons = {
  phone: SmartPhone01Icon,
  tablet: Tablet01Icon,
  laptop: LaptopIcon,
  desktop: ComputerIcon,
}

export function DeviceIcon({ kind, className }: { kind: DeviceKind; className?: string }) {
  return <HugeiconsIcon icon={icons[kind] ?? ComputerIcon} strokeWidth={1.8} className={className} />
}
