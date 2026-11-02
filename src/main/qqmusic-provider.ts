import { randomUUID } from 'node:crypto'
import { MusicError } from '../shared/errors'
import type { Album, Collection, CollectionKind, CommentPage, Detail, Diagnostic, HomeResult, HomeSection, LibraryKind, LibraryResult, Lyrics, MusicComment, Playlist, Quality, RadioSpec, SearchKind, SearchResult, Stream, SubscriptionResult, Track, User } from '../shared/types'
import type { MusicProvider } from './provider'
import type { QqMusicRequest, QqMusicResponse, QqMusicTransport } from './qqmusic-runtime'

type Raw = Record<string, any>
const list = (value: unknown): Raw[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : []
const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const safeUrl = (value: unknown): string => { try { const url = new URL(text(value).replace(/^http:/, 'https:')); return url.protocol === 'https:' ? url.href : '' } catch { return '' } }
const midOf = (raw: Raw): string => text(raw.mid || raw.songmid || raw.songMid)
const tokenOf = (cookie: string): string => cookie.match(/(?:^|;\s*)qqmusic_session=([^;\s]+)/)?.[1] || ''
const sessionCookie = (token: string) => `qqmusic_session=${token}`
const albumCover = (mid: string) => mid ? `https://y.qq.com/music/photo_new/T002R300x300M000${encodeURIComponent(mid)}.jpg` : ''
const singerCover = (mid: string) => mid ? `https://y.qq.com/music/photo_new/T001R300x300M000${encodeURIComponent(mid)}.jpg` : ''
const safeId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id)
const unsupported = (message: string): never => { throw new MusicError('UNSUPPORTED', message) }

export interface QqMusicProviderOptions { onCredentials?: (cookie: string, user: User) => void }

/** QQ-specific fields and session tokens stay behind the existing music-provider interface. */
export class QqMusicProvider implements MusicProvider {
  private cookie = ''
  private user: User | null = null
  private generation = 0
  private qr: { key: string; upstream: string; expiresAt: number; candidate?: string } | null = null
  private qrStarting: Promise<{ key: string; dataUrl: string }> | null = null
  private qrChecking: { key: string; promise: ReturnType<QqMusicProvider['checkQr']> } | null = null
  private qrStartAfter = 0
  private refreshAt = 0
  private refreshing: Promise<void> | null = null
  private rawTracks = new Map<string, Raw>()
  private collections = new Map<string, Collection>()
  private playlistMeta = new Map<string, Raw>()
  private liked: string[] | null = null
  private likedReading: Promise<string[]> | null = null
  private diagnosticRecords: Diagnostic[] = []
  private writes = new Map<string, Promise<any>>()
  private uncertain = new Set<string>()

