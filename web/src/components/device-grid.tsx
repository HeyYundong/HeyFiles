import { HugeiconsIcon } from "@hugeicons/react"
import { Wifi01Icon } from "@hugeicons/core-free-icons"

import { DeviceIcon } from "@/components/device-icon"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import type { Peer } from "@/lib/device"
import { cn } from "@/lib/utils"

export function DeviceGrid({
  peers,
  selectedId,
  onSelect,
}: {
  peers: Peer[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (peers.length === 0) {
    return (
      <Empty className="border border-dashed py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={Wifi01Icon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>还没有其他设备</EmptyTitle>
          <EmptyDescription>
            在同一网络的另一台设备上打开
            <span className="mx-1 font-mono text-foreground">{location.origin}</span>
            ，它会自动出现在这里。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
      {peers.map((p) => {
        const selected = p.id === selectedId
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(p.id)}
            className={cn(
              "flex min-h-28 flex-col justify-between gap-4 border bg-card p-4 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
              selected && "border-primary ring-1 ring-primary"
            )}
          >
            <div className="flex w-full items-center justify-between">
              <div className="flex size-10 items-center justify-center bg-muted">
                <DeviceIcon kind={p.kind} className="size-5" />
              </div>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-2 bg-emerald-500" aria-hidden="true" />
                在线
              </span>
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{p.name || "未命名设备"}</div>
              <div className="font-mono text-xs text-muted-foreground">{p.ip}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
