import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Moon02Icon, PencilEdit02Icon, SentIcon, Sun03Icon } from "@hugeicons/core-free-icons"

import { DeviceIcon } from "@/components/device-icon"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { actions, useApp } from "@/lib/store"

export function AppHeader() {
  const { me, connected } = useApp()
  const { theme, setTheme } = useTheme()
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(me.name)
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center bg-primary text-primary-foreground">
            <HugeiconsIcon icon={SentIcon} strokeWidth={2} className="size-4.5" />
          </div>
          <span className="font-heading text-base font-semibold tracking-tight">HeyFiles</span>
        </div>

        <div className="flex items-center gap-1.5 text-sm">
          <span
            className={connected ? "size-2 bg-emerald-500" : "size-2 bg-muted-foreground/50"}
            aria-hidden="true"
          />
          <span className="sr-only">{connected ? "已连接" : "连接中"}</span>
          <DeviceIcon kind={me.kind} className="size-4 text-muted-foreground" />
          <span className="font-medium">{me.name}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="修改设备名称"
            onClick={() => {
              setDraft(me.name)
              setRenaming(true)
            }}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={isDark ? "切换到浅色" : "切换到深色"}
            onClick={() => setTheme(isDark ? "light" : "dark")}
          >
            <HugeiconsIcon icon={isDark ? Sun03Icon : Moon02Icon} strokeWidth={2} />
          </Button>
        </div>
      </div>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-sm">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              actions.rename(draft)
              setRenaming(false)
            }}
          >
            <DialogHeader>
              <DialogTitle>设备名称</DialogTitle>
              <DialogDescription>其他设备会看到这个名字。</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="device-name">名称</Label>
              <Input
                id="device-name"
                value={draft}
                maxLength={40}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!draft.trim()}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </header>
  )
}
