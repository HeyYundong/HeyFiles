import type { Peer } from "@/lib/device"
import type { Signaling, SignalPayload } from "@/lib/signaling"
import { canStream, createSink, type Sink } from "@/lib/sinks"

// One transfer between two devices over a WebRTC DataChannel. DTLS encrypts
// everything on the wire; the server only relays the offer/answer.
//
// DataChannel protocol (JSON text frames + binary chunks, ordered & reliable):
//   sender → {t:"meta", files, text}  receiver → {t:"accept"} | {t:"reject"}
//   sender → {t:"text", s}…           (only if meta.text > 0; joined in order)
//   sender → {t:"file", i}, <binary chunks>…, {t:"file-end", i}  (per file)
//   sender → {t:"done"}               receiver → {t:"ack"}
//   either → {t:"cancel"}

export type FileMeta = { name: string; size: number; type: string }

export type SessionState =
  | "connecting"
  | "confirm" // receiver: waiting for the user; sender: waiting for the peer
  | "transferring"
  | "done"
  | "rejected"
  | "cancelled"
  | "failed"

// Text rides the control channel in slices small enough for any browser's
// SCTP message limit (Safari's is the lowest).
export const MAX_TEXT = 1_000_000
const TEXT_SLICE = 16_000

export type ReceivedFile = FileMeta & { url: string | null }

export type SessionSnapshot = {
  sid: string
  direction: "send" | "receive"
  peer: Peer
  state: SessionState
  sas: string
  files: FileMeta[]
  text: string
  textLength: number // announced in meta; text fills in after accept on the receiver
  total: number
  transferred: number
  speed: number
  currentIndex: number
  streaming: boolean
  received: ReceivedFile[]
  error: string
}

const CONNECT_TIMEOUT = 15_000
const READ_SIZE = 4 << 20
const HIGH_WATER = 8 << 20 // Chrome errors once the send queue passes 16 MB
const LOW_WATER = 2 << 20

type Control =
  | { t: "meta"; files: FileMeta[]; text?: number }
  | { t: "text"; s: string }
  | { t: "accept" }
  | { t: "reject" }
  | { t: "file"; i: number }
  | { t: "file-end"; i: number }
  | { t: "done" }
  | { t: "ack" }
  | { t: "cancel" }

export class Session {
  readonly sid: string
  private pc: RTCPeerConnection
  private dc: RTCDataChannel | null = null
  private signaling: Signaling
  private onChange: () => void
  private outgoing: File[]
  private sink: Sink | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private speedSample = { at: 0, bytes: 0 }
  private lastEmit = 0
  snapshot: SessionSnapshot

