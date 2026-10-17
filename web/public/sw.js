// Streams received files straight to the browser's download manager, so large
// files never have to fit in memory. The page feeds chunks through a
// MessageChannel; a navigation to /__download/<id> picks up the stream.

const pending = new Map()

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("message", (event) => {
  const data = event.data
  if (!data || data.type !== "register" || !event.ports[0]) return
  const port = event.ports[0]
  const stream = new ReadableStream({
    start(controller) {
      port.onmessage = ({ data: chunk }) => {
        if (chunk === "end") controller.close()
        else if (chunk === "abort") controller.error(new Error("aborted"))
        else controller.enqueue(new Uint8Array(chunk))
      }
    },
    cancel() {
      port.postMessage("cancelled")
    },
  })
  pending.set(data.id, { stream, name: data.name, size: data.size })
  port.postMessage("ready")
})

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  const match = url.pathname.match(/^\/__download\/([\w-]+)$/)
  if (!match) return
  const entry = pending.get(match[1])
  if (!entry) {
    event.respondWith(new Response("Not found", { status: 404 }))
    return
  }
  pending.delete(match[1])
  event.respondWith(
    new Response(entry.stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(entry.size),
        "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(entry.name),
        "Cache-Control": "no-store",
      },
    })
  )
})
