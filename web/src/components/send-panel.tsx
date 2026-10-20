import { useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, LockIcon, Upload04Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { Peer } from "@/lib/device"
import { formatBytes } from "@/lib/format"
import { MAX_TEXT } from "@/lib/session"
import { cn } from "@/lib/utils"

export function SendPanel({
  peer,
  busy,
  onSend,
}: {
  peer: Peer | null
  busy: boolean
  onSend: (files: File[], text: string) => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [text, setText] = useState("")
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const add = (list: FileList | null) => {
    if (!list?.length) return
    setFiles((prev) => [...prev, ...Array.from(list)])
  }
  const total = files.reduce((n, f) => n + f.size, 0)
  const hasText = text.trim().length > 0
  const parts = [
    files.length && `${files.length} 个文件 · ${formatBytes(total)}`,
    hasText && "文字",
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-4 border bg-card p-5">
      <div>
        <div className="text-xs text-muted-foreground">发送给</div>
        <div className="font-heading text-lg font-semibold">
          {peer ? peer.name : "先选择一台设备"}
        </div>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          add(e.dataTransfer.files)
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 border border-dashed px-3 py-8 text-center transition-colors hover:bg-muted/50 has-focus-visible:ring-2 has-focus-visible:ring-ring",
          dragging && "border-primary bg-primary/5"
        )}
      >
        <HugeiconsIcon icon={Upload04Icon} strokeWidth={2} className="size-6 text-muted-foreground" />
        <span className="text-sm font-medium">拖入或选择文件</span>
        <span className="text-xs text-muted-foreground">任意格式，可多选</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => {
            add(e.target.files)
            e.target.value = ""
          }}
        />
      </label>

      {files.length > 0 && (
        <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 bg-muted px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {formatBytes(f.size)}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`移除 ${f.name}`}
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Textarea
        aria-label="要发送的文字"
        placeholder="或者输入 / 粘贴一段文字"
        value={text}
        maxLength={MAX_TEXT}
        onChange={(e) => setText(e.target.value)}
        className="max-h-60"
      />

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <HugeiconsIcon icon={LockIcon} strokeWidth={2} className="size-3.5 shrink-0" />
        点对点加密直传，内容不经过服务器
      </p>

      <Button
        size="lg"
        className="h-11 text-sm"
        disabled={!peer || parts.length === 0 || busy}
        onClick={() => {
          onSend(files, hasText ? text : "")
          setFiles([])
          setText("")
        }}
      >
        {busy ? "正在传输中…" : parts.length ? `发送 ${parts.join(" + ")}` : "发送"}
      </Button>
    </div>
  )
}
