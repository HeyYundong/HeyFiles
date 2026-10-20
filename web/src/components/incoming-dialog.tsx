import { HugeiconsIcon } from "@hugeicons/react"
import { File01Icon, LockIcon, TextIcon } from "@hugeicons/core-free-icons"

import { SasCode } from "@/components/transfer-panel"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatBytes } from "@/lib/format"
import type { SessionSnapshot } from "@/lib/session"
import { canStream } from "@/lib/sinks"
import { actions } from "@/lib/store"

const MEMORY_WARN = 1 << 30

export function IncomingDialog({ session: s }: { session: SessionSnapshot | null }) {
  const open = Boolean(s && s.direction === "receive" && s.state === "confirm" && (s.files.length || s.textLength))

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) actions.reject()
      }}
    >
      {s && (
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {s.peer.name} 想发送{" "}
              {[s.files.length && `${s.files.length} 个文件`, s.textLength && "一段文字"]
                .filter(Boolean)
                .join("和")}
              给你
            </DialogTitle>
            <DialogDescription>
              {[s.files.length && `文件共 ${formatBytes(s.total)}`, s.textLength && `文字 ${s.textLength} 字`]
                .filter(Boolean)
                .join(" · ")}
            </DialogDescription>
          </DialogHeader>

          {s.textLength > 0 && (
            <div className="flex items-center gap-2 bg-muted px-3 py-2 text-sm">
              <HugeiconsIcon icon={TextIcon} strokeWidth={2} className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">文字消息</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{s.textLength} 字</span>
            </div>
          )}

          {s.files.length > 0 && (
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {s.files.map((f, i) => (
              <li key={i} className="flex items-center gap-2 bg-muted px-3 py-2 text-sm">
                <HugeiconsIcon icon={File01Icon} strokeWidth={2} className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatBytes(f.size)}
                </span>
              </li>
            ))}
          </ul>
          )}

          <div className="flex items-center justify-between gap-3 border p-3">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <HugeiconsIcon icon={LockIcon} strokeWidth={2} className="size-3.5 shrink-0" />
              两端安全码一致即安全
            </span>
            <SasCode code={s.sas} />
          </div>

          {!canStream() && s.total > MEMORY_WARN && (
            <p className="text-xs text-muted-foreground">
              这个浏览器会先把文件接收到内存里再保存，超大文件可能失败。电脑上建议用 Chrome、Edge 或 Firefox 接收。
            </p>
          )}

          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
            <Button variant="outline" size="lg" className="h-11 text-sm" onClick={actions.reject}>
              拒绝
            </Button>
            <Button size="lg" className="h-11 text-sm" onClick={actions.accept}>
              接收
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
