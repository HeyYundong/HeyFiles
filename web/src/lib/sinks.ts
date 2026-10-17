import type { FileMeta } from "@/lib/session"

export interface Sink {
  write(chunk: ArrayBuffer): void
  close(): Promise<string | null> // a blob URL to save later, or null if already handed to the browser
  abort(): void
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return
  try {
    await navigator.serviceWorker.register("/sw.js")
  } catch {
    // Streaming downloads are an optimisation; blobs still work without it.
  }
}

function isSafari() {
  const ua = navigator.userAgent
  return /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|Android/.test(ua)
}

// Safari's service worker downloads are unreliable, so it buffers in memory.
export function canStream() {
  return Boolean(navigator.serviceWorker?.controller) && !isSafari()
}

export function createSink(meta: FileMeta, stream: boolean): Sink {
  return stream ? new StreamSink(meta) : new BlobSink(meta)
}

class BlobSink implements Sink {
  private parts: ArrayBuffer[] = []
  private meta: FileMeta

  constructor(meta: FileMeta) {
    this.meta = meta
  }

  write(chunk: ArrayBuffer) {
    this.parts.push(chunk)
  }

  async close() {
    const blob = new Blob(this.parts, { type: this.meta.type || "application/octet-stream" })
    this.parts = []
    return URL.createObjectURL(blob)
  }

  abort() {
    this.parts = []
  }
}

class StreamSink implements Sink {
  private port: MessagePort
  private frame: HTMLIFrameElement | null = null

  constructor(meta: FileMeta) {
    const channel = new MessageChannel()
    this.port = channel.port1
    const id = crypto.randomUUID()
    this.port.onmessage = ({ data }) => {
      if (data === "ready") {
        const frame = document.createElement("iframe")
        frame.hidden = true
        frame.src = `/__download/${id}`
        document.body.appendChild(frame)
        this.frame = frame
      }
    }
    navigator.serviceWorker.controller!.postMessage(
      { type: "register", id, name: meta.name, size: meta.size },
      [channel.port2]
    )
  }

  write(chunk: ArrayBuffer) {
    this.port.postMessage(chunk, [chunk])
  }

  async close() {
    this.port.postMessage("end")
    this.cleanup()
    return null
  }

  abort() {
    this.port.postMessage("abort")
    this.cleanup()
  }

  private cleanup() {
    const frame = this.frame
    setTimeout(() => frame?.remove(), 60_000)
  }
}
