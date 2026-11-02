export const QUALITIES = {
  standard: '标准', higher: '较高', exhigh: '极高', lossless: '无损', hires: 'Hi-Res'
} as const
export type Quality = keyof typeof QUALITIES
export type ProviderId = 'netease' | 'qq'
export type PlatformPage = 'home' | 'daily' | 'radio' | 'fm' | 'likes' | 'playlists' | 'albums' | 'downloads' | 'search'
export interface PlatformPreferences { enabledProviders: ProviderId[]; pageProviders: Record<PlatformPage, ProviderId> }
export interface ResourceRef { provider: ProviderId; id: string }
export interface Artist extends ResourceRef { name: string; coverUrl: string }
export interface Track extends ResourceRef {
  title: string; artists: Artist[]; album: { id: string; title: string }; coverUrl: string; durationMs: number
}
export type CollectionKind = 'playlist' | 'album' | 'artist'
export interface Collection extends ResourceRef {
  kind: CollectionKind; title: string; coverUrl: string; description: string; creatorName: string
  trackCount: number; subscribed: boolean; owned: boolean
}
export type Album = Collection & { kind: 'album' }
export type Playlist = Collection & { kind: 'playlist' }
export interface User { id: string; nickname: string; avatarUrl: string }
export interface Session { user: User | null; persistent: boolean; provider?: ProviderId; message?: string }
export interface QRCode { key: string; dataUrl: string }
export interface QRStatus { state: 'waiting' | 'confirm' | 'expired' | 'success'; session?: Session }
export type SearchKind = 'song' | 'album' | 'artist' | 'playlist'
export interface SearchResult { tracks: Track[]; collections: Collection[]; total: number }
export interface Detail { collection: Collection; tracks: Track[]; total: number }
export type HomeSection = 'daily' | 'recommended' | 'charts' | 'newAlbums'
export interface HomeResult { tracks: Track[]; collections: Collection[] }
export type LibraryKind = 'likes' | 'playlists' | 'albums'
export interface LibraryResult extends HomeResult { total: number; likedIds: string[] }
export interface RadioSpec { mode: 'FM' | 'DEFAULT' | 'FAMILIAR' | 'EXPLORE' | 'SCENE_RCMD'; scene?: string }
export const SCENES = { EXERCISE: '运动', FOCUS: '专注', SLEEP_HELP: '助眠', RELAX: '放松', CHEERFUL: '欢快', CURE: '治愈', COMMUTE: '通勤', COFFEE_SHOP: '咖啡馆', ROCK: '摇滚', LIGHT: '轻音乐', ACG: '二次元', JAZZ: '爵士' } as const
export interface Stream { url: string; quality: string; bitrate: number; format: string; size: number; trial: boolean }
export interface Lyrics { original: string; translated: string }
export interface AudioDevice { id: string; label: string; backend?: string; key?: string; advanced?: boolean }
export interface MusicComment { id: string; content: string; author: string; avatarUrl: string; time: number; likes: number; replies: { author: string; content: string }[] }
export interface CommentPage { hot: MusicComment[]; items: MusicComment[]; total: number; more: boolean }
export interface SubscriptionResult { subscribed: boolean | null; confirmed: boolean }
export interface Diagnostic { operation: string; endpoint: string; code: string; hasCredential: boolean; hasCsrf: boolean; time: number }
export interface PeqBand { enabled: boolean; type: 'PK' | 'LS' | 'HS'; frequency: number; gain: number; q: number }
export interface PeqSettings { enabled: boolean; preamp: number; bands: PeqBand[] }
export interface Wallpaper { id: string; kind: 'image' | 'video'; name: string }
export interface MediaImportState { status: 'idle' | 'working' | 'completed' | 'failed' | 'cancelled'; progress: number; error?: string }
export interface SpectrumFrame { bins: number[]; status: 'active' | 'idle' | 'unavailable'; reason?: string }
export type AppearanceSettings = Pick<Settings, 'theme' | 'autoWallpaperText' | 'backgroundColor' | 'fontColor' | 'fontFamily' | 'visualMode' | 'wallpaper' | 'wallpaperBrightness' | 'wallpaperOverlay' | 'wallpaperBlur' | 'panelBlur' | 'panelOpacity'>
export type MiniAppearance = AppearanceSettings & Pick<Settings, 'floatingOpacity'>
export interface WindowState { maximized: boolean; minimized: boolean; focused: boolean }
export interface MiniState { appearance: MiniAppearance; track: Track | null; status: PlayerState['status']; position: number; duration: number; volume: number; liked: boolean }
export interface ExperienceSettings {
  commentsEnabled: boolean; autoWallpaperText: boolean; backgroundColor: string; fontColor: string; fontFamily: string; rotateCover: boolean; visualMode: 'cover' | 'wallpaper'; wallpaperScope: 'player' | 'app'
  wallpaper: Wallpaper | null; wallpaperBrightness: number; wallpaperOverlay: number; wallpaperBlur: number; panelBlur: number; panelOpacity: number; floatingOpacity: number; floatingEnabled: boolean
  floatingBounds?: { x: number; y: number; width: number; height: number }
  peq: PeqSettings; spectrum: { enabled: boolean; color: string; secondaryColor: string; gradient: boolean }
}
export type RepeatMode = 'list' | 'one' | 'shuffle'
export interface PlayerState {
  queue: Track[]; index: number; status: 'idle' | 'loading' | 'playing' | 'paused' | 'error'
  position: number; duration: number; volume: number; repeat: RepeatMode; requestedQuality: Quality
  actualQuality: string; bitrate: number; trial: boolean; deviceId: string; devices: AudioDevice[]
  available: boolean; error: string | null; notice: string | null; radio: RadioSpec | null
}
export interface Settings extends ExperienceSettings, PlatformPreferences { quality: Quality; downloadQuality: Quality; downloadDirectory: string; deviceId: string; deviceKey?: string; volume: number; theme: 'system' | 'light' | 'dark'; mpvPath: string }
export type DownloadStatus = 'queued' | 'resolving' | 'downloading' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export interface DownloadTask {
  id: string; ownerId: string; track: Track; quality: Quality; actualQuality?: string
  status: DownloadStatus; received: number; total: number; path?: string; error?: string; createdAt: number
}
export interface Bootstrap { sessions: Record<ProviderId, Session>; settings: Settings; player: PlayerState; downloads: DownloadTask[]; version: string }
export interface AppError { code: string; message: string; upstreamCode?: number }
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

