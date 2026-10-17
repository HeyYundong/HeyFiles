export type DeviceKind = "phone" | "tablet" | "laptop" | "desktop"

export type Peer = {
  id: string
  name: string
  kind: DeviceKind
  ip: string
}

const NAME_KEY = "heyfiles.name"

export function detectKind(): DeviceKind {
  const ua = navigator.userAgent
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return "tablet"
  }
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return "tablet"
  if (/iPhone|Android|Mobile/.test(ua)) return "phone"
  if (/Macintosh/.test(ua)) return "laptop"
  return "desktop"
}

function defaultName(): string {
  const ua = navigator.userAgent
  const base = /iPhone/.test(ua)
    ? "iPhone"
    : detectKind() === "tablet" && /Macintosh|iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "设备"
  const suffix = Math.random().toString(36).slice(2, 4).toUpperCase()
  return `${base} ${suffix}`
}

export function loadName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY)
    if (saved) return saved
    const name = defaultName()
    localStorage.setItem(NAME_KEY, name)
    return name
  } catch {
    return defaultName()
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // Private mode: the name just won't persist.
  }
}
