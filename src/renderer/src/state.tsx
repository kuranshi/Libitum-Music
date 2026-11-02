import { createContext, useCallback, useContext, useEffect, useRef, useState, type DependencyList, type ReactNode, type Dispatch, type SetStateAction } from 'react'
import appIcon from '../../../resources/icon.png'
import type { Bootstrap, CollectionKind, Command, CommandMap, MediaImportState, PlatformPage, ProviderId, Session, Settings, Track } from '../../shared/types'
import { PROVIDERS, PLATFORM_IDS, accountKey as scopedAccountKey, pageProvider, trackKey } from '../../shared/platforms'

export const platformName = (provider: ProviderId = 'netease') => PROVIDERS[provider]
export const accountKey = (session: Session) => scopedAccountKey(session.provider || 'netease', session.user?.id || '')
const accountRevisions: Record<ProviderId, number> = { netease: 0, qq: 0 }
export type Page = { type: 'home' } | { type: 'search'; query: string } | { type: 'detail'; provider: ProviderId; kind: CollectionKind; id: string } | { type: 'library'; kind: 'likes' | 'playlists' | 'albums' } | { type: 'daily' } | { type: 'radio'; fm: boolean } | { type: 'downloads' } | { type: 'nowPlaying' } | { type: 'settings'; section?: string }
export function platformPage(page: Page): PlatformPage | null {
  if (page.type === 'library') return page.kind
  if (page.type === 'radio') return page.fm ? 'fm' : 'radio'
  return ['home', 'search', 'daily', 'downloads'].includes(page.type) ? page.type as PlatformPage : null
}
export function providerForPage(data: Bootstrap, page: Page): ProviderId {
  if (page.type === 'detail') return page.provider
  if (page.type === 'nowPlaying') return data.player.queue[data.player.index]?.provider || pageProvider(data.settings, 'home')
  return pageProvider(data.settings, platformPage(page) || 'home')
}
export async function request<K extends Command>(command: K, args?: CommandMap[K]['args']): Promise<CommandMap[K]['result']> {
  if (!window.music) throw new Error('请通过桌面应用启动Libitum music。')
  const provider = (args as any)?.provider as ProviderId | undefined
  const revision = provider ? accountRevisions[provider] : 0
  const result = await window.music.invoke(command, args)
  if (provider && revision !== accountRevisions[provider] && /^(catalog\.|home\.|library\.)/.test(command)) throw Object.assign(new Error('账号状态已改变，请重新加载。'), { code: 'SESSION_CHANGED', provider })
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code, upstreamCode: result.error.upstreamCode, provider })
  if (command === 'player.seek') window.dispatchEvent(new Event('music:seek'))
  return result.data
}
const ProviderContext = createContext<ProviderId | null>(null)
export function PlatformScope({ provider, children }: { provider: ProviderId; children: ReactNode }) { return <ProviderContext.Provider value={provider}>{children}</ProviderContext.Provider> }
export function useResource<T>(load: () => Promise<T>, dependencies: DependencyList, enabled = true, targetProvider?: ProviderId) {
  const context = useContext(Context), override = useContext(ProviderContext)
  const provider = targetProvider || override || (context ? providerForPage(context.data, context.page) : 'netease')
  const scope = context ? accountKey(context.data.sessions[provider]) : provider
  const key = JSON.stringify([scope, accountRevisions[provider], ...dependencies])
  const cache = useRef(new Map<string, T>())
  const [value, setValue] = useState<{ key: string; data: T | null; error: string; loading: boolean }>({ key, data: null, error: '', loading: enabled })
  const [revision, setRevision] = useState(0)
  const loader = useRef(load); loader.current = load
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const cached = cache.current.get(key)
    if (cached !== undefined) { setValue({ key, data: cached, error: '', loading: false }); return }
    setValue({ key, data: null, error: '', loading: true })
    void loader.current().then(data => {
      if (!alive) return
      if (cache.current.size >= 30) cache.current.clear()
      cache.current.set(key, data); setValue({ key, data, error: '', loading: false })
    }).catch(error => { if (alive) setValue({ key, data: null, error: error.code === 'SESSION_CHANGED' ? '' : error.message || '加载失败，请重试。', loading: false }) })
    return () => { alive = false }
  }, [key, revision, enabled])
  return { data: value.key === key ? value.data : cache.current.get(key) || null, error: value.key === key ? value.error : '', loading: enabled && (value.key !== key || value.loading), reload: () => { cache.current.delete(key); setRevision(value => value + 1) } }
}
export type VisualPreview = Partial<Pick<Settings, 'wallpaperBlur' | 'panelBlur' | 'panelOpacity'>>
interface State {
  visualPreview: VisualPreview; setVisualPreview: Dispatch<SetStateAction<VisualPreview>>
  data: Bootstrap; page: Page; navigate: (page: Page) => void; back: () => void; canBack: boolean
  login: (provider?: ProviderId) => void; loginProvider: ProviderId; loginOpen: boolean; setLoginOpen: (open: boolean) => void
  toast: (message: string) => void; toasts: { id: number; message: string }[]
  act: (action: Promise<unknown>, message?: string) => Promise<void>
  download: (tracks: Track[]) => void; downloadTracks: Track[] | null; setDownloadTracks: (tracks: Track[] | null) => void
  libraryRevisions: Record<ProviderId, number>; likedIds: Set<string>; toggleLike: (track: Track) => Promise<void>; liking: Set<string>
  panel: 'queue' | 'lyrics' | null; setPanel: (panel: 'queue' | 'lyrics' | null) => void
  playlistTrack: Track | null; setPlaylistTrack: (track: Track | null) => void; addToPlaylist: (track: Track) => void
  peqOpen: boolean; setPeqOpen: (open: boolean) => void; mediaImport: MediaImportState
}
const Context = createContext<State | null>(null)
export function useApp() {
  const value = useContext(Context), override = useContext(ProviderContext)
  if (!value) throw new Error('应用尚未初始化')
  const provider = override || providerForPage(value.data, value.page)
  return { ...value, provider, session: value.data.sessions[provider], libraryRevision: value.libraryRevisions[provider], login: (target: ProviderId = provider) => value.login(target) }
}
export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Bootstrap | null>(null), [failure, setFailure] = useState('')
  const [page, setPage] = useState<Page>({ type: 'home' }), [history, setHistory] = useState<Page[]>([])
  const [loginOpen, setLoginOpen] = useState(false), [loginProvider, setLoginProvider] = useState<ProviderId>('netease')
  const [downloadTracks, setDownloadTracks] = useState<Track[] | null>(null), [playlistTrack, setPlaylistTrack] = useState<Track | null>(null)
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]), [libraryRevisions, setLibraryRevisions] = useState({ netease: 0, qq: 0 })
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set()), [liking, setLiking] = useState<Set<string>>(new Set())
  const [panel, setPanel] = useState<'queue' | 'lyrics' | null>(null), [peqOpen, setPeqOpen] = useState(false)
  const [mediaImport, setMediaImport] = useState<MediaImportState>({ status: 'idle', progress: 0 })
  const [visualPreview, setVisualPreview] = useState<VisualPreview>({})
  const toastId = useRef(0)
  const toast = useCallback((message: string) => { const id = ++toastId.current; setToasts(list => [...list.slice(-2), { id, message }]); setTimeout(() => setToasts(list => list.filter(item => item.id !== id)), 5500) }, [])
  const login = (provider: ProviderId = 'netease') => { setLoginProvider(provider); setLoginOpen(true) }
  useEffect(() => {
    const off = window.music.onEvent(event => {
      if (event.type === 'notice') { toast(event.data); return }
      if (event.type === 'mediaImport') { setMediaImport(event.data); return }
      if (event.type === 'library') { setLibraryRevisions(value => ({ ...value, [event.data.provider]: value[event.data.provider] + 1 })); return }
      if (event.type === 'session') {
        const provider = event.data.provider
        accountRevisions[provider]++
        setLikedIds(current => new Set([...current].filter(key => !key.startsWith(`${provider}:`))))
        setLiking(current => new Set([...current].filter(key => !key.startsWith(`${provider}:`))))
        setPlaylistTrack(current => current?.provider === provider ? null : current)
        setDownloadTracks(current => current?.[0]?.provider === provider ? null : current)
      }
      setData(current => {
        if (!current) return current
        if (event.type === 'session') return { ...current, sessions: { ...current.sessions, [event.data.provider]: event.data.session } }
        if (event.type === 'player') return { ...current, player: event.data }
        if (event.type === 'downloads') return { ...current, downloads: event.data }
        if (event.type === 'settings') return { ...current, settings: event.data }
        return current
      })
    })
    void request('app.bootstrap').then(setData).catch(error => setFailure(error.message))
    return off
  }, [toast])
  useEffect(() => { document.documentElement.dataset.theme = data?.settings.theme || 'system' }, [data?.settings.theme])
  useEffect(() => {
    if (!data) return
    if (page.type === 'detail' && !data.settings.enabledProviders.includes(page.provider)) { setPage({ type: 'home' }); setHistory([]) }
    if (playlistTrack && !data.settings.enabledProviders.includes(playlistTrack.provider)) setPlaylistTrack(null)
    if (downloadTracks && !data.settings.enabledProviders.includes(downloadTracks[0].provider)) setDownloadTracks(null)
  }, [data?.settings.enabledProviders])
  const scopes = data ? PLATFORM_IDS.map(provider => `${accountKey(data.sessions[provider])}:${accountRevisions[provider]}:${libraryRevisions[provider]}:${data.settings.enabledProviders.includes(provider)}`) : []
  useEffect(() => {
    if (!data) return
    let alive = true
    for (const provider of PLATFORM_IDS) {
      if (!data.sessions[provider].user || !data.settings.enabledProviders.includes(provider)) continue
      void request('library.list', { provider, kind: 'likes', offset: 0 }).then(result => {
        if (alive) setLikedIds(current => new Set([...current].filter(key => !key.startsWith(`${provider}:`)).concat(result.likedIds.map(id => `${provider}:${id}`))))
      }).catch(() => {})
    }
    return () => { alive = false }
  }, [scopes.join('|')])
  const act = async (action: Promise<unknown>, message?: string) => {
    try { await action; if (message) toast(message) } catch (error) {
      const problem = error as Error & { code?: string; provider?: ProviderId }
      if (problem.code === 'SESSION_CHANGED') return
      if (['AUTH_REQUIRED', 'AUTH_EXPIRED', 'AUTH_INCOMPLETE'].includes(problem.code || '')) login(problem.provider || (data ? providerForPage(data, page) : 'netease'))
      toast(problem.message)
    }
  }
  if (failure) return <div className="boot-screen"><h1>Libitum music暂时无法启动</h1><p>{failure}</p><button className="button primary" onClick={() => location.reload()}>重试</button></div>
  if (!data) return <div className="boot-screen"><img className="brand-mark large app-icon" src={appIcon} alt=""/><h1>Libitum music</h1><p>正在准备你的音乐空间…</p><div className="spinner" /></div>
  const navigate = (target: Page) => { setHistory(list => [...list.slice(-29), page]); setPage(target) }
  const toggleLike = async (track: Track) => {
    const provider = track.provider, key = trackKey(track)
    if (!data.sessions[provider].user) { login(provider); return }
    if (liking.has(key)) return
    const revision = accountRevisions[provider]
    setLiking(ids => new Set([...ids, key]))
    try {
      const like = !likedIds.has(key); await request('library.like', { provider, id: track.id, like })
      if (revision === accountRevisions[provider]) setLikedIds(ids => { const next = new Set(ids); if (like) next.add(key); else next.delete(key); return next })
    } catch (error) { if (revision === accountRevisions[provider]) await act(Promise.reject(error)) }
    finally { if (revision === accountRevisions[provider]) setLiking(ids => { const next = new Set(ids); next.delete(key); return next }) }
  }
  return <Context.Provider value={{ data, page, navigate, back: () => { if (history.length) { const valid = history.filter(item => item.type !== 'detail' || data.settings.enabledProviders.includes(item.provider)); setPage(valid.at(-1) || { type: 'home' }); setHistory(valid.slice(0, -1)) } }, canBack: !!history.length, login, loginProvider, loginOpen, setLoginOpen, toast, toasts, act, download: tracks => { const provider = tracks[0]?.provider; if (!provider) return; if (!data.sessions[provider].user) login(provider); else setDownloadTracks(tracks) }, downloadTracks, setDownloadTracks, libraryRevisions, likedIds, toggleLike, liking, panel, setPanel, playlistTrack, setPlaylistTrack, addToPlaylist: track => { if (!data.sessions[track.provider].user) login(track.provider); else setPlaylistTrack(track) }, peqOpen, setPeqOpen, mediaImport, visualPreview, setVisualPreview }}>{children}</Context.Provider>
}
export function qualityName(quality: string) { const names: Record<string, string> = { standard: '标准', higher: '较高', exhigh: '极高', lossless: '无损', hires: 'Hi-Res' }; return names[quality] || quality }
