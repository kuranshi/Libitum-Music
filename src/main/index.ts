import { sessionRecords, type SavedSessions, type SavedSession, type SessionArchive } from './session-records'
import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, screen, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mkdir, access, readFile, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WorkerBackend } from './backend'
import { JsonStore } from './store'
import { Mpv } from './mpv'
import { Player, type SavedQueue } from './player'
import { isTrack, validateCommand } from './validation'
import { MusicError, publicError } from '../shared/errors'
import { QUALITIES, type AppEvent, type Bootstrap, type Command, type DownloadTask, type Session, type Settings, type User } from '../shared/types'
import type { MiniState, ProviderId, WindowState } from '../shared/types'
import { PLATFORM_IDS, isProvider, normalizePlatforms, platformDefaults, emptySessions, trackKey } from '../shared/platforms'
import { experienceDefaults, normalizeExperience } from '../shared/preferences'
import { parsePeq } from '../shared/peq'
import { MediaLibrary } from './media'
import { SpectrumService } from './spectrum'

app.setName('cloud-music-player')
if (process.platform === 'linux') app.setDesktopName('cloud-music-player.desktop')
const testMode = !app.isPackaged && process.env.CLOUD_MUSIC_TEST === '1'
const explicitDataDirectory = app.commandLine.getSwitchValue('user-data-dir')
if (explicitDataDirectory.startsWith('/')) app.setPath('userData', explicitDataDirectory)
if (testMode && process.env.CLOUD_MUSIC_TEST_DIR) app.setPath('userData', process.env.CLOUD_MUSIC_TEST_DIR)
protocol.registerSchemesAsPrivileged([{ scheme: 'music-app', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }])
const locked = app.requestSingleInstanceLock()
if (!locked) app.quit()
let window: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
let media: MediaLibrary
let visualizer: SpectrumService
let spectrumSubscribed = false
let miniLikes = new Set<string>()
let miniTrack = ''
let backend: WorkerBackend
let player: Player
const sessions = emptySessions()
let settings: Settings
let settingsStore: JsonStore<Settings>
let queueStore: JsonStore<SavedQueue>
let sessionStore: JsonStore<SessionArchive | SavedSession | null>
let persistedSessions: SavedSessions = {}
let tasks: DownloadTask[] = []
let queueTimer: ReturnType<typeof setTimeout> | null = null
let exiting = false
const authEpoch: Record<ProviderId, number> = { netease: 0, qq: 0 }
const accessRevision: Record<ProviderId, number> = { netease: 0, qq: 0 }
const loginAttempt: Record<ProviderId, number> = { netease: 0, qq: 0 }
const switchingAccounts = new Set<ProviderId>()
const clearingAccounts: Partial<Record<ProviderId, Promise<void>>> = {}
const authChanges: Record<ProviderId, Promise<unknown>> = { netease: Promise.resolve(), qq: Promise.resolve() }
type QrFlow = { key: string; backendKey: string; provider: ProviderId; attempt: number; epoch: number }
const pendingQr: Record<ProviderId, QrFlow | null> = { netease: null, qq: null }
const activeCredentials: Record<ProviderId, { cookie: string; user: User; provider: ProviderId } | null> = { netease: null, qq: null }
const send = (event: AppEvent) => {
  if (window && !window.isDestroyed()) window.webContents.send('music:event', event)
  if (miniWindow && !miniWindow.isDestroyed() && ['player','library','session','settings'].includes(event.type)) {
    miniWindow.webContents.send('music:event', { type:'mini', data:miniSnapshot() } satisfies AppEvent)
    const current=player?.state.queue[player.state.index], id=current ? trackKey(current) : ''
    if (['library','session'].includes(event.type) || id!==miniTrack) { miniTrack=id; void refreshMiniLike() }
  }
  if (event.type === 'player' || event.type === 'settings') syncSpectrum()
}
function syncSpectrum() {
  if (!player || !settings || !visualizer) return
  visualizer.update(spectrumSubscribed && settings.spectrum.enabled && player.state.status==='playing' && !!window?.isVisible() && !window?.isMinimized(), player.processId, player.state.deviceId, player.state.queue[player.state.index]?.id || '')
}
function windowSnapshot(): WindowState {
  const current=window && !window.isDestroyed()?window:null
  return {maximized:current?.isMaximized()||false,minimized:current?.isMinimized()||false,focused:current?.isFocused()||false}
}
function miniSnapshot(): MiniState {
  const state=player?.state, track=state?.queue[state.index] || null
  // Only visual preferences reach the card: never account data, directories or wallpaper names.
  const {theme,autoWallpaperText,backgroundColor,fontColor,fontFamily,visualMode,wallpaper,wallpaperBrightness,wallpaperOverlay,wallpaperBlur,panelBlur,panelOpacity,floatingOpacity}=settings
  const appearance={theme,autoWallpaperText,backgroundColor,fontColor,fontFamily,visualMode,wallpaper:wallpaper?{id:wallpaper.id,kind:wallpaper.kind,name:''}:null,wallpaperBrightness,wallpaperOverlay,wallpaperBlur,panelBlur,panelOpacity,floatingOpacity}
  return { appearance, track, status:state?.status || 'idle',position:state?.position || 0,duration:state?.duration || 0,volume:state?.volume || 0,liked:!!track && miniLikes.has(trackKey(track)) }
}
async function refreshMiniLike() {
  const track = player?.state.queue[player.state.index]
  if (!track || !sessions[track.provider].user || !settings.enabledProviders.includes(track.provider)) miniLikes.clear()
  else {
    const provider = track.provider, epoch = authEpoch[provider], key = trackKey(track)
    try {
      const result = await backend.call('library.list', { provider, kind: 'likes', offset: 0 })
      const current = player.state.queue[player.state.index]
      if (epoch !== authEpoch[provider] || !current || trackKey(current) !== key) return
      miniLikes = new Set(result.likedIds.map((id: string) => `${provider}:${id}`))
    } catch { return }
  }
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.webContents.send('music:event', { type: 'mini', data: miniSnapshot() })
}
const notice = (message: string) => send({ type: 'notice', data: message })
function saveSettings(patch: Partial<Settings>, reportFailure=true) {
  settings = { ...settings, ...patch }
  void settingsStore.write(settings).catch(() => {if(reportFailure) notice('设置保存失败，请检查磁盘空间。')})
  send({ type: 'settings', data: settings })
}
function saveQueue() {
  if (queueTimer) clearTimeout(queueTimer)
  queueTimer = setTimeout(() => { queueTimer = null; void queueStore.write(player.saved()).catch(() => notice('播放队列保存失败。')) }, 500)
}
function authChange<T>(provider: ProviderId, operation: () => Promise<T>): Promise<T> {
  const result = authChanges[provider].catch(() => {}).then(operation)
  authChanges[provider] = result.catch(() => {})
  return result
}
function cancelAuthentication(provider: ProviderId) {
  loginAttempt[provider]++
  const flow = pendingQr[provider]
  pendingQr[provider] = null
  return flow ? backend.call('auth.qrCancel', { key: flow.backendKey, provider }).catch(() => {}) : Promise.resolve()
}
function canPersist() { return safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text' }
function persistSessions(provider: ProviderId) {
  const records = { ...persistedSessions }, current = activeCredentials[provider]
  if (canPersist() && current && sessions[provider].persistent) records[provider] = { encrypted: safeStorage.encryptString(current.cookie).toString('base64'), user: current.user, provider }
  else delete records[provider]
  persistedSessions = records
  return sessionStore.write({ schemaVersion: 2, sessions: records })
}
async function establish(cookie: string, user: User, provider: ProviderId, attempt = loginAttempt[provider]): Promise<Session> {
  return authChange(provider, async () => {
    if (attempt !== loginAttempt[provider]) throw new MusicError('SESSION_CHANGED', '本次登录已取消，请重新登录。')
    switchingAccounts.add(provider)
    const previous = activeCredentials[provider], previousSession = sessions[provider]
    let backendChanged = false, committed = false
    try {
      const epoch = ++authEpoch[provider]
      await backend.call('session.set', { cookie, user, provider, epoch })
      backendChanged = true
      if (attempt !== loginAttempt[provider]) throw new MusicError('SESSION_CHANGED', '本次登录已取消，请重新登录。')
      const next: Session = { user, provider, persistent: canPersist(), message: canPersist() ? undefined : '系统密钥环不可用，登录仅在本次运行中保留。' }
      sessions[provider] = next; activeCredentials[provider] = { cookie, user, provider }; committed = true
      if (previousSession.user && previousSession.user.id !== user.id) await player.removeProvider(provider, false)
      try { await persistSessions(provider) } catch {
        next.persistent = false; next.message = '登录成功，但会话无法保存，退出应用后需要重新登录。'
        await persistSessions(provider).catch(() => {})
      }
      tasks = await backend.call('downloads.list')
      miniLikes.clear(); miniTrack = ''
      send({ type: 'session', data: { provider, session: next } }); send({ type: 'downloads', data: tasks }); send({ type: 'library', data: { provider } })
      return next
    } catch (error) {
      if (!committed && backendChanged) {
        await backend.call('session.set', { provider, cookie: previous?.cookie || '', user: previous?.user || null, epoch: ++authEpoch[provider] })
      }
      throw error
    } finally { switchingAccounts.delete(provider) }
  })
}
function logout(provider: ProviderId, expired = false): Promise<void> {
  if (clearingAccounts[provider]) return clearingAccounts[provider]!
  const cancellation = cancelAuthentication(provider)
  const operation = authChange(provider, async () => {
    await cancellation
    switchingAccounts.add(provider)
    try {
      await player.removeProvider(provider, false)
      await backend.call('session.clear', { provider, epoch: ++authEpoch[provider] })
      activeCredentials[provider] = null
      sessions[provider] = { user: null, provider, persistent: false, message: expired ? '登录已失效，请重新登录。' : undefined }
      await persistSessions(provider).catch(() => notice('退出状态保存失败，请检查磁盘空间。'))
      miniLikes.clear(); miniTrack = ''; tasks = await backend.call('downloads.list')
      send({ type: 'session', data: { provider, session: sessions[provider] } }); send({ type: 'downloads', data: tasks }); send({ type: 'library', data: { provider } })
    } finally { switchingAccounts.delete(provider) }
  }).finally(() => { delete clearingAccounts[provider] })
  clearingAccounts[provider] = operation
  return operation
}
function assertEnabled(provider: ProviderId) {
  if (!isProvider(provider) || !settings.enabledProviders.includes(provider)) throw new MusicError('PLATFORM_DISABLED', '该音乐平台已关闭，请在设置中开启。')
  if (switchingAccounts.has(provider)) throw new MusicError('SESSION_CHANGED', '正在更新此平台账号，请稍后重试。')
}
async function handle(command: Command, args: any): Promise<any> {
  switch (command) {
    case 'app.bootstrap': return { sessions, settings, player: player.snapshot(), downloads: tasks, version: app.getVersion() } satisfies Bootstrap
    case 'auth.qrStart': {
      const provider: ProviderId = args.provider
      const cancellation = cancelAuthentication(provider), attempt = loginAttempt[provider]
      await cancellation; await authChanges[provider]
      if (attempt !== loginAttempt[provider]) throw new MusicError('SESSION_CHANGED', '本次登录已取消。')
      const code = await backend.call('auth.qrStart', { provider })
      if (attempt !== loginAttempt[provider]) throw new MusicError('SESSION_CHANGED', '本次登录已取消。')
      const key = randomUUID()
      pendingQr[provider] = { key, backendKey: code.key, provider, attempt, epoch: authEpoch[provider] }
      return { ...code, key }
    }
    case 'auth.qrCancel': {
      const provider: ProviderId = args.provider, flow = pendingQr[provider]
      if (flow?.key === args.key) return cancelAuthentication(provider)
      return
    }
    case 'auth.cancel': return cancelAuthentication(args.provider)
    case 'auth.qrCheck': {
      const provider: ProviderId = args.provider, flow = pendingQr[provider]
      if (!flow || flow.key !== args.key) return { state: 'expired' }
      const result = await backend.call(command, { key: flow.backendKey, provider })
      if (pendingQr[provider] !== flow || flow.attempt !== loginAttempt[provider] || flow.epoch !== authEpoch[provider]) return { state: 'expired' }
      if (result.state === 'success') { pendingQr[provider] = null; return { state: 'success', session: await establish(result.cookie, result.user, provider, flow.attempt) } }
      return { state: result.state }
    }
    case 'auth.importCookie': {
      const provider: ProviderId = args.provider
      const cancellation = cancelAuthentication(provider), attempt = loginAttempt[provider]
      await cancellation; await authChanges[provider]
      if (attempt !== loginAttempt[provider]) throw new MusicError('SESSION_CHANGED', '本次登录已取消。')
      const result = await backend.call(command, args)
      return establish(result.cookie, result.user, provider, attempt)
    }
    case 'auth.logout': return logout(args.provider)
    case 'library.like': case 'library.subscribe': case 'library.addToPlaylist':
    case 'catalog.search': case 'catalog.detail': case 'catalog.allTracks': case 'catalog.lyrics': case 'catalog.comments': case 'catalog.artistAlbums': case 'home.section': case 'library.list': case 'library.subscription': case 'library.writablePlaylists': case 'library.diagnostics': {
      const provider: ProviderId = args.provider
      assertEnabled(provider)
      const epoch = authEpoch[provider], access = accessRevision[provider]
      const value = await backend.call(command, args)
      if (epoch !== authEpoch[provider] || access !== accessRevision[provider]) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新加载。')
      if (['library.like', 'library.subscribe', 'library.addToPlaylist'].includes(command)) send({ type: 'library', data: { provider } })
      return value
    }
    case 'player.play': { for (const track of args.tracks) assertEnabled(track.provider); return player.play(args.tracks, args.index, args.append) }
    case 'player.toggle': return player.toggle()
    case 'player.next': return player.next()
    case 'player.previous': return player.previous()
    case 'player.seek': return player.seek(args.seconds)
    case 'player.volume': return player.volume(args.volume)
    case 'player.repeat': return player.repeat(args.mode)
    case 'player.quality': return player.quality(args.quality)
    case 'player.device': return player.device(args.id)
    case 'player.refreshDevices': return player.refreshDevices()
    case 'player.remove': return player.remove(args.index)
    case 'player.radio': assertEnabled(args.provider); return player.radio(args)
    case 'player.dislike': return player.dislike()
    case 'downloads.add': case 'downloads.cancel': case 'downloads.retry': return backend.call(command, args)
    case 'downloads.reveal': case 'downloads.play': {
      const task = await backend.call<DownloadTask>('downloads.get', args)
      const provider = task.track.provider, epoch = authEpoch[provider]
      assertEnabled(provider)
      if (task.status !== 'completed' || !task.path) throw new MusicError('FILE_UNAVAILABLE', '下载尚未完成。')
      await access(task.path)
      assertEnabled(provider)
      if (epoch !== authEpoch[provider]) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新选择下载。')
      if (command === 'downloads.reveal') { shell.showItemInFolder(task.path); return }
      return player.playDownload(task)
    }
    case 'settings.fonts': {
      try {const {stdout}=await promisify(execFile)('fc-list',['--format=%{family}\n'],{timeout:2000,maxBuffer:1_000_000});return [...new Set(stdout.split(/[\n,]/).map(s=>s.trim()).filter(s=>s.length>0&&s.length<=120&&/^[\p{L}\p{N} .,_'-]+$/u.test(s)))].sort((a,b)=>a.localeCompare(b)).slice(0,600)} catch{return []}
    }
    case 'settings.update': {
      if (args.enabledProviders) args = { ...args, enabledProviders: PLATFORM_IDS.filter(id => args.enabledProviders.includes(id)) }
      const changedMpv = args.mpvPath && args.mpvPath !== settings.mpvPath
      const previous=settings
      saveSettings(args,false)
      try { await settingsStore.flush() } catch {
        const restored={...settings}
        for(const key of Object.keys(args) as (keyof Settings)[]) if(settings[key]===args[key]) (restored as any)[key]=previous[key]
        settings=restored;send({type:'settings',data:settings})
        throw new MusicError('SETTINGS_SAVE','设置保存失败，已恢复原值，请检查磁盘空间。')
      }
      if (args.enabledProviders) {
        const changed = PLATFORM_IDS.filter(id => previous.enabledProviders.includes(id) !== settings.enabledProviders.includes(id))
        for (const provider of changed) accessRevision[provider]++
        await backend.call('settings.platforms', { enabledProviders: settings.enabledProviders })
        for (const provider of previous.enabledProviders.filter(id => !settings.enabledProviders.includes(id))) await player.removeProvider(provider)
      }
      if (changedMpv) await player.restart()
      if (args.floatingEnabled === true) createMini()
      if (args.floatingEnabled === false && miniWindow) miniWindow.close()
      return settings
    }
    case 'peq.apply': await player.applyPeq(args); return settings
    case 'peq.import': {
      const picked=await dialog.showOpenDialog(window!,{title:'导入 PEQ 文本',properties:['openFile'],filters:[{name:'PEQ 文本',extensions:['txt']}]})
      if(picked.canceled || !picked.filePaths[0]) return null
      const path=picked.filePaths[0]
      if((await stat(path)).size>65536) throw new MusicError('PEQ_IMPORT','预设超过 64 KB。')
      const bytes=await readFile(path)
      let text:string
      if(bytes[0]===255 && bytes[1]===254) text=new TextDecoder('utf-16le').decode(bytes)
      else if(bytes[0]===254 && bytes[1]===255) text=new TextDecoder('utf-16be').decode(bytes)
      else { try { text=new TextDecoder('utf-8',{fatal:true}).decode(bytes) } catch { text=new TextDecoder('gb18030').decode(bytes) } }
      try { return parsePeq(text) } catch(error) { throw new MusicError('PEQ_IMPORT',(error as Error).message) }
    }
    case 'wallpaper.import': {
      const picked=await dialog.showOpenDialog(window!,{title:'选择图片或视频壁纸',properties:['openFile'],filters:[{name:'图片和视频',extensions:['jpg','jpeg','png','webp','gif','bmp','avif','mp4','webm','mov','mkv','avi']}]})
      if(!picked.canceled && picked.filePaths[0]) void media.import(picked.filePaths[0]).catch(error=>notice(publicError(error).message))
      return
    }
    case 'wallpaper.cancel': media.cancel(); return
    case 'wallpaper.clear': { const previous=settings.wallpaper; saveSettings({wallpaper:null,visualMode:'cover'}); await settingsStore.flush(); if(previous) await media.remove(previous.id); return settings }
    case 'spectrum.subscribe': spectrumSubscribed=args.active; syncSpectrum(); return
    case 'mini.bootstrap': await refreshMiniLike(); return miniSnapshot()
    case 'mini.close': { const card=miniWindow; setTimeout(()=>{if(card&&!card.isDestroyed())card.close()},50); return }
    case 'mini.like': {
      const track = player.state.queue[player.state.index]
      if (!track || !sessions[track.provider].user) throw new MusicError('AUTH_REQUIRED', '请在主窗口登录后使用喜欢功能。')
      const provider = track.provider, epoch = authEpoch[provider]
      assertEnabled(provider); await refreshMiniLike()
      if (epoch !== authEpoch[provider] || player.state.queue[player.state.index] !== track) return
      await backend.call('library.like', { provider, id: track.id, like: !miniLikes.has(trackKey(track)) })
      send({ type: 'library', data: { provider } }); return
    }
    case 'window.state': return windowSnapshot()
    case 'window.minimize': window?.minimize(); return
    case 'window.toggleMaximize': if(window) { if(window.isMaximized()) window.unmaximize(); else window.maximize() }; return
    case 'window.close': { const current=window; setTimeout(()=>{if(current&&!current.isDestroyed())current.close()},50); return }
    case 'window.restore': if(window) { window.show(); if(window.isMinimized()) window.restore(); window.focus() }; return
    case 'app.quit': app.quit(); return
    case 'settings.pickDirectory': {
      const result = await dialog.showOpenDialog(window!, { title: '选择音乐下载目录', defaultPath: settings.downloadDirectory, properties: ['openDirectory', 'createDirectory'] })
      if (!result.canceled && result.filePaths[0]) { saveSettings({ downloadDirectory: result.filePaths[0] }); await backend.call('settings.directory', { directory: settings.downloadDirectory }) }
      return settings
    }
    case 'app.openExternal': return shell.openExternal(args.url)
  }
}
async function initialize() {
  const userData = app.getPath('userData'), runtime = join(userData, 'runtime')
  await mkdir(runtime, { recursive: true, mode: 0o700 })
  sessionStore = new JsonStore(join(userData, 'session.json'), null)
  const credentials = await sessionStore.read()
  const legacyProvider: ProviderId = credentials && 'encrypted' in credentials && credentials.provider === 'qq' ? 'qq' : 'netease'
  const defaults: Settings = { ...experienceDefaults(), ...platformDefaults(legacyProvider), quality: 'exhigh', downloadQuality: 'exhigh', downloadDirectory: join(testMode ? userData : app.getPath('music'), 'Libitum music 下载'), deviceId: 'auto', volume: 60, theme: 'system', mpvPath: 'mpv' }
  settingsStore = new JsonStore(join(userData, 'settings.json'), defaults)
  const stored = await settingsStore.read()
  settings = { ...defaults, ...stored, ...normalizeExperience(stored), ...normalizePlatforms(stored, legacyProvider) }
  if (!Object.hasOwn(QUALITIES, settings.quality)) settings.quality = defaults.quality
  if (!Object.hasOwn(QUALITIES, settings.downloadQuality)) settings.downloadQuality = defaults.downloadQuality
  if (!['system', 'light', 'dark'].includes(settings.theme)) settings.theme = 'system'
  if (!Number.isFinite(settings.volume)) settings.volume = defaults.volume
  settings.volume = Math.max(0, Math.min(100, settings.volume))
  if (typeof settings.deviceId !== 'string') settings.deviceId = 'auto'
  if (typeof settings.downloadDirectory !== 'string' || !settings.downloadDirectory.startsWith('/')) settings.downloadDirectory = defaults.downloadDirectory
  if (typeof settings.mpvPath !== 'string' || !(settings.mpvPath === 'mpv' || settings.mpvPath.startsWith('/'))) settings.mpvPath = 'mpv'
  queueStore = new JsonStore<SavedQueue>(join(userData, 'queue.json'), { queue: [], index: -1, position: 0, repeat: 'list' })
  backend = new WorkerBackend()
  backend.on('credentials', data => {
    const provider: ProviderId = data.provider
    if (!isProvider(provider) || data.epoch !== authEpoch[provider] || data.user?.id !== sessions[provider].user?.id || !sessions[provider].user || switchingAccounts.has(provider)) return
    activeCredentials[provider] = { cookie: data.cookie, user: sessions[provider].user!, provider }
    void persistSessions(provider).catch(() => notice('会话更新保存失败。'))
  })
  backend.on('downloads', data => { tasks = data; send({ type: 'downloads', data }) })
  backend.on('notice', notice)
  backend.on('expired', data => { const provider: unknown = data?.provider; if (isProvider(provider) && sessions[provider].user && data.epoch === authEpoch[provider]) void logout(provider, true).catch(() => notice('登录失效，请重新登录。')) })
  backend.on('failed', () => { notice('音乐后台已退出，请重新启动应用。'); void player.stop(false) })
  backend.start(runtime)
  await backend.call('init', { enabledProviders: settings.enabledProviders, userData, directory: settings.downloadDirectory, testMode, testUrl: testMode ? process.env.CLOUD_MUSIC_TEST_URL : undefined, testQrScenario: testMode ? process.env.CLOUD_MUSIC_TEST_QR : undefined })
  player = new Player(new Mpv(runtime, () => settings.mpvPath, testMode), backend, settings, data => send({ type: 'player', data }), saveQueue, saveSettings)
  visualizer=new SpectrumService(data=>send({type:'spectrum',data}))
  media=new MediaLibrary(join(userData,'media'),data=>send({type:'mediaImport',data}),async wallpaper=>{
    const previous=settings.wallpaper,previousMode=settings.visualMode
    saveSettings({wallpaper,visualMode:'wallpaper'})
    try { await settingsStore.flush() } catch(error) { settings={...settings,wallpaper:previous,visualMode:previousMode};send({type:'settings',data:settings});throw error }
    if(previous) await media.remove(previous.id)
  })
  const saved = await queueStore.read()
  const restoring: { cookie: string; user: User; provider: ProviderId }[] = []
  const records = sessionRecords(credentials)
  persistedSessions = records
  if (canPersist()) for (const provider of PLATFORM_IDS) {
    const record = records[provider]
    if (!record || typeof record.encrypted !== 'string' || !record.user?.id) continue
    try {
      const cookie = safeStorage.decryptString(Buffer.from(record.encrypted, 'base64'))
      await backend.call('session.set', { cookie, user: record.user, provider, epoch: authEpoch[provider] })
      sessions[provider] = { user: record.user, provider, persistent: true, message: '正在验证登录状态…' }
      const restored = { cookie, user: record.user, provider }
      restoring.push(restored); activeCredentials[provider] = restored
    } catch { sessions[provider].message = '上次登录无法恢复，请重新登录。' }
  }
  if (saved && Array.isArray(saved.queue) && saved.queue.every(isTrack)) {
    const current = saved.queue[saved.index]
    const queue = saved.queue.filter(track => settings.enabledProviders.includes(track.provider))
    player.restore({ ...saved, queue, index: current ? queue.indexOf(current) : -1 })
  }
  ipcMain.handle('music:invoke', async (event, command: unknown, args: unknown) => {
    try {
      const main=!!window && event.sender===window.webContents && event.senderFrame===window.webContents.mainFrame
      const mini=!!miniWindow && event.sender===miniWindow.webContents && event.senderFrame===miniWindow.webContents.mainFrame
      const miniAllowed=['mini.bootstrap','mini.like','mini.close','player.toggle','player.previous','player.next','player.seek','player.volume','window.restore','app.quit']
      if(!main && !(mini && typeof command==='string' && miniAllowed.includes(command))) throw new MusicError('FORBIDDEN','请求来源无效。')
      validateCommand(command, args)
      return { ok: true, data: await handle(command, args) }
    } catch (error) { return { ok: false, error: publicError(error) } }
  })
  protocol.handle('music-app', async request => {
    const url = new URL(request.url)
    if(url.hostname==='bundle' && url.pathname.startsWith('/user-media/')) {
      const id=url.pathname.slice('/user-media/'.length)
      return id===settings.wallpaper?.id ? media.serve(request,id) : new Response(null,{status:403})
    }
    const base = resolve(__dirname, '../renderer')
    let pathname: string
    try { pathname = decodeURIComponent(url.pathname) } catch { return new Response('Bad request', { status: 400 }) }
    const file = resolve(base, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (url.hostname !== 'bundle' || !file.startsWith(base + sep)) return new Response('Forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })
  createWindow()
  if(settings.floatingEnabled) createMini()
  void player.initialize()
  for (const savedSession of restoring) {
    const provider = savedSession.provider
    if (!settings.enabledProviders.includes(provider)) continue
    const epoch = authEpoch[provider], attempt = loginAttempt[provider]
    void backend.call('auth.importCookie', { cookie: savedSession.cookie, provider }).then(async result => {
      if (epoch === authEpoch[provider] && attempt === loginAttempt[provider]) await establish(result.cookie, result.user, provider, attempt)
    }).catch(async error => {
      if (epoch !== authEpoch[provider] || attempt !== loginAttempt[provider]) return
      if (error instanceof MusicError && error.code === 'AUTH_EXPIRED') await logout(provider, true)
      else { sessions[provider] = { ...sessions[provider], message: '暂时无法验证登录，已保留本机会话；联网后可重试。' }; send({ type: 'session', data: { provider, session: sessions[provider] } }) }
    }).catch(() => notice('登录状态恢复失败，请重新登录。'))
  }
  const checkpoint = setInterval(() => { void queueStore.write(player.saved()).catch(() => {}) }, 10000)
  checkpoint.unref()
}
function createWindow() {
  window = new BrowserWindow({ width: 1440, height: 940, minWidth: 1000, minHeight: 680, frame: false, hasShadow: true, show: false, title: 'Libitum music', backgroundColor: '#f7f8fa', autoHideMenuBar: true, icon: join(app.getAppPath(), 'resources/icon.png'), webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const dev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
    const csp = `default-src 'self'; script-src 'self'${dev ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' music-app: https: data:; media-src 'self' music-app:; connect-src 'self'${dev ? ' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*' : ''}; object-src 'none'; frame-src 'none'; base-uri 'none'`
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
  })
  const syncWindow=()=>send({type:'window',data:windowSnapshot()})
  window.on('maximize',syncWindow).on('unmaximize',syncWindow).on('minimize',syncWindow).on('restore',syncWindow).on('focus',syncWindow).on('blur',syncWindow)
  window.once('ready-to-show', () => window?.show())
  window.on('close',event=>{ if(!exiting && settings.floatingEnabled && miniWindow) { event.preventDefault(); window?.hide(); syncSpectrum() } })
  window.on('show',syncSpectrum); window.on('hide',syncSpectrum); window.on('minimize',syncSpectrum); window.on('restore',syncSpectrum)
  window.on('closed', () => { window = null })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadURL('music-app://bundle/index.html')
}
function createMini() {
  if(miniWindow) { miniWindow.show(); return }
  const nativeWayland=process.env.XDG_SESSION_TYPE==='wayland' && app.commandLine.getSwitchValue('ozone-platform')!=='x11'
  let bounds=nativeWayland ? undefined : settings.floatingBounds
  if(bounds){
    const displays=screen.getAllDisplays(),area=(displays.find(d=>bounds!.x+50<d.workArea.x+d.workArea.width && bounds!.x+bounds!.width-50>d.workArea.x && bounds!.y+40<d.workArea.y+d.workArea.height && bounds!.y+bounds!.height-40>d.workArea.y)||screen.getPrimaryDisplay()).workArea
    const width=280,height=64
    bounds={width,height,x:Math.max(area.x,Math.min(bounds.x,area.x+area.width-width)),y:Math.max(area.y,Math.min(bounds.y,area.y+area.height-height))}
  }
  const card=new BrowserWindow({icon:join(app.getAppPath(),'resources/icon.png'), width:280,height:64,minWidth:280,minHeight:64,maxWidth:280,maxHeight:64,...bounds,frame:false,resizable:false,transparent:true,show:false,alwaysOnTop:true,title:'Libitum music · 悬浮卡片',autoHideMenuBar:true,backgroundColor:'#00000000',webPreferences:{preload:join(__dirname,'../preload/index.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true} })
  miniWindow=card
  card.webContents.setWindowOpenHandler(()=>({action:'deny'})); card.webContents.on('will-navigate',event=>event.preventDefault())
  card.once('ready-to-show',()=>{ if(miniWindow===card) card.show() })
  card.on('close',()=>{ if(!exiting) { if(!nativeWayland) saveSettings({floatingBounds:card.getBounds()}); saveSettings({floatingEnabled:false}); window?.show();if(window?.isMinimized())window.restore() } })
  card.on('closed',()=>{ if(miniWindow===card) miniWindow=null })
  if(!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void card.loadURL(process.env.ELECTRON_RENDERER_URL+'#mini')
  else void card.loadURL('music-app://bundle/index.html#mini')
}
app.on('second-instance', () => { if (window) { window.show(); if (window.isMinimized()) window.restore(); window.focus() } })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', event => {
  if (exiting || !player) return
  event.preventDefault(); exiting = true
  if (queueTimer) clearTimeout(queueTimer)
  void (async () => {
    visualizer?.stop(); media?.cancel()
    await queueStore.write(player.saved()).catch(() => {})
    await player.dispose()
    await backend.close()
    await settingsStore.flush().catch(() => {})
    app.quit()
  })()
})
if (locked) void app.whenReady().then(initialize).catch(error => { console.error('Libitum music初始化失败', publicError(error)); dialog.showErrorBox('Libitum music启动失败', '无法初始化应用数据或音乐服务，请检查数据目录权限后重试。'); exiting = true; app.quit() })