export interface CommandMap {
  'app.bootstrap': { args: void; result: Bootstrap }
  'auth.qrStart': { args: { provider: ProviderId }; result: QRCode }
  'auth.qrCheck': { args: { key: string; provider: ProviderId }; result: QRStatus }
  'auth.qrCancel': { args: { key: string; provider: ProviderId }; result: void }
  'auth.importCookie': { args: { cookie: string; provider: ProviderId }; result: Session }
  'auth.logout': { args: { provider: ProviderId }; result: void }
  'auth.cancel': { args: { provider: ProviderId }; result: void }
  'catalog.search': { args: { provider: ProviderId; keywords: string; kind: SearchKind; offset: number }; result: SearchResult }
  'catalog.detail': { args: { provider: ProviderId; kind: CollectionKind; id: string; offset: number }; result: Detail }
  'catalog.allTracks': { args: { provider: ProviderId; kind: CollectionKind; id: string }; result: Track[] }
  'catalog.lyrics': { args: { provider: ProviderId; id: string }; result: Lyrics }
  'catalog.artistAlbums': {args:{provider:ProviderId;id:string;offset:number};result:{albums:Album[];more:boolean}}
  'catalog.comments': { args: { provider: ProviderId; id: string; offset: number }; result: CommentPage }
  'home.section': { args: { provider: ProviderId; section: HomeSection }; result: HomeResult }
  'library.list': { args: { provider: ProviderId; kind: LibraryKind; offset: number }; result: LibraryResult }
  'library.like': { args: { provider: ProviderId; id: string; like: boolean }; result: void }
  'library.subscribe': { args: { provider: ProviderId; kind: 'album' | 'playlist'; id: string; subscribe: boolean }; result: SubscriptionResult }
  'library.subscription': { args: { provider: ProviderId; kind: 'album' | 'playlist'; id: string }; result: SubscriptionResult }
  'library.writablePlaylists': { args: { provider: ProviderId; offset: number }; result: { collections: Playlist[]; more: boolean } }
  'library.addToPlaylist': { args: { provider: ProviderId; id: string; trackId: string }; result: { alreadyPresent: boolean } }
  'library.diagnostics': { args: { provider: ProviderId }; result: Diagnostic[] }
  'player.play': { args: { tracks: Track[]; index?: number; append?: boolean }; result: void }
  'player.toggle': { args: void; result: void }
  'player.next': { args: void; result: void }
  'player.previous': { args: void; result: void }
  'player.seek': { args: { seconds: number }; result: void }
  'player.volume': { args: { volume: number }; result: void }
  'player.repeat': { args: { mode: RepeatMode }; result: void }
  'player.quality': { args: { quality: Quality }; result: void }
  'player.device': { args: { id: string }; result: void }
  'player.refreshDevices': { args: void; result: void }
  'player.remove': { args: { index: number }; result: void }
  'player.radio': { args: RadioSpec & { provider: ProviderId }; result: void }
  'player.dislike': { args: void; result: void }
  'downloads.add': { args: { tracks: Track[]; quality: Quality }; result: void }
  'downloads.cancel': { args: { id: string }; result: void }
  'downloads.retry': { args: { id: string; quality?: Quality }; result: void }
  'downloads.reveal': { args: { id: string }; result: void }
  'downloads.play': { args: { id: string }; result: void }
  'settings.fonts': { args: undefined; result: string[] }
  'settings.update': { args: Partial<Pick<Settings, 'downloadQuality' | 'theme' | 'mpvPath' | 'commentsEnabled' | 'autoWallpaperText' | 'backgroundColor' | 'fontColor' | 'fontFamily' | 'rotateCover' | 'visualMode' | 'wallpaperScope' | 'wallpaperBrightness' | 'wallpaperOverlay' | 'wallpaperBlur' | 'panelBlur' | 'panelOpacity' | 'floatingOpacity' | 'floatingEnabled' | 'spectrum' | 'enabledProviders' | 'pageProviders'>>; result: Settings }
  'settings.pickDirectory': { args: void; result: Settings }
  'peq.apply': { args: PeqSettings; result: Settings }
  'peq.import': { args: void; result: PeqSettings | null }
  'wallpaper.import': { args: void; result: void }
  'wallpaper.cancel': { args: void; result: void }
  'wallpaper.clear': { args: void; result: Settings }
  'spectrum.subscribe': { args: { active: boolean }; result: void }
  'mini.bootstrap': { args: void; result: MiniState }
  'mini.like': { args: void; result: void }
  'mini.close': { args: void; result: void }
  'window.state': { args: void; result: WindowState }
  'window.minimize': { args: void; result: void }
  'window.toggleMaximize': { args: void; result: void }
  'window.close': { args: void; result: void }
  'window.restore': { args: void; result: void }
  'app.quit': { args: void; result: void }
  'app.openExternal': { args: { url: string }; result: void }
}
export type Command = keyof CommandMap
export type AppEvent = { type: 'window'; data: WindowState } | { type: 'player'; data: PlayerState } | { type: 'session'; data: { provider: ProviderId; session: Session } } | { type: 'downloads'; data: DownloadTask[] } | { type: 'settings'; data: Settings } | { type: 'library'; data: { provider: ProviderId } } | { type: 'notice'; data: string } | { type: 'spectrum'; data: SpectrumFrame } | { type: 'mediaImport'; data: MediaImportState } | { type: 'mini'; data: MiniState }
export interface DesktopAPI {
  invoke<K extends Command>(command: K, args?: CommandMap[K]['args']): Promise<Result<CommandMap[K]['result']>>
  onEvent(listener: (event: AppEvent) => void): () => void
}
declare global { interface Window { music: DesktopAPI } }
