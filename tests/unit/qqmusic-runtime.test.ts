import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createQqSessionResolver, qqCore } from '../../src/main/qqmusic-core'
import { createQqMusicRuntime } from '../../src/main/qqmusic-runtime'

const seed = '1'.repeat(64)
async function sampleSession(expiresAt = Date.now() + 86400000) {
  return {
    credential: { musicid: 84, musickey: 'synthetic-credential', loginType: 6, refresh_key: 'synthetic-refresh' },
    device: { ...await qqCore.deriveAndroidDevice(seed), qimei: 'synthetic-qimei', qimei36: 'synthetic-qimei36', sessionUid: 'synthetic-uid', sessionSid: 'synthetic-sid', sessionVkey: 'synthetic-vkey' },
    expiresAt
  }
}
afterEach(() => vi.restoreAllMocks())

describe('QQ native session device', () => {
  it('restores the exact bootstrapped device after a process restart without exposing it in plaintext', async () => {
    const session = await sampleSession()
    const token = await createQqSessionResolver(seed).issue(session)
    const restored = await createQqSessionResolver(seed).resolve(token)
    expect(restored?.device).toEqual(session.device)
    expect(restored?.credential.musickey).toBe(session.credential.musickey)
    for (const value of [session.credential.musickey, session.device.qimei, session.device.sessionSid]) expect(token).not.toContain(value)
    expect(await createQqSessionResolver('2'.repeat(64)).resolve(token)).toBeNull()
    expect(await createQqSessionResolver(seed).resolve(token.slice(0, -10))).toBeNull()
  })
  it('requires a new scan for old sessions that discarded the login device', async () => {
    const legacy = qqCore.createSealedSessionResolver({ secrets: { current: seed } })
    const token = await legacy.issue(await sampleSession())
    expect(await createQqSessionResolver(seed).resolve(token)).toBeNull()
  })
  it('renews credentials with the login device and retains that device in the rotated session', async () => {
    const session = await sampleSession(Date.now() + 60000)
    const resolver = createQqSessionResolver(seed), token = await resolver.issue(session)
    const refresh = vi.fn(async () => ({ ...session.credential, musickey: 'synthetic-renewed', expired_at: Math.floor(Date.now() / 1000) + 86400 }))
    const result = await resolver.rotate(token, refresh)
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ device: session.device }))
    expect(result?.rotated).toBe(true)
    const restored = await createQqSessionResolver(seed).resolve(result!.token)
    expect(restored?.device).toEqual(session.device)
    expect(restored?.credential.musickey).toBe('synthetic-renewed')
  })
  it('sends the same bootstrapped identity through real search and playback route handlers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'libitum-qq-native-'))
    const runtime = await createQqMusicRuntime(directory)
    try {
      const saved = JSON.parse(await readFile(join(directory, 'qqmusic-device.json'), 'utf8'))
      const session = await sampleSession(), token = await createQqSessionResolver(saved.data.seed).issue(session)
      const requests: any[] = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const request = JSON.parse(String(init?.body)); requests.push(request)
        const data = request.req_0.method === 'DoSearchForQQMusicLite'
          ? { code: 0, body: { item_song: [{ mid: 'Song1', title: '示例' }] }, meta: { sum: 1, nextpage: 0 } }
          : { midurlinfo: [{ songmid: 'Song1', purl: 'M500Song1Media1.mp3' }], sip: ['https://example.com/'] }
        return Response.json({ code: 0, req_0: { code: 0, data } })
      })
      const search = await runtime.request('/search', { query: { keyword: '示例', type: 'song' }, token })
      expect(search.status).toBe(200); expect(search.body.items).toHaveLength(1)
      const play = await runtime.request('/getMusicPlay/Song1', { query: { quality: '128', mediaId: 'Media1' }, token })
      expect(play.body.data.playUrl.Song1.url).toBe('https://example.com/M500Song1Media1.mp3')
      expect(requests).toHaveLength(2)
      for (const request of requests) expect(request.comm).toMatchObject({ QIMEI: session.device.qimei, QIMEI36: session.device.qimei36, uid: session.device.sessionUid, sid: session.device.sessionSid })
      expect(requests[1].req_0.param.filename).toEqual(['M500Song1Media1.mp3'])
    } finally { runtime.close?.(); await rm(directory, { recursive: true, force: true }) }
  })
})

it.skipIf(process.env.LIBITUM_QQ_SEARCH_SMOKE !== '1')('reads a real QQ public search page through the native runtime', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'libitum-qq-search-'))
  const runtime = await createQqMusicRuntime(directory)
  try {
    const result = await runtime.request('/search', { query: { keyword: '周杰伦', type: 'song', page: 1, limit: 10 } })
    expect(result).toMatchObject({ status: 200 })
    expect(result.body.items.length).toBeGreaterThan(0)
    expect(result.body.items.every((song: any) => typeof song.mid === 'string' && song.mid.length > 0)).toBe(true)
  } finally { runtime.close?.(); await rm(directory, { recursive: true, force: true }) }
}, 35000)
