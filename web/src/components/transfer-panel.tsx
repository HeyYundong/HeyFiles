import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight02Icon,
  CheckmarkCircle02Icon,
  Download04Icon,
  LockIcon,
} from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatBytes, formatSpeed } from "@/lib/format"
import type { SessionSnapshot } from "@/lib/session"
import { actions, useApp } from "@/lib/store"

export function SasCode({ code }: { code: string }) {
  return (
    <span className="bg-muted px-3 py-1 font-mono text-xl font-semibold tracking-[0.2em]">
      {code || "··· ···"}
    </span>
  )
}

function saveAll(s: SessionSnapshot) {
  s.received.forEach((f, i) => {
    if (!f.url) return
    setTimeout(() => {
      const a = document.createElement("a")
      a.href = f.url!
      a.download = f.name
      a.click()
    }, i * 400)
  })
}

export function TransferPanel({ session: s }: { session: SessionSnapshot }) {
  const { me } = useApp()
  const sending = s.direction === "send"
  const from = sending ? me.name : s.peer.name
  const to = sending ? s.peer.name : me.name
  const pct = s.total ? Math.min(100, (s.transferred / s.total) * 100) : 0
  const final = ["done", "rejected", "cancelled", "failed"].includes(s.state)
  const current = s.files[s.currentIndex]

  return (
    <section aria-live="polite" className="flex flex-col gap-4 border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span>{from}</span>
          <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} className="size-4" />
          <span>{to}</span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {formatBytes(s.transferred)} / {formatBytes(s.total)}
          {s.state === "transferring" && s.speed > 0 && ` · ${formatSpeed(s.speed)}`}
        </span>
      </div>

      {s.state === "connecting" && (
        <p className="text-sm text-muted-foreground">正在建立加密连接…</p>
      )}

      {s.state === "confirm" && sending && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">等待 {s.peer.name} 确认</p>
            <p className="text-xs text-muted-foreground">请确认对方屏幕上显示的安全码与这里一致</p>
          </div>
          <SasCode code={s.sas} />
        </div>
      )}

      {(s.state === "transferring" || s.state === "done") && (
        <div className="flex flex-col gap-2">
          <Progress value={pct} className="h-1.5" />
          <div className="flex justify-between gap-3 text-xs text-muted-foreground">
            <span className="truncate">
              {s.state === "done"
                ? `传输完成 · ${s.files.length} 个文件`
                : current
                  ? `${s.currentIndex + 1}/${s.files.length} · ${current.name}`
                  : "准备中…"}
            </span>
            <span>{Math.floor(pct)}%</span>
          </div>
        </div>
      )}

      {s.state === "done" && !sending && (
        s.streaming ? (
          <p className="flex items-center gap-2 text-sm">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4 text-emerald-600" />
            已保存到浏览器的下载目录
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {s.received.map((f, i) => (
              <div key={i} className="flex items-center gap-2 bg-muted px-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatBytes(f.size)}
                </span>
                {f.url && (
                  <Button asChild variant="outline" size="sm">
                    <a href={f.url} download={f.name}>
                      <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
                      保存
                    </a>
                  </Button>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {s.state === "rejected" && <p className="text-sm">对方拒绝了这次传输。</p>}
      {s.state === "cancelled" && <p className="text-sm">传输已取消。</p>}
      {s.state === "failed" && <p className="text-sm text-destructive">{s.error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <HugeiconsIcon icon={LockIcon} strokeWidth={2} className="size-3.5 shrink-0" />
          {s.sas ? `安全码 ${s.sas} · ` : ""}点对点加密，关闭后不留记录
        </p>
        <div className="flex gap-2">
          {s.state === "done" && !sending && !s.streaming && s.received.length > 1 && (
            <Button size="sm" onClick={() => saveAll(s)}>
              全部保存
            </Button>
          )}
          {final ? (
            <Button variant="outline" size="sm" onClick={actions.dismiss}>
              关闭
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={actions.cancel}>
              取消
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