  constructor(opts: {
    sid: string
    direction: "send" | "receive"
    peer: Peer
    signaling: Signaling
    files?: File[]
    text?: string
    onChange: () => void
  }) {
    this.sid = opts.sid
    this.signaling = opts.signaling
    this.onChange = opts.onChange
    this.outgoing = opts.files ?? []
    const text = (opts.text ?? "").slice(0, MAX_TEXT)
    const files = this.outgoing.map((f) => ({ name: f.name, size: f.size, type: f.type }))
    this.snapshot = {
      sid: opts.sid,
      direction: opts.direction,
      peer: opts.peer,
      state: "connecting",
      sas: "",
      files,
      text,
      textLength: text.length,
      total: files.reduce((n, f) => n + f.size, 0),
      transferred: 0,
      speed: 0,
      currentIndex: -1,
      streaming: false,
      received: [],
      error: "",
    }
    // LAN only: host candidates are enough, no STUN/TURN servers involved.
    this.pc = new RTCPeerConnection({ iceServers: [] })
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState
      if (s === "failed") {
        this.fail("无法建立直连。请确认两台设备在同一网络，且路由器没有开启 AP 隔离 / 访客网络。")
      } else if (s === "disconnected" || s === "closed") {
        if (this.snapshot.state === "transferring" || this.snapshot.state === "confirm") {
          this.fail("连接已断开")
        }
      }
    }
    this.timer = setTimeout(() => {
      if (this.snapshot.state === "connecting") this.fail("连接超时，对方可能已离线")
    }, CONNECT_TIMEOUT)
  }

  // ---- sender ----

  async start() {
    const dc = this.pc.createDataChannel("heyfiles", { ordered: true })
    this.attach(dc)
    await this.pc.setLocalDescription(await this.pc.createOffer())
    await waitForIce(this.pc)
    this.signaling.send(this.snapshot.peer.id, {
      sid: this.sid,
      kind: "offer",
      sdp: this.pc.localDescription!.sdp,
    })
  }

  // ---- receiver ----

  async answer(offerSdp: string) {
    this.pc.ondatachannel = (ev) => this.attach(ev.channel)
    await this.pc.setRemoteDescription({ type: "offer", sdp: offerSdp })
    await this.pc.setLocalDescription(await this.pc.createAnswer())
    await waitForIce(this.pc)
    this.signaling.send(this.snapshot.peer.id, {
      sid: this.sid,
      kind: "answer",
      sdp: this.pc.localDescription!.sdp,
    })
    await this.computeSas()
  }

  accept() {
    if (this.snapshot.direction !== "receive" || this.snapshot.state !== "confirm") return
    this.snapshot.streaming = canStream()
    this.update({ state: "transferring" }, true)
    this.speedSample = { at: performance.now(), bytes: 0 }
    this.sendControl({ t: "accept" })
  }

  reject() {
    this.sendControl({ t: "reject" })
    this.update({ state: "rejected" }, true)
    this.close()
  }

  cancel() {
    if (this.isFinal()) return
    if (this.dc?.readyState === "open") this.sendControl({ t: "cancel" })
    else this.signaling.send(this.snapshot.peer.id, { sid: this.sid, kind: "cancel" })
    this.sink?.abort()
    this.update({ state: "cancelled" }, true)
    this.close()
  }

  async handleSignal(payload: SignalPayload) {
    if (payload.kind === "answer") {
      await this.pc.setRemoteDescription({ type: "answer", sdp: payload.sdp })
      await this.computeSas()
    } else if (payload.kind === "cancel") {
      this.sink?.abort()
      this.update({ state: "cancelled" }, true)
      this.close()
    } else if (payload.kind === "busy") {
      this.fail("对方正在进行另一项传输，请稍后再试")
    }
  }

  peerGone() {
    if (!this.isFinal()) this.fail("对方已离线")
  }

  isFinal() {
    const s = this.snapshot.state
    return s === "done" || s === "rejected" || s === "cancelled" || s === "failed"
  }

  dispose() {
    for (const f of this.snapshot.received) if (f.url) URL.revokeObjectURL(f.url)
    this.close()
  }

  // ---- internals ----

  private attach(dc: RTCDataChannel) {
    this.dc = dc
    dc.binaryType = "arraybuffer"
    dc.bufferedAmountLowThreshold = LOW_WATER
    dc.onopen = () => {
      if (this.timer) clearTimeout(this.timer)
      if (this.snapshot.direction === "send") {
        this.update({ state: "confirm" }, true)
        this.sendControl({ t: "meta", files: this.snapshot.files, text: this.snapshot.textLength })
      }
    }
    dc.onmessage = (ev) => {
      if (typeof ev.data === "string") this.onControl(JSON.parse(ev.data) as Control)
      else this.onChunk(ev.data as ArrayBuffer)
    }
  }

  private onControl(msg: Control) {
    switch (msg.t) {
      case "meta": {
        const files = msg.files.slice(0, 1000).map((f) => ({
          name: sanitizeName(String(f.name)),
          size: Math.max(0, Number(f.size) || 0),
          type: String(f.type || ""),
        }))
        const textLength = Math.min(MAX_TEXT, Math.max(0, Number(msg.text) || 0))
        this.update(
          { files, textLength, total: files.reduce((n, f) => n + f.size, 0), state: "confirm" },
          true
        )
        break
      }
      case "text": {
        if (this.snapshot.state !== "transferring") return
        const text = this.snapshot.text + String(msg.s)
        this.update({ text: text.slice(0, this.snapshot.textLength) }, true)
        break
      }
      case "accept":
        this.update({ state: "transferring" }, true)
        void this.pump()
        break
      case "reject":
        this.update({ state: "rejected" }, true)
        this.close()
        break
      case "file": {
        const meta = this.snapshot.files[msg.i]
        if (!meta) return this.fail("收到无效数据")
        this.sink = createSink(meta, this.snapshot.streaming)
        this.update({ currentIndex: msg.i }, true)
        break
      }
      case "file-end": {
        const meta = this.snapshot.files[msg.i]
        const sink = this.sink
        this.sink = null
        void sink?.close().then((url) => {
          this.snapshot.received = [...this.snapshot.received, { ...meta, url }]
          this.update({}, true)
        })
        break
      }
      case "done":
        this.sendControl({ t: "ack" })
        this.update({ state: "done", transferred: this.snapshot.total, speed: 0 }, true)
        break
      case "ack":
        this.update({ state: "done", transferred: this.snapshot.total, speed: 0 }, true)
        this.close()
        break
      case "cancel":
        this.sink?.abort()
        this.update({ state: "cancelled" }, true)
        this.close()
        break
    }
  }

  private onChunk(buf: ArrayBuffer) {
    if (!this.sink || this.snapshot.state !== "transferring") return
    this.sink.write(buf)
    this.progress(buf.byteLength)
  }

  private async pump() {
    const dc = this.dc!
    const max = this.pc.sctp?.maxMessageSize || 65536
    const chunk = Math.min(256 * 1024, max)
    this.speedSample = { at: performance.now(), bytes: 0 }
    try {
      const text = this.snapshot.text
      for (let p = 0; p < text.length; p += TEXT_SLICE) {
        if (this.snapshot.state !== "transferring") return
        if (dc.bufferedAmount > HIGH_WATER) await drained(dc)
        this.sendControl({ t: "text", s: text.slice(p, p + TEXT_SLICE) })
      }
      for (let i = 0; i < this.outgoing.length; i++) {
        const file = this.outgoing[i]
        this.sendControl({ t: "file", i })
        this.update({ currentIndex: i }, true)
        for (let off = 0; off < file.size; off += READ_SIZE) {
          const buf = await file.slice(off, off + READ_SIZE).arrayBuffer()
          for (let p = 0; p < buf.byteLength; p += chunk) {
            if (this.snapshot.state !== "transferring") return
            if (dc.bufferedAmount > HIGH_WATER) await drained(dc)
            const piece = buf.slice(p, p + chunk)
            dc.send(piece)
            this.progress(piece.byteLength)
          }
        }
        this.sendControl({ t: "file-end", i })
      }
      this.sendControl({ t: "done" })
    } catch (err) {
      this.fail(`发送失败：${(err as Error).message}`)
    }
  }

  private progress(bytes: number) {
    const s = this.snapshot
    s.transferred += bytes
    const now = performance.now()
    const dt = now - this.speedSample.at
    if (dt >= 500) {
      const instant = ((s.transferred - this.speedSample.bytes) * 1000) / dt
      s.speed = s.speed ? s.speed * 0.6 + instant * 0.4 : instant
      this.speedSample = { at: now, bytes: s.transferred }
    }
    this.update({}, false)
  }

  private async computeSas() {
    const local = fingerprint(this.pc.localDescription?.sdp)
    const remote = fingerprint(this.pc.remoteDescription?.sdp)
    if (!local || !remote) return
    // Both sides hash the same two DTLS fingerprints, so the codes only match
    // if nobody sits in the middle of the connection.
    const input = new TextEncoder().encode([local, remote].sort().join("|") + "|" + this.sid)
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input))
    const n = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0
    const code = String(n % 1_000_000).padStart(6, "0")
    this.update({ sas: `${code.slice(0, 3)} ${code.slice(3)}` }, true)
  }

  private sendControl(msg: Control) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(msg))
  }

  private fail(error: string) {
    if (this.isFinal()) return
    this.sink?.abort()
    this.update({ state: "failed", error, speed: 0 }, true)
    this.close()
  }

  private close() {
    if (this.timer) clearTimeout(this.timer)
    // Let queued frames (ack/cancel) flush before tearing down.
    setTimeout(() => {
      this.dc?.close()
      this.pc.close()
    }, 300)
  }

  private update(patch: Partial<SessionSnapshot>, force: boolean) {
    Object.assign(this.snapshot, patch)
    const now = performance.now()
    if (!force && now - this.lastEmit < 150) return
    this.lastEmit = now
    this.snapshot = { ...this.snapshot }
    this.onChange()
  }
}

function fingerprint(sdp?: string) {
  return sdp?.match(/a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/)?.[1]?.toUpperCase() ?? ""
}

function sanitizeName(name: string) {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim()
  return clean.slice(0, 200) || "file"
}

function waitForIce(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3000)
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}

function drained(dc: RTCDataChannel) {
  return new Promise<void>((resolve, reject) => {
    const onLow = () => {
      dc.removeEventListener("close", onClose)
      resolve()
    }
    const onClose = () => {
      dc.removeEventListener("bufferedamountlow", onLow)
      reject(new Error("连接已关闭"))
    }
    dc.addEventListener("bufferedamountlow", onLow, { once: true })
    dc.addEventListener("close", onClose, { once: true })
  })
}