  constructor(private transport: QqMusicTransport, private options: QqMusicProviderOptions = {}) {}
  setSession(cookie: string, user: User | null) {
    if (this.qr) this.qrCancel(this.qr.key)
    this.generation++; this.cookie = user ? cookie : ''; this.user = user
    this.refreshAt = 0; this.refreshing = null; this.rawTracks.clear(); this.collections.clear(); this.playlistMeta.clear(); this.liked = null; this.likedReading = null; this.diagnosticRecords = []; this.writes.clear(); this.uncertain.clear()
  }
  diagnostics() { return this.diagnosticRecords.slice() }
  private requireUser() { if (!this.user) throw new MusicError('AUTH_REQUIRED', '请先登录 QQ 音乐账号。'); return this.user }
  private current(generation: number) { if (generation !== this.generation) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新加载。') }
  private error(reply: QqMusicResponse): MusicError {
    const body = reply.body, status = reply.status, key = text(body.errorKey)
    const code = Number(body.upstreamCode)
    if (status === 401 || key.startsWith('auth.credential')) return new MusicError('AUTH_EXPIRED', 'QQ 音乐登录已失效，请重新扫码。', code)
    if (status === 429 || /rate-limited/.test(key)) return new MusicError('RATE_LIMITED', 'QQ 音乐操作过于频繁，请稍后重试。', code)
    if (/device-limit/.test(key)) return new MusicError('RISK_BLOCKED', 'QQ 音乐登录设备已达上限，请在官方 App 管理设备后重新扫码。', code)
    if (/account-|login-rejected/.test(key) || status === 403) return new MusicError('ACCESS_DENIED', 'QQ 音乐拒绝了本次操作，请在官方 App 检查账号状态。', code)
    if (status === 501) return new MusicError('UNSUPPORTED', 'QQ 音乐当前接口暂不支持此功能。', code)
    if (status === 422) return new MusicError('UNAVAILABLE', 'QQ 音乐暂未返回可用内容，请稍后重试。', code)
    if (status === 400 || status === 405) return new MusicError('INVALID_REQUEST', 'QQ 音乐请求参数无效，请刷新页面后重试。', code)
    if (key.startsWith('network.') || key === 'upstream.http' || status >= 500 && !key && !body.response) return new MusicError('NETWORK', 'QQ 音乐服务暂时无法连接，请稍后重试。', code)
    return new MusicError('UPSTREAM', 'QQ 音乐未能完成本次操作，请稍后重试。', code)
  }
  private checkReply(reply: QqMusicResponse) {
    const body = reply.body
    if (reply.status >= 400 || body.code !== undefined && ![0, 200, 800, 801, 802, 803].includes(Number(body.code))) throw this.error(reply)
    if (body.response && typeof body.response === 'object') {
      const response = body.response
      if (response.code !== undefined && Number(response.code) !== 0) throw this.error({ ...reply, status: 502 })
      for (const name of ['singer', 'songinfo']) if (response[name]?.code !== undefined && Number(response[name].code) !== 0) throw this.error({ ...reply, status: 502 })
    }
    return body
  }
  private async request(path: string, options: QqMusicRequest = {}, auth = false): Promise<Raw> {
    if (auth) this.requireUser()
    const generation = this.generation
    const token = options.token ?? tokenOf(this.cookie)
    const retryRead = (!options.method || options.method === 'GET') && !path.startsWith('/login/') && path !== '/logout'
    for (let attempt = 0; ; attempt++) {
      try {
        this.current(generation)
        const reply = await this.transport.request(path, { ...options, ...(token ? { token } : {}) })
        this.current(generation)
        return this.checkReply(reply)
      } catch (error) {
        this.current(generation)
        const safe = error instanceof MusicError ? error : new MusicError('NETWORK', 'QQ 音乐服务暂时无法连接，请稍后重试。')
        // Only transient reads get one retry; authentication exchanges and writes never repeat.
        if (retryRead && attempt === 0 && safe.code === 'NETWORK') continue
        throw safe
      }
    }
  }
  private async refresh() {
    if (!this.user || Date.now() < this.refreshAt) return
    if (this.refreshing) return this.refreshing
    const generation = this.generation, token = tokenOf(this.cookie)
    this.refreshAt = Date.now() + 600000
    const operation = (async () => {
      try {
        const body = await this.request('/login/refresh', { method: 'POST', token }, true)
        const next = text(body.data?.token)
        if (next && body.data?.rotated && generation === this.generation && this.user && tokenOf(this.cookie) === token) {
          this.cookie = sessionCookie(next); this.options.onCredentials?.(this.cookie, this.user)
        }
      } catch (error) { if (error instanceof MusicError && ['AUTH_EXPIRED', 'SESSION_CHANGED'].includes(error.code)) throw error }
    })().finally(() => { if (this.refreshing === operation) this.refreshing = null })
    this.refreshing = operation
    return operation
  }
  private async account(path: string, options: QqMusicRequest = {}) { const generation = this.generation; this.requireUser(); await this.refresh(); this.current(generation); return this.request(path, options, true) }
  async validateSession(cookie: string): Promise<{ user: User; cookie: string }> {
    const token = tokenOf(cookie)
    if (!token) throw new MusicError('AUTH_EXPIRED', 'QQ 音乐会话无效，请在应用内重新扫码。')
    const body = await this.request('/login/status', { token })
    const profile = body.data?.profile
    const id = text(profile?.str_musicid || profile?.musicid || profile?.uin || profile?.userId)
    if (!id || !/^\d+$/.test(id)) throw new MusicError('AUTH_EXPIRED', 'QQ 音乐会话无效或已过期，请重新扫码。')
    const info = profile.info || profile
    return { cookie: sessionCookie(token), user: { id, nickname: text(info.nick || info.nickname || profile.nickname) || 'QQ 音乐用户', avatarUrl: safeUrl(info.logo || info.avatar || info.headpic || profile.avatarUrl) || `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(id)}&s=100` } }
  }
  qrStart(): Promise<{ key: string; dataUrl: string }> {
    if (this.qrStarting) return this.qrStarting
    if (Date.now() < this.qrStartAfter) return Promise.reject(new MusicError('LOGIN_COOLDOWN', '请稍等片刻再生成二维码，避免频繁登录。'))
    if (this.qr) this.qrCancel(this.qr.key)
    this.qrStartAfter = Date.now() + 10000
    const generation = this.generation
    this.qrStarting = (async () => {
      const body = await this.request('/login/qr/key', { query: { channel: 'qqmusic' }, token: '' })
      const upstream = text(body.data?.unikey)
      if (!upstream) throw new MusicError('UPSTREAM', 'QQ 音乐二维码创建失败，请重试。')
      const image = await this.request('/login/qr/create', { query: { key: upstream }, token: '' })
      this.current(generation)
      const dataUrl = text(image.data?.qrimg)
      if (!/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,/.test(dataUrl)) throw new MusicError('UPSTREAM', 'QQ 音乐二维码图片无效，请重试。')
      const key = randomUUID()
      this.qr = { key, upstream, expiresAt: Date.now() + 180000 }
      return { key, dataUrl }
    })().finally(() => { this.qrStarting = null })
    return this.qrStarting
  }
  qrCancel(key: string) {
    const qr = this.qr
    if (!qr || qr.key !== key) return
    this.qr = null
    void this.transport.request('/login/qr/cancel', { query: { key: qr.upstream }, token: '' }).catch(() => {})
  }
  qrCheck(key: string) {
    if (this.qrChecking?.key === key) return this.qrChecking.promise
    const promise = this.checkQr(key).finally(() => { if (this.qrChecking?.promise === promise) this.qrChecking = null })
    this.qrChecking = { key, promise }; return promise
  }
  private async checkQr(key: string): Promise<{ state: 'waiting' | 'confirm' | 'expired' } | { state: 'success'; cookie: string; user: User }> {
    const qr = this.qr
    if (!qr || qr.key !== key || qr.expiresAt <= Date.now()) { if (qr) this.qrCancel(qr.key); return { state: 'expired' } }
    if (qr.candidate) return this.finishQr(qr, qr.candidate)
    const body = await this.request('/login/qr/check', { query: { key: qr.upstream }, token: '' })
    if (this.qr !== qr) return { state: 'expired' }
    const code = Number(body.code)
    if (code === 801) return { state: 'waiting' }
    if (code === 802) return { state: 'confirm' }
    if (code === 800) { this.qrCancel(key); if (body.failureHint?.key || body.upstreamErrorKey) throw this.error({ status: 502, body: { ...body, errorKey: body.upstreamErrorKey || body.failureHint.key } }); return { state: 'expired' } }
    if (code !== 803) throw new MusicError('UPSTREAM', 'QQ 音乐扫码状态异常，请重新生成二维码。')
    qr.candidate = text(body.cookie)
    return this.finishQr(qr, qr.candidate)
  }
  private async finishQr(qr: NonNullable<QqMusicProvider['qr']>, cookie: string): Promise<{ state: 'expired' } | { state: 'success'; cookie: string; user: User }> {
    const validated = await this.validateSession(cookie)
    if (this.qr !== qr) return { state: 'expired' }
    this.qrCancel(qr.key)
    return { state: 'success', ...validated }
  }
  private track(raw: Raw): Track {
    raw = raw.musicData || raw.songInfo || raw.songinfo || raw
    const id = midOf(raw)
    if (!safeId(id)) throw new MusicError('UPSTREAM', 'QQ 音乐返回了无效的歌曲标识。')
    this.rawTracks.set(id, raw)
    const album = raw.album || {}, albumMid = text(album.mid || raw.albummid || raw.albumMid)
    return { provider: 'qq', id, title: text(raw.title || raw.name || raw.songname) || '未知歌曲', durationMs: Math.max(0, Number(raw.interval || raw.duration || 0) * 1000), coverUrl: safeUrl(raw.coverUrl || raw.cover) || albumCover(albumMid), artists: list(raw.singer || raw.singers || raw.ar).map(singer => { const mid = text(singer.mid || singer.singermid || singer.id); return { provider: 'qq' as const, id: mid, name: text(singer.name || singer.singername) || '未知歌手', coverUrl: singerCover(mid) } }), album: { id: albumMid, title: text(album.title || album.name || raw.albumname || raw.albumName) || '未知专辑' } }
  }
  private tracks(value: unknown) { return list(value).map(raw => this.track(raw)) }
  private collection(raw: Raw, kind: CollectionKind): Collection {
    const top = text(raw._topId)
    const id = top ? `top_${top}` : text(kind === 'playlist' ? raw.tid || raw.dissid || raw.disstid || raw.id : kind === 'album' ? raw.mid || raw.album_mid || raw.albummid || raw.albumMID || raw.albumMid : raw.mid || raw.singer_mid || raw.singermid || raw.singerMID)
    if (!safeId(id)) throw new MusicError('UPSTREAM', 'QQ 音乐返回了无效的内容标识。')
    const creator = raw.creator || {}, singers = list(raw.singers || raw.singer)
    const owned = kind === 'playlist' && (raw.owned === true || Number(raw.dirId ?? raw.dirid) > 0 && Number(raw.dirId ?? raw.dirid) < 200)
    const previous = this.collections.get(`${kind}:${id}`)
    const result: Collection = { provider: 'qq', id, kind, title: text(raw.title || raw.name || raw.dissname || raw.album_name || raw.albumName || raw.singername || raw.singerName) || previous?.title || 'QQ 音乐', coverUrl: safeUrl(raw.picurl || raw.cover || raw.logo || raw.pic || raw.coverUrl || raw.singerPic) || (kind === 'album' ? albumCover(id) : kind === 'artist' ? singerCover(id) : '') || previous?.coverUrl || '', description: text(raw.desc || raw.description || raw.intro || raw.subtitle), creatorName: text(creator.nick || creator.name || creator.nickname || raw.creatorName || raw.nickname || (typeof raw.singer === 'string' ? raw.singer : '')) || singers.map(singer => text(singer.name)).join(' / ') || (top ? 'QQ 音乐排行榜' : kind === 'playlist' ? 'QQ 音乐歌单' : ''), trackCount: Number(raw.songnum || raw.song_cnt || raw.songNum || raw.total_song_num || raw.total || raw.trackCount || 0), subscribed: Boolean(raw.subscribed ?? previous?.subscribed), owned }
    this.collections.set(`${kind}:${id}`, result)
    if (kind === 'playlist' && !top) this.playlistMeta.set(id, raw)
    return result
  }
  async search(keywords: string, kind: SearchKind, offset: number): Promise<SearchResult> {
    const generation = this.generation, items: Raw[] = [], skip = offset % 10
    let total = 0, page = Math.floor(offset / 10) + 1, publicSearch = false
    while (items.length < skip + 30) {
      this.current(generation)
      const query = { keyword: keywords, type: kind === 'artist' ? 'singer' : kind, page, limit: 10 }
      let body = await this.request('/search', { query, ...(publicSearch ? { token: '' } : {}) })
      // Some authenticated QQ searches return successful empty pages. Try the
      // same QQ public catalog once, then keep that identity for pagination.
      if (this.user && !publicSearch && !items.length && !list(body.items).length) {
        const fallback = await this.request('/search', { query, token: '' })
        if (list(fallback.items).length) { body = fallback; publicSearch = true }
      }
      items.push(...list(body.items)); total = Number(body.total ?? Math.max(total, (page - 1) * 10 + list(body.items).length))
      if (!body.more || !list(body.items).length) break
      page++
    }
    this.current(generation)
    const selected = items.slice(skip, skip + 30)
    return { tracks: kind === 'song' ? this.tracks(selected) : [], collections: kind === 'song' ? [] : selected.map(raw => this.collection(raw, kind)), total }
  }
  private async rawTrack(id: string): Promise<Raw> {
    const generation = this.generation
    const cached = this.rawTracks.get(id)
    if (cached && Number(cached.id || cached.songid) > 0 && cached.file?.media_mid) return cached
    const body = await this.request(`/getSongInfo/${encodeURIComponent(id)}`)
    this.current(generation)
    const track = body.response?.songinfo?.data?.track_info
    if (!track || midOf(track) !== id) throw new MusicError('UNAVAILABLE', 'QQ 音乐未返回这首歌曲的完整资料。')
    this.track(track); return track
  }
  async detail(kind: CollectionKind, id: string, offset = 0): Promise<Detail> {
    const generation = this.generation
    if (kind === 'artist') {
      const [info, songs] = await Promise.all([this.request('/singer/detail', { query: { mid: id } }), this.request('/singer/songs', { query: { mid: id, offset, limit: 100 } })])
      this.current(generation)
      const tracks = this.tracks(songs.songs)
      return { collection: this.collection(info.singer || { mid: id }, 'artist'), tracks, total: Number(songs.total ?? tracks.length) }
    }
    if (kind === 'album') {
      const body = await this.request('/getAlbumInfo', { query: { albummid: id } })
      this.current(generation)
      const album = body.response?.data
      if (!album) throw new MusicError('UNAVAILABLE', 'QQ 音乐未返回专辑内容。')
      const tracks = this.tracks(album.list || album.songlist || album.songList)
      const collection = this.collection({ ...album, mid: id }, 'album')
      if (this.user) { const status = await this.subscription('album', id); this.current(generation); collection.subscribed = status.subscribed === true }
      return { collection, tracks, total: tracks.length }
    }
    if (id.startsWith('top_')) {
      const body = await this.request('/recommend/toplist', { query: { id: id.slice(4), offset, limit: 100 } })
      this.current(generation)
      return { collection: this.collection({ ...body.toplist, _topId: id.slice(4) }, 'playlist'), tracks: this.tracks(body.songs), total: Number(body.total ?? list(body.songs).length) }
    }
    const meta = this.playlistMeta.get(id)
    if (this.user && meta && Number(meta.dirId ?? meta.dirid) > 0) {
      const body = await this.account('/user/playlist-detail', { query: { tid: id, dirid: Number(meta.dirId ?? meta.dirid), offset, limit: 100 } })
      this.current(generation)
      return { collection: this.collection(meta, 'playlist'), tracks: this.tracks(body.songs), total: Number(body.total ?? list(body.songs).length) }
    }
    const body = await this.request(`/getSongListDetail/${encodeURIComponent(id)}`)
    this.current(generation)
    const playlist = body.response?.cdlist?.[0]
    if (!playlist) throw new MusicError('UNAVAILABLE', 'QQ 音乐未返回歌单内容。')
    const collection = this.collection({ ...playlist, tid: id }, 'playlist')
    if (this.user && !collection.owned) { const status = await this.subscription('playlist', id); this.current(generation); collection.subscribed = status.subscribed === true }
    return { collection, tracks: this.tracks(list(playlist.songlist).slice(offset, offset + 100)), total: Number(playlist.total_song_num ?? list(playlist.songlist).length) }
  }
  async allTracks(kind: CollectionKind, id: string): Promise<Track[]> {
    const generation = this.generation
    const first = await this.detail(kind, id, 0)
    this.current(generation)
    const result = first.tracks.slice()
    if (kind === 'playlist' || kind === 'artist') for (let offset = 100; offset < first.total; offset += 100) { const page = await this.detail(kind, id, offset); this.current(generation); if (!page.tracks.length) break; result.push(...page.tracks) }
    return [...new Map(result.map(track => [track.id, track])).values()]
  }
  async artistAlbums(id: string, offset: number): Promise<{ albums: Album[]; more: boolean }> {
    const generation = this.generation
    const body = await this.request('/getSingerAlbum', { query: { singermid: id, page: offset, limit: 30 } })
    this.current(generation)
    const data = body.response?.singer?.data || {}, albums = list(data.list).map(raw => this.collection(raw, 'album') as Album)
    return { albums, more: typeof data.total === 'number' ? offset + albums.length < data.total : albums.length === 30 }
  }
  async home(section: HomeSection): Promise<HomeResult> {
    const generation = this.generation
    if (section === 'daily') { const body = await this.account('/user/daily-songs'); this.current(generation); return { tracks: this.tracks(body.songs), collections: [] } }
    if (section === 'recommended') { const body = this.user ? await this.account('/recommend/playlists', { query: { limit: 10 } }) : await this.request('/recommend/playlists', { query: { limit: 10 } }); this.current(generation); return { tracks: [], collections: list(body.playlists).slice(0, 10).map(raw => this.collection(raw, 'playlist')) } }
    if (section === 'charts') { const body = await this.request('/recommend/toplists'); this.current(generation); return { tracks: [], collections: list(body.groups).flatMap(group => list(group.toplists)).slice(0, 10).map(raw => this.collection({ ...raw, _topId: raw.id }, 'playlist')) } }
    const body = await this.request('/recommend/new-albums', { query: { offset: 0, limit: 10 } })
    this.current(generation)
    return { tracks: [], collections: list(body.albums).map(raw => this.collection(raw, 'album')) }
  }
  private likedIds(): Promise<string[]> {
    if (this.liked) return Promise.resolve(this.liked)
    if (this.likedReading) return this.likedReading
    const generation = this.generation
    const promise = (async () => {
      const result: string[] = []
      for (let offset = 0; ; offset += 100) {
        this.current(generation)
        const body = await this.account('/user/liked-songs', { query: { offset, limit: 100 } })
        this.current(generation)
        const songs = this.tracks(body.songs)
        result.push(...songs.map(song => song.id))
        if (!body.more || !songs.length) break
        if (offset >= 100000) throw new MusicError('UPSTREAM', 'QQ 音乐喜欢列表过大，请稍后重试。')
      }
      this.current(generation); this.liked = [...new Set(result)]; return this.liked
    })().finally(() => { if (this.likedReading === promise) this.likedReading = null })
    this.likedReading = promise; return promise
  }
  private async playlists(): Promise<{ collections: Playlist[]; more: boolean }> {
    const generation = this.generation
    const result: Playlist[] = []
    let offset = 0, more = false
    const seenOffsets = new Set<number>()
    for (;;) {
      this.current(generation)
      const body = await this.account('/user/playlist', { query: offset ? { favoriteOffset: offset } : {} })
      this.current(generation)
      for (const raw of list(body.playlist)) { if (Number(raw.dirId ?? raw.dirid) === 201 || Number(raw.dirId ?? raw.dirid) === 202) continue; result.push(this.collection(raw, 'playlist') as Playlist) }
      more = Boolean(body.more)
      const next = Number(body.nextFavoriteOffset)
      if (!more || !Number.isSafeInteger(next) || next <= offset || seenOffsets.has(next)) break
      seenOffsets.add(next); offset = next
      if (seenOffsets.size >= 1000) break
    }
    return { collections: [...new Map(result.map(item => [item.id, item])).values()], more }
  }
  async library(kind: LibraryKind, offset: number): Promise<LibraryResult> {
    this.requireUser()
    const generation = this.generation
    const likedIds = await this.likedIds()
    this.current(generation)
    if (kind === 'likes') { const body = await this.account('/user/liked-songs', { query: { offset, limit: 50 } }); this.current(generation); return { tracks: this.tracks(body.songs), collections: [], total: Number(body.total ?? likedIds.length), likedIds } }
    if (kind === 'albums') { const body = await this.account('/user/albums', { query: { offset, limit: 50 } }); this.current(generation); return { tracks: [], collections: list(body.albums).map(raw => this.collection({ ...raw, subscribed: true }, 'album')), total: Number(body.total ?? list(body.albums).length), likedIds } }
    const result = await this.playlists()
    this.current(generation)
    return { tracks: [], collections: result.collections.slice(offset, offset + 50), total: result.collections.length, likedIds }
  }
  async resolve(id: string, quality: Quality, download = false): Promise<Stream> {
    this.requireUser()
    const generation = this.generation
    if (quality === 'hires') unsupported('QQ 音乐当前接口暂不提供独立的 Hi-Res 档位，请选择无损或其他音质。')
    const raw = await this.rawTrack(id)
    this.current(generation)
    const levels = quality === 'lossless' ? ['flac', '320', '128', 'm4a'] : quality === 'standard' ? ['128', 'm4a'] : ['320', '128', 'm4a']
    let entry: Raw | undefined, level = levels[0]
    for (const candidate of levels) {
      this.current(generation)
      const body = await this.account(`/getMusicPlay/${encodeURIComponent(id)}`, { query: { quality: candidate, ...(raw.file?.media_mid ? { mediaId: text(raw.file.media_mid) } : {}) } })
      this.current(generation)
      entry = body.data?.playUrl?.[id]; level = candidate
      if (entry?.url && !entry.error && !(entry.preview && download)) break
    }
    if (!entry?.url || entry.error || entry.preview && download) {
      const hint = entry?.restriction?.hint?.key
      const message = hint === 'playback.maybe-region-restricted' ? 'QQ 音乐提示该歌曲可能存在地区限制。'
        : hint === 'playback.maybe-membership' || ['membership_required', 'purchase_required', 'entitlement_required'].includes(entry?.restriction?.key) ? 'QQ 音乐提示该歌曲可能需要会员或购买权限。'
        : 'QQ 音乐未返回可播放的音频地址，原因尚未确认。请尝试重新扫码登录。'
      throw new MusicError('UNAVAILABLE', message)
    }
    let url: URL
    try { url = new URL(entry.url) } catch { throw new MusicError('UNAVAILABLE', 'QQ 音乐音频地址无效。') }
    if (!['https:', 'http:'].includes(url.protocol)) throw new MusicError('UNAVAILABLE', 'QQ 音乐音频地址协议无效。')
    const returnedLevel = text(entry.quality) || level
    const actual = returnedLevel === 'flac' ? 'lossless' : ['128', 'm4a'].includes(returnedLevel) ? 'standard' : 'exhigh'
    const format = url.pathname.match(/\.(flac|mp3|m4a|wav|ogg|aac)(?:$|\/)/i)?.[1]?.toLowerCase() || (level === 'flac' ? 'flac' : 'mp3')
    const size = Number(returnedLevel === 'flac' ? raw.file?.size_flac : returnedLevel === '320' ? raw.file?.size_320mp3 : returnedLevel === 'm4a' ? raw.file?.size_96aac : raw.file?.size_128mp3) || 0
    return { url: url.href, quality: actual, bitrate: actual === 'lossless' ? 0 : actual === 'exhigh' ? 320000 : 128000, format, size, trial: Boolean(entry.preview) }
  }
  async lyrics(id: string): Promise<Lyrics> {
    const body = await this.request('/getLyric', { query: { songmid: id, trans: 1 } }), response = body.response || {}
    const translated = text(response.trans)
    return { original: text(response.lyric), translated: translated.startsWith('[') ? translated : (() => { try { return Buffer.from(translated, 'base64').toString('utf8') } catch { return '' } })() }
  }
  async comments(id: string, offset: number): Promise<CommentPage> {
    const generation = this.generation
    const raw = await this.rawTrack(id)
    this.current(generation)
    const numeric = Number(raw.id || raw.songid)
    if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new MusicError('UNAVAILABLE', 'QQ 音乐歌曲评论暂不可用。')
    const empty = { comments: [], total: 0, more: false }
    const read = async (path: string) => { try { return await this.request(path, { query: { id: numeric, offset: path.endsWith('/hot') ? 0 : offset, limit: 20 } }) } catch (error) { if (error instanceof MusicError && error.code === 'UNAVAILABLE') return empty; throw error } }
    const [hot, recent] = await Promise.all([offset ? Promise.resolve(empty) : read('/comment/hot'), read('/comment/new')])
    this.current(generation)
    const normalize = (raw: Raw): MusicComment => ({ id: text(raw.id), content: text(raw.content), author: text(raw.nick), avatarUrl: safeUrl(raw.avatar), time: Number(raw.time || 0) * 1000, likes: Number(raw.praiseCount || 0), replies: [] })
    return { hot: list(hot.comments).map(normalize), items: list(recent.comments).map(normalize), total: Number(recent.total ?? 0), more: Boolean(recent.more) }
  }
  async radio(spec: RadioSpec): Promise<Track[]> {
    const generation = this.generation
    if (spec.mode === 'SCENE_RCMD') unsupported('QQ 音乐当前接口不支持这些网易云场景，请使用随心听或探索模式。')
    const body = await this.account(spec.mode === 'EXPLORE' ? '/recommend/radar' : '/user/guess-you-like')
    this.current(generation)
    const tracks = this.tracks(body.songs)
    if (!tracks.length) throw new MusicError('UNAVAILABLE', 'QQ 音乐暂未返回推荐歌曲，请稍后重试。')
    return tracks
  }
  private async write<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.writes.get(key)
    if (existing) return existing
    const generation = this.generation
    const promise = operation().then(result => { this.current(generation); return result }).catch(error => {
      if (generation === this.generation) this.diagnosticRecords = [...this.diagnosticRecords.slice(-19), { operation: key.split(':')[0], endpoint: key.split(':')[0], code: error instanceof MusicError ? error.code : 'NETWORK', hasCredential: !!tokenOf(this.cookie), hasCsrf: false, time: Date.now() }]
      throw error
    }).finally(() => { if (this.writes.get(key) === promise) this.writes.delete(key) })
    this.writes.set(key, promise); return promise
  }
  async like(id: string, like: boolean) {
    this.requireUser()
    const generation = this.generation
    await this.write(`like:${id}:${like}`, async () => { const raw = await this.rawTrack(id); this.current(generation); await this.account('/user/song/like', { method: 'POST', body: { song: { id: Number(raw.id || raw.songid), mid: id, type: 0 }, liked: like } }); this.liked = null })
  }
  async writablePlaylists(offset: number) { const { collections, more } = await this.playlists(); const owned = collections.filter(item => item.owned); return { collections: owned.slice(offset, offset + 50), more: offset + 50 < owned.length || more } }
  async addToPlaylist(id: string, trackId: string) {
    this.requireUser()
    const generation = this.generation
    return this.write(`add:${id}:${trackId}`, async () => {
      const { collections } = await this.playlists()
      this.current(generation)
      if (!collections.some(item => item.id === id && item.owned)) throw new MusicError('ACCESS_DENIED', '只能向本人创建的可编辑 QQ 音乐歌单添加歌曲。')
      const tracks = await this.allTracks('playlist', id)
      this.current(generation)
      if (tracks.some(track => track.id === trackId)) return { alreadyPresent: true }
      const raw = await this.rawTrack(trackId)
      this.current(generation)
      const body = await this.account('/user/playlist/tracks', { method: 'POST', body: { tid: Number(id), op: 'add', songs: [{ songId: Number(raw.id || raw.songid), songType: 0 }] } })
      if (body.changed === false && body.verification?.status !== 'present') throw new MusicError('STATE_UNCONFIRMED', 'QQ 音乐添加结果待确认，请刷新歌单核对后再操作。')
      return { alreadyPresent: false }
    })
  }
  async subscription(kind: 'album' | 'playlist', id: string, acknowledge = true): Promise<SubscriptionResult> {
    if (id.startsWith('top_')) unsupported('QQ 音乐排行榜暂不支持作为普通歌单收藏。')
    const body = await this.account('/user/subscription-status', { query: { type: kind, ids: id } })
    const status = list(body.items).find(item => text(item.id) === id)?.status
    const confirmed = ['subscribed', 'not-subscribed'].includes(status)
    if (acknowledge && confirmed) this.uncertain.delete(`${kind}:${id}`)
    return { subscribed: status === 'subscribed' ? true : status === 'not-subscribed' ? false : null, confirmed }
  }
  async subscribe(kind: 'album' | 'playlist', id: string, subscribe: boolean): Promise<SubscriptionResult> {
    this.requireUser()
    if (id.startsWith('top_')) unsupported('QQ 音乐排行榜暂不支持作为普通歌单收藏。')
    const generation = this.generation
    return this.write(`subscribe:${kind}:${id}:${subscribe}`, async () => {
      const key = `${kind}:${id}`
      const current = await this.subscription(kind, id, false)
      this.current(generation)
      if (current.confirmed && current.subscribed === subscribe) { this.uncertain.delete(key); return current }
      if (this.uncertain.has(key)) return { subscribed: null, confirmed: false }
      if (!current.confirmed) throw new MusicError('STATE_UNKNOWN', '暂时无法确认 QQ 音乐收藏状态，请刷新后再操作。')
      try { await this.account(kind === 'album' ? '/user/album/subscribe' : '/user/playlist/subscribe', { method: 'POST', body: kind === 'album' ? { id, subscribed: subscribe } : { tid: Number(id), subscribed: subscribe } }) }
      catch (error) { if (!(error instanceof MusicError) || !['NETWORK', 'UPSTREAM'].includes(error.code)) throw error }
      this.current(generation)
      this.uncertain.add(key)
      try {
        const verified = await this.subscription(kind, id, false)
        this.current(generation)
        if (verified.confirmed && verified.subscribed === subscribe) { this.uncertain.delete(key); return verified }
      } catch (error) { if (error instanceof MusicError && ['SESSION_CHANGED', 'AUTH_EXPIRED'].includes(error.code)) throw error }
      return { subscribed: null, confirmed: false }
    })
  }
  async dislike(_id: string): Promise<void> { unsupported('QQ 音乐当前接口不支持“不感兴趣”，可以使用下一首。') }
  async scrobble(_id: string, _seconds: number): Promise<void> { unsupported('QQ 音乐当前接口不支持同步听歌时长。') }
}
