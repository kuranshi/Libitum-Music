import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { JsonStore } from './store'
import { createQqSessionResolver, qqCore } from './qqmusic-core'

export interface QqMusicRequest {
  query?: Record<string, string | number | boolean>
  token?: string
  method?: 'GET' | 'POST'
  body?: unknown
}
export interface QqMusicResponse { status: number; body: Record<string, any>; cookie?: string }
export interface QqMusicTransport {
  request(path: string, options?: QqMusicRequest): Promise<QqMusicResponse>
  close?(): void
}

/** One native service keeps the QR bootstrap and authenticated device together. */
export async function createQqMusicRuntime(userData: string): Promise<QqMusicTransport> {
  const store = new JsonStore<{ seed: string } | null>(join(userData, 'qqmusic-device.json'), null)
  const saved = await store.read()
  const seed = saved && /^[a-f0-9]{64}$/.test(saved.seed) ? saved.seed : randomBytes(32).toString('hex')
  if (!saved || seed !== saved.seed) await store.write({ seed })
  const listeners = new Set<{ close(): void }>()
  const connect = (url: string, protocol: string, handlers: any) => new Promise((resolve, reject) => {
    const socket = new WebSocket(url, protocol)
    socket.binaryType = 'arraybuffer'
    let opened = false
    const timeout = setTimeout(() => { socket.close(); reject(new Error('QQ MQTT connection timeout')) }, 12000)
    socket.addEventListener('message', event => handlers.message(event.data))
    socket.addEventListener('error', () => { clearTimeout(timeout); const error = new Error('QQ MQTT connection failed'); handlers.error(error); reject(error) })
    socket.addEventListener('close', () => { clearTimeout(timeout); handlers.close(); if (!opened) reject(new Error('QQ MQTT connection closed before opening')) })
    socket.addEventListener('open', () => {
      opened = true
      clearTimeout(timeout)
      resolve({ send: (data: Uint8Array) => socket.send(Uint8Array.from(data)), close: () => socket.close() })
    }, { once: true })
  })
  const listen = qqCore.createMqttListenOver(connect)
  const service = qqCore.createQrLoginService({
    http: qqCore.createFetchAuthHttpClient(),
    createSessionHttp: () => qqCore.createFetchAuthHttpClient(),
    deviceRepository: qqCore.createMemoryDeviceContextRepository(await qqCore.deriveAndroidDevice(seed)),
    sessionResolver: createQqSessionResolver(seed),
    listen: (...args: any[]) => {
      const listener = listen(...args)
      listeners.add(listener)
      void listener.done.catch(() => {}).finally(() => listeners.delete(listener))
      return listener
    }
  })
  qqCore.setLegacyHttpTransport(qqCore.createFetchLegacyTransport())
  const match = qqCore.createRouter(Object.fromEntries(qqCore.sharedRoutes.map((route: any) => [qqCore.serverlessPathOf(route), route.handler])))
  let closed = false
  return {
    async request(path, options = {}) {
      const url = new URL(path, 'https://libitum-qq.invalid')
      for (const [key, value] of Object.entries(options.query || {})) url.searchParams.set(key, String(value))
      if (closed) throw new Error('QQ runtime is closed')
      const route = match(url.pathname)
      if (!route) return { status: 501, body: { code: 501 } }
      try {
        const query = (name: string) => url.searchParams.get(name) ?? undefined
        const result = await route.handler({ runtime: 'node', method: options.method || 'GET', body: async () => options.body, query, queryRaw: query, params: route.params, token: options.token, sessionConfigured: true, service: async () => service, capabilities: service.getCapabilities() })
        return { status: result.status, body: result.body, cookie: result.headers['set-cookie'] }
      } catch (error) {
        const response = qqCore.failureResponse(error)
        return { status: response.status, body: await response.json() }
      }
    },
    close() { closed = true; for (const listener of listeners) listener.close(); listeners.clear() }
  }
}
