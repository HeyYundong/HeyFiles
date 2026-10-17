import { useSyncExternalStore } from "react"

import { detectKind, loadName, saveName, type Peer } from "@/lib/device"
import { Session, type SessionSnapshot } from "@/lib/session"
import { Signaling } from "@/lib/signaling"

// Single app-wide controller: one signaling connection and at most one
// transfer at a time. Nothing is persisted — when a transfer ends it's gone.

type AppState = {
  connected: boolean
  me: { name: string; kind: ReturnType<typeof detectKind> }
  peers: Peer[]
  session: SessionSnapshot | null
}

let state: AppState = {
  connected: false,
  me: { name: loadName(), kind: detectKind() },
  peers: [],
  session: null,
}
let session: Session | null = null
const listeners = new Set<() => void>()

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function syncSession() {
  set({ session: session ? session.snapshot : null })
}

const signaling = new Signaling(state.me, {
  onStatus: (connected) => set({ connected }),
  onPeers: (peers) => {
    set({ peers })
    if (session && !session.isFinal() && !peers.some((p) => p.id === session!.snapshot.peer.id)) {
      session.peerGone()
    }
  },
  onGone: (id) => {
    if (session?.snapshot.peer.id === id) session.peerGone()
  },
  onSignal: (from, payload) => {
    if (payload.kind === "offer") {
      if (session && !session.isFinal()) {
        signaling.send(from, { sid: payload.sid, kind: "busy" })
        return
      }
      const peer = state.peers.find((p) => p.id === from) ?? {
        id: from,
        name: "未知设备",
        kind: "desktop" as const,
        ip: "",
      }
      session?.dispose()
      session = new Session({
        sid: payload.sid,
        direction: "receive",
        peer,
        signaling,
        onChange: syncSession,
      })
      syncSession()
      session.answer(payload.sdp).catch(() => session?.cancel())
      return
    }
    if (session && session.sid === payload.sid) void session.handleSignal(payload)
  },
})

let started = false

export const actions = {
  start() {
    if (started) return
    started = true
    signaling.connect()
  },
  sendFiles(peer: Peer, files: File[]) {
    if (session && !session.isFinal()) return
    session?.dispose()
    session = new Session({
      sid: crypto.randomUUID(),
      direction: "send",
      peer,
      signaling,
      files,
      onChange: syncSession,
    })
    syncSession()
    session.start().catch(() => session?.cancel())
  },
  accept: () => session?.accept(),
  reject: () => session?.reject(),
  cancel: () => session?.cancel(),
  dismiss() {
    if (session && !session.isFinal()) return
    session?.dispose()
    session = null
    syncSession()
  },
  rename(name: string) {
    const clean = name.trim().slice(0, 40)
    if (!clean) return
    saveName(clean)
    set({ me: { ...state.me, name: clean } })
    signaling.setHello(state.me)
  },
}

export function useApp() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}
