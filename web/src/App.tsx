import { useEffect, useState } from "react"

import { AppHeader } from "@/components/app-header"
import { DeviceGrid } from "@/components/device-grid"
import { IncomingDialog } from "@/components/incoming-dialog"
import { SendPanel } from "@/components/send-panel"
import { TransferPanel } from "@/components/transfer-panel"
import { registerServiceWorker } from "@/lib/sinks"
import { actions, useApp } from "@/lib/store"

export function App() {
  const { peers, session } = useApp()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    void registerServiceWorker()
    actions.start()
  }, [])

  const selected = peers.find((p) => p.id === selectedId) ?? (peers.length === 1 ? peers[0] : null)
  const busy = Boolean(session && !["done", "rejected", "cancelled", "failed"].includes(session.state))
  const showPanel = session && !(session.direction === "receive" && session.state === "confirm")

  return (
    <div className="min-h-svh bg-background">
      <AppHeader />
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
        {showPanel && <TransferPanel session={session} />}

        <div className="flex flex-wrap items-start gap-6">
          <section className="flex min-w-0 flex-[999_1_520px] flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h1 className="font-heading text-lg font-semibold">局域网内的设备</h1>
              <span className="text-xs text-muted-foreground">打开 HeyFiles 的设备会自动出现</span>
            </div>
            <DeviceGrid peers={peers} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
          </section>

          <aside className="min-w-0 flex-[1_1_300px]">
            <SendPanel
              peer={selected}
              busy={busy}
              onSend={(files) => selected && actions.sendFiles(selected, files)}
            />
          </aside>
        </div>
      </main>

      <IncomingDialog session={session} />
    </div>
  )
}

export default App
