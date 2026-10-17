import type { DeviceKind, Peer } from "@/lib/device"

// Messages relayed through the server. They only carry WebRTC session
// descriptions; file names and contents travel over the encrypted DataChannel.
export type SignalPayload =
  | { sid: string; kind: "offer"; sdp: string }
  | { sid: string; kind: "answer"; sdp: string }
  | { sid: string; kind: "cancel" }
  | { sid: string; kind: "busy" }

type ServerMessage =
  | { type: "welcome"; id: string }
  | { type: "peers"; peers: Peer[] }
  | { type: "signal"; from: string; payload: SignalPayload }
  | { type: "gone"; id: string }

export type SignalingEvents = {
  onStatus: (connected: boolean, selfId: string) => void
  onPeers: (peers: Peer[]) => void
  onSignal: (from: string, payload: SignalPayload) => void
  onGone: (peerId: string) => void
}

export class Signaling {
  private ws: WebSocket | null = null
  private retry = 0
  private hello: { name: string; kind: DeviceKind }
  private events: SignalingEvents
  selfId = ""

  constructor(hello: { name: string; kind: DeviceKind }, events: SignalingEvents) {
    this.hello = hello
    this.events = events
  }

  connect() {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`
    const ws = new WebSocket(url)
    this.ws = ws

    ws.onopen = () => {
      this.retry = 0
      ws.send(JSON.stringify({ type: "hello", ...this.hello }))
    }
    ws.onmessage = (ev) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      switch (msg.type) {
        case "welcome":
          this.selfId = msg.id
          this.events.onStatus(true, msg.id)
          break
        case "peers":
          this.events.onPeers(msg.peers.filter((p) => p.id !== this.selfId))
          break
        case "signal":
          this.events.onSignal(msg.from, msg.payload)
          break
        case "gone":
          this.events.onGone(msg.id)
          break
      }
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.selfId = ""
      this.events.onStatus(false, "")
      this.events.onPeers([])
      const delay = Math.min(1000 * 2 ** this.retry, 10000)
      this.retry++
      setTimeout(() => this.connect(), delay)
    }
  }

  setHello(hello: { name: string; kind: DeviceKind }) {
    this.hello = hello
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "hello", ...hello }))
    }
  }

  send(to: string, payload: SignalPayload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "signal", to, payload }))
    }
  }
}
