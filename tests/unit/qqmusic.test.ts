import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MusicError } from '../../src/shared/errors'
import { QqMusicProvider } from '../../src/main/qqmusic-provider'
import { createQqMusicFixture } from '../../src/main/qqmusic-fixtures'
import { createQqMusicRuntime, type QqMusicTransport } from '../../src/main/qqmusic-runtime'

const credential = 'qqmusic_session=fixture-qq-session'
async function loggedIn(transport = createQqMusicFixture('http://127.0.0.1:12345/sample.wav')) {
  const provider = new QqMusicProvider(transport)
  const login = await provider.validateSession(credential)
  provider.setSession(login.cookie, login.user)
  return provider
}
afterEach(() => vi.restoreAllMocks())

describe('QQ music provider', () => {
  it('validates candidates without changing the active account', async () => {
    const provider = new QqMusicProvider(createQqMusicFixture())
    const result = await provider.validateSession(credential)
    expect(result.user).toMatchObject({ id: '84', nickname: 'QQ测试听众' })
    await expect(provider.library('likes', 0)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    await expect(provider.validateSession('MUSIC_U=fixture')).rejects.toMatchObject({ code: 'AUTH_EXPIRED' })
  })
  it('uses short opaque QR handles and the QQ Music app channel', async () => {
    const fixture = createQqMusicFixture('', 'success'), request = vi.spyOn(fixture, 'request')
    const provider = new QqMusicProvider(fixture)
    const qr = await provider.qrStart()
    expect(qr.key).toMatch(/^[a-f0-9-]{36}$/)
    expect(qr.dataUrl).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(request).toHaveBeenCalledWith('/login/qr/key', expect.objectContaining({ query: { channel: 'qqmusic' } }))
    expect(await provider.qrCheck(qr.key)).toMatchObject({ state: 'success', cookie: credential, user: { id: '84' } })
    await expect(provider.library('likes', 0)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })
  it('cannot finish a cancelled QR or use it to switch the account', async () => {
    const provider = new QqMusicProvider(createQqMusicFixture('', 'success'))
    const qr = await provider.qrStart()
    provider.qrCancel(qr.key)
    expect(await provider.qrCheck(qr.key)).toEqual({ state: 'expired' })
  })
  it('returns QQ references throughout recommendations, search, detail and lyrics', async () => {
    const provider = await loggedIn()
    const search = await provider.search('晚风', 'song', 0)
    expect(search.tracks).toHaveLength(6)
    expect(search.tracks[0]).toMatchObject({ provider: 'qq', id: 'QqSong1001', artists: [{ provider: 'qq', id: 'QqArtist301' }], album: { id: 'QqAlbum201' } })
    expect((await provider.home('recommended')).collections[0]).toMatchObject({ provider: 'qq', id: '902' })
    expect((await provider.detail('album', 'QqAlbum201', 0)).tracks).toHaveLength(6)
    expect((await provider.lyrics('QqSong1001')).translated).toContain('QQ歌词译文')
    expect((await provider.comments('QqSong1001', 0)).hot[0]).toMatchObject({ content: 'QQ音乐也有好心情。', time: 1700000000000 })
  })
  it('adapts the upstream 10-item search pages to existing 30-item offset pages', async () => {
    const calls: number[] = []
    const transport: QqMusicTransport = { async request(_path, options) {
      const page = Number(options?.query?.page); calls.push(page)
      const start = (page - 1) * 10
      return { status: 200, body: { code: 200, items: Array.from({ length: 10 }, (_, index) => ({ mid: `Song${start + index}`, title: 'song', album: {}, singer: [] })), total: 80, more: page < 8 } }
    } }
    const result = await new QqMusicProvider(transport).search('song', 'song', 30)
    expect(calls).toEqual([4, 5, 6])
    expect(result.tracks).toHaveLength(30)
    expect([result.tracks[0].id, result.tracks.at(-1)?.id]).toEqual(['Song30', 'Song59'])
  })
  it('uses account-specific likes, collections and editable playlists', async () => {
    const provider = await loggedIn()
    expect((await provider.library('likes', 0)).likedIds).toEqual(['QqSong1001'])
    await provider.like('QqSong1002', true)
    expect((await provider.library('likes', 0)).likedIds).toEqual(['QqSong1001', 'QqSong1002'])
    expect((await provider.writablePlaylists(0)).collections[0]).toMatchObject({ id: '901', owned: true })
    expect(await provider.addToPlaylist('901', 'QqSong1001')).toEqual({ alreadyPresent: false })
    expect(await provider.addToPlaylist('901', 'QqSong1001')).toEqual({ alreadyPresent: true })
    expect(await provider.subscribe('playlist', '902', true)).toEqual({ subscribed: true, confirmed: true })
    expect(await provider.subscribe('album', 'QqAlbum201', true)).toEqual({ subscribed: true, confirmed: true })
    expect((await provider.library('albums', 0)).collections[0]).toMatchObject({ provider: 'qq', id: 'QqAlbum201', subscribed: true })
  })
  it('normalizes the QQ Lite singer search schema rather than treating singerMID as a numeric ID', async () => {
    const provider = new QqMusicProvider({ async request() { return { status: 200, body: { code: 200, items: [{ singerMID: 'SingerMidA1', singerName: '示例歌手', singerPic: 'http://y.qq.com/singer.jpg', songNum: 20 }], total: 1, more: false } } } })
    expect((await provider.search('示例', 'artist', 0)).collections[0]).toMatchObject({ provider: 'qq', id: 'SingerMidA1', title: '示例歌手', coverUrl: 'https://y.qq.com/singer.jpg', trackCount: 20 })
  })
  it('keeps an uncertain subscription read-only until an explicit status refresh', async () => {
    const fixture = createQqMusicFixture()
    let writes = 0
    const provider = await loggedIn({ async request(path, options) {
      if (path === '/user/playlist/subscribe') { writes++; throw new MusicError('NETWORK', 'Synthetic interrupted response') }
      return fixture.request(path, options)
    } })
    expect(await provider.subscribe('playlist', '902', true)).toEqual({ subscribed: null, confirmed: false })
    expect(await provider.subscribe('playlist', '902', true)).toEqual({ subscribed: null, confirmed: false })
    expect(writes).toBe(1)
    expect(await provider.subscription('playlist', '902')).toEqual({ subscribed: false, confirmed: true })
    await provider.subscribe('playlist', '902', true)
    expect(writes).toBe(2)
  })
  it('maps numeric charts without passing their IDs to playlist writes', async () => {
    const provider = await loggedIn()
    const charts = await provider.home('charts')
    expect(charts.collections[0].id).toBe('top_26')
    expect((await provider.detail('playlist', 'top_26', 0)).tracks).toHaveLength(6)
    await expect(provider.subscribe('playlist', 'top_26', true)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  })
  it('resolves through the QQ account, reports actual quality and refuses unavailable modes', async () => {
    const provider = await loggedIn()
    expect(await provider.resolve('QqSong1001', 'higher')).toMatchObject({ url: 'http://127.0.0.1:12345/sample.wav', quality: 'exhigh', format: 'wav', trial: false })
    await expect(provider.resolve('QqSong1001', 'hires')).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await expect(provider.radio({ mode: 'SCENE_RCMD', scene: 'FOCUS' })).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await expect(provider.dislike('QqSong1001')).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect((await provider.radio({ mode: 'FM' }))[0].provider).toBe('qq')
  })
  it('uses the QQ public catalog when authenticated search succeeds with an empty page', async () => {
    const fixture = createQqMusicFixture(), calls: string[] = []
    const provider = await loggedIn({ async request(path, options) {
      if (path === '/search') {
        calls.push(options?.token || 'public')
        if (options?.token) return { status: 200, body: { code: 200, items: [], total: 0, more: false } }
      }
      return fixture.request(path, options)
    } })
    const result = await provider.search('晚风', 'song', 0)
    expect(result.tracks).toHaveLength(6)
    expect(result.tracks.every(track => track.provider === 'qq')).toBe(true)
    expect(calls).toEqual(['fixture-qq-session', 'public'])
    expect(await provider.library('likes', 0)).toMatchObject({ likedIds: ['QqSong1001'] })
  })
  it('keeps public QQ search pagination working beyond the first page', async () => {
    const fixture = createQqMusicFixture(), pages: number[] = []
    const provider = await loggedIn({ async request(path, options) {
      if (path !== '/search') return fixture.request(path, options)
      if (options?.token) return { status: 200, body: { code: 200, items: [], total: 0, more: false } }
      const page = Number(options?.query?.page); pages.push(page)
      return { status: 200, body: { code: 200, items: Array.from({ length: 10 }, (_, index) => ({ mid: `Song${(page - 1) * 10 + index}`, title: '示例', singer: [], album: {} })), total: 50, more: page < 5 } }
    } })
    const result = await provider.search('示例', 'song', 30)
    expect(pages).toEqual([4, 5])
    expect(result.tracks.map(track => track.id)).toEqual(Array.from({ length: 20 }, (_, index) => `Song${30 + index}`))
  })
  it('tries lower QQ qualities and reports the actual stream when high quality is unavailable', async () => {
    const fixture = createQqMusicFixture(), qualities: unknown[] = []
    const provider = await loggedIn({ async request(path, options) {
      if (path.startsWith('/getMusicPlay/')) {
        qualities.push(options?.query?.quality)
        const available = options?.query?.quality === '128'
        return { status: 200, body: { data: { playUrl: { QqSong1001: available ? { url: 'https://example.com/sample.mp3', error: false } : { url: '', error: '暂无播放链接', restriction: { key: 'url_unavailable' } } } } } }
      }
      return fixture.request(path, options)
    } })
    expect(await provider.resolve('QqSong1001', 'lossless')).toMatchObject({ url: 'https://example.com/sample.mp3', quality: 'standard', bitrate: 128000, format: 'mp3', trial: false })
    expect(qualities).toEqual(['flac', '320', '128'])
  })
  it('does not report a missing QQ URL as confirmed copyright or membership denial', async () => {
    const fixture = createQqMusicFixture(), qualities: unknown[] = []
    const provider = await loggedIn({ async request(path, options) {
      if (path.startsWith('/getMusicPlay/')) {
        qualities.push(options?.query?.quality)
        return { status: 200, body: { data: { playUrl: { QqSong1001: { url: '', error: '暂无播放链接', restriction: { key: 'url_unavailable' } } } } } }
      }
      return fixture.request(path, options)
    } })
    await expect(provider.resolve('QqSong1001', 'exhigh')).rejects.toMatchObject({ code: 'UNAVAILABLE', message: expect.stringContaining('原因尚未确认') })
    expect(qualities).toEqual(['320', '128', 'm4a'])
  })
  it('stops quality fallback after an account change', async () => {
    const fixture = createQqMusicFixture(), qualities: unknown[] = []
    let provider: QqMusicProvider
    provider = await loggedIn({ async request(path, options) {
      if (path.startsWith('/getMusicPlay/')) {
        qualities.push(options?.query?.quality); provider.setSession('', null)
        return { status: 200, body: { data: { playUrl: {} } } }
      }
      return fixture.request(path, options)
    } })
    await expect(provider.resolve('QqSong1001', 'lossless')).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
    expect(qualities).toEqual(['flac'])
  })
  it('rejects a pending response after an account change', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const transport: QqMusicTransport = { async request() { await pending; return { status: 200, body: { code: 200, items: [], total: 0 } } } }
    const provider = new QqMusicProvider(transport)
    const search = provider.search('old', 'song', 0)
    provider.setSession('', null); release()
    await expect(search).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
  })
  it.each(['/getSongInfo/QqSong1001', '/login/refresh'])('never writes to a new account after a delayed %s', async delayedPath => {
    const fixture = createQqMusicFixture()
    let release!: () => void, entered!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    const posts: string[] = []
    const onCredentials = vi.fn()
    const transport: QqMusicTransport = { async request(path, options) {
      if (path === delayedPath) { entered(); await waiting }
      if (options?.method === 'POST' && path !== '/login/refresh') posts.push(path)
      return fixture.request(path, options)
    } }
    const provider = new QqMusicProvider(transport, { onCredentials })
    const session = await provider.validateSession(credential)
    provider.setSession(session.cookie, session.user)
    const operation = provider.like('QqSong1001', true)
    const rejected = expect(operation).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
    await started
    provider.setSession('qqmusic_session=second-account', { id: '85', nickname: '另一账号', avatarUrl: '' })
    release(); await rejected
    expect(posts).toEqual([])
    expect(onCredentials).not.toHaveBeenCalled()
  })
  it('retries profile validation after QR authorization without consuming the QR event again', async () => {
    const fixture = createQqMusicFixture('', 'success')
    let profileAttempts = 0, checks = 0
    const provider = new QqMusicProvider({ async request(path, options) {
      if (path === '/login/status' && ++profileAttempts === 1) throw new Error('temporary connection failure')
      if (path === '/login/qr/check') checks++
      return fixture.request(path, options)
    } })
    const qr = await provider.qrStart()
    await expect(provider.qrCheck(qr.key)).rejects.toMatchObject({ code: 'NETWORK' })
    expect(await provider.qrCheck(qr.key)).toMatchObject({ state: 'success', user: { id: '84' } })
    expect(checks).toBe(1)
  })
  it('does not interpret an upstream rejection as a successful empty catalogue', async () => {
    const provider = new QqMusicProvider({ async request() { return { status: 200, body: { response: { code: 500003, data: {} } } } } })
    await expect(provider.detail('album', 'QqAlbum201', 0)).rejects.toMatchObject({ code: 'UPSTREAM' })
  })
})

it('composes the local QQ runtime without a listening HTTP service or upstream login request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'libitum-qq-runtime-'))
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected upstream access'))
  const runtime = await createQqMusicRuntime(directory)
  try {
    const reply = await runtime.request('/login/channels')
    expect(reply.status).toBe(200)
    expect(reply.body.data.channels).toContain('qqmusic')
    expect(fetcher).not.toHaveBeenCalled()
    const seedPath = join(directory, 'qqmusic-device.json')
    expect((await stat(seedPath)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(seedPath, 'utf8')).data.seed).toMatch(/^[a-f0-9]{64}$/)
  } finally { runtime.close?.(); await rm(directory, { recursive: true, force: true }) }
})

it.skipIf(process.env.LIBITUM_QQ_PUBLIC_SMOKE !== '1')('checks QQ public search, recommendations, details and lyrics without credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'libitum-qq-public-'))
  const runtime = await createQqMusicRuntime(directory)
  try {
    const provider = new QqMusicProvider(runtime)
    const result = await provider.search('周杰伦', 'song', 0)
    expect(result.tracks.length).toBeGreaterThan(0)
    expect(result.tracks.every(track => track.provider === 'qq')).toBe(true)
    const home = await provider.home('recommended')
    expect(home.collections.length).toBeGreaterThan(0)
    expect((await provider.detail('playlist', home.collections[0].id, 0)).tracks.length).toBeGreaterThan(0)
    expect((await provider.lyrics(result.tracks[0].id)).original.length).toBeGreaterThan(0)
    expect((await provider.home('charts')).collections.length).toBeGreaterThan(0)
    expect((await provider.home('newAlbums')).collections.length).toBeGreaterThan(0)
    for (const kind of ['album', 'artist', 'playlist'] as const) {
      const found = await provider.search('周杰伦', kind, 0)
      expect(found.collections.length).toBeGreaterThan(0)
      const detail = await provider.detail(kind, found.collections[0].id, 0)
      expect(detail.tracks.length).toBeGreaterThan(0)
      if (kind === 'artist') expect((await provider.artistAlbums(found.collections[0].id, 0)).albums.length).toBeGreaterThan(0)
    }
  } finally { runtime.close?.(); await rm(directory, { recursive: true, force: true }) }
}, 60000)


it.skipIf(process.env.LIBITUM_QQ_QR_SMOKE !== '1')('opens an actual QQ Music app QR and MQTT waiting session without scanning', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'libitum-qq-qr-'))
  const runtime = await createQqMusicRuntime(directory)
  const provider = new QqMusicProvider(runtime)
  try {
    const qr = await provider.qrStart()
    expect(qr.dataUrl).toMatch(/^data:image\//)
    expect(await provider.qrCheck(qr.key)).toEqual({ state: 'waiting' })
    provider.qrCancel(qr.key)
  } finally { runtime.close?.(); await rm(directory, { recursive: true, force: true }) }
}, 60000)
