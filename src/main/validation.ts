import { MusicError } from '../shared/errors'
import { QUALITIES, type Command, type Track } from '../shared/types'
import { validPeq } from '../shared/peq'
const commands = new Set<Command>(['app.bootstrap', 'auth.qrStart', 'auth.qrCheck', 'auth.qrCancel', 'auth.importCookie', 'auth.logout', 'catalog.search', 'catalog.detail', 'catalog.allTracks', 'catalog.lyrics', 'catalog.artistAlbums', 'catalog.comments', 'home.section', 'library.list', 'library.like', 'library.subscribe', 'library.subscription', 'library.writablePlaylists', 'library.addToPlaylist', 'library.diagnostics', 'player.play', 'player.toggle', 'player.next', 'player.previous', 'player.seek', 'player.volume', 'player.repeat', 'player.quality', 'player.device', 'player.refreshDevices', 'player.remove', 'player.radio', 'player.dislike', 'downloads.add', 'downloads.cancel', 'downloads.retry', 'downloads.reveal', 'downloads.play', 'settings.fonts', 'settings.update', 'settings.pickDirectory', 'peq.apply', 'peq.import', 'wallpaper.import', 'wallpaper.cancel', 'wallpaper.clear', 'spectrum.subscribe', 'mini.bootstrap', 'mini.like', 'mini.close', 'window.state', 'window.minimize', 'window.toggleMaximize', 'window.close', 'window.restore', 'app.quit', 'app.openExternal'])
function assert(value: unknown): asserts value { if (!value) throw new MusicError('INVALID_ARGUMENT', '操作参数无效，请刷新后重试。') }
const text = (v: unknown, max = 512): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const id = (v: unknown) => typeof v === 'string' && /^\d{1,24}$/.test(v)
const finite = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const quality = (v: unknown) => typeof v === 'string' && Object.hasOwn(QUALITIES, v)
export function isTrack(v: any): v is Track {
  return !!v && v.provider === 'netease' && id(v.id) && text(v.title, 1000) && Array.isArray(v.artists) && v.artists.length <= 100 && v.artists.every((a: any) => a && text(a.name, 1000) && typeof a.id === 'string') && v.album && typeof v.album.id === 'string' && typeof v.album.title === 'string' && typeof v.coverUrl === 'string' && finite(v.durationMs, 0, 86400000)
}
export function validateCommand(command: unknown, args: any): asserts command is Command {
  assert(typeof command === 'string' && commands.has(command as Command))
  const noArgs = ['app.bootstrap', 'auth.qrStart', 'auth.logout', 'player.toggle', 'player.next', 'player.previous', 'player.refreshDevices', 'player.dislike', 'settings.pickDirectory', 'settings.fonts', 'peq.import', 'wallpaper.import', 'wallpaper.cancel', 'wallpaper.clear', 'mini.bootstrap', 'mini.like', 'mini.close', 'window.state', 'window.minimize', 'window.toggleMaximize', 'window.close', 'window.restore', 'app.quit', 'library.diagnostics']
  if (noArgs.includes(command)) { assert(args === undefined || args === null); return }
  assert(args && typeof args === 'object' && !Array.isArray(args))
  if (['catalog.detail', 'catalog.allTracks', 'catalog.lyrics', 'catalog.comments', 'catalog.artistAlbums', 'library.like', 'library.subscribe', 'library.subscription', 'library.addToPlaylist'].includes(command)) assert(id(args.id))
  if (['catalog.search', 'catalog.detail', 'catalog.comments', 'catalog.artistAlbums', 'library.list', 'library.writablePlaylists'].includes(command)) assert(Number.isInteger(args.offset) && finite(args.offset, 0, 1000000))
  switch (command) {
    case 'auth.qrCheck': case 'auth.qrCancel': assert(text(args.key, 512)); break
    case 'auth.importCookie': assert(text(args.cookie, 32768) && !/[\r\n\x00]/.test(args.cookie) && /(?:^|;\s*)MUSIC_U=/.test(args.cookie)); break
    case 'catalog.search': assert(text(args.keywords, 200) && ['song', 'album', 'artist', 'playlist'].includes(args.kind)); break
    case 'catalog.detail': case 'catalog.allTracks': assert(['album', 'playlist', 'artist'].includes(args.kind)); break
    case 'home.section': assert(['daily', 'recommended', 'charts', 'newAlbums'].includes(args.section)); break
    case 'library.list': assert(['likes', 'playlists', 'albums'].includes(args.kind)); break
    case 'library.like': assert(typeof args.like === 'boolean'); break
    case 'library.subscribe': assert(['album', 'playlist'].includes(args.kind) && typeof args.subscribe === 'boolean'); break
    case 'library.subscription': assert(['album', 'playlist'].includes(args.kind)); break
    case 'library.addToPlaylist': assert(id(args.trackId)); break
    case 'peq.apply': assert(validPeq(args)); break
    case 'spectrum.subscribe': assert(typeof args.active === 'boolean'); break
    case 'player.play': case 'downloads.add':
      assert(Array.isArray(args.tracks) && args.tracks.length > 0 && args.tracks.length <= 10000 && args.tracks.every(isTrack))
      if (command === 'downloads.add') assert(quality(args.quality))
      else { assert(args.index === undefined || Number.isInteger(args.index) && finite(args.index, 0, args.tracks.length - 1)); assert(args.append === undefined || typeof args.append === 'boolean') }
      break
    case 'player.seek': assert(finite(args.seconds, 0, 86400)); break
    case 'player.volume': assert(finite(args.volume, 0, 100)); break
    case 'player.repeat': assert(['list', 'one', 'shuffle'].includes(args.mode)); break
    case 'player.quality': assert(quality(args.quality)); break
    case 'player.device': assert(text(args.id, 2048)); break
    case 'player.remove': assert(Number.isInteger(args.index) && finite(args.index, 0, 10000)); break
    case 'player.radio': assert(['FM', 'DEFAULT', 'FAMILIAR', 'EXPLORE', 'SCENE_RCMD'].includes(args.mode)); if (args.mode === 'SCENE_RCMD') assert(typeof args.scene === 'string' && /^[A-Z_]{2,40}$/.test(args.scene)); break
    case 'downloads.cancel': case 'downloads.retry': case 'downloads.reveal': case 'downloads.play': assert(text(args.id, 100)); if (args.quality !== undefined) assert(quality(args.quality)); break
    case 'settings.update':
      assert(Object.keys(args).every(key => ['downloadQuality', 'theme', 'mpvPath', 'commentsEnabled', 'autoWallpaperText', 'backgroundColor', 'fontColor', 'fontFamily', 'rotateCover', 'visualMode', 'wallpaperScope', 'wallpaperBrightness', 'wallpaperOverlay', 'wallpaperBlur', 'panelBlur', 'panelOpacity', 'floatingOpacity', 'floatingEnabled', 'spectrum'].includes(key)))
      if (args.downloadQuality !== undefined) assert(quality(args.downloadQuality))
      for(const key of ['backgroundColor','fontColor']) if(args[key]!==undefined) assert(typeof args[key]==='string'&&(args[key]===''||/^#[a-f0-9]{6}$/i.test(args[key])))
      if(args.fontFamily!==undefined) assert(typeof args.fontFamily==='string'&&args.fontFamily.length<=120&&/^[\p{L}\p{N} .,_'-]*$/u.test(args.fontFamily))
      if (args.theme !== undefined) assert(['system', 'light', 'dark'].includes(args.theme))
      if (args.mpvPath !== undefined) assert(text(args.mpvPath, 1024) && (args.mpvPath === 'mpv' || args.mpvPath.startsWith('/')) && !/[\x00-\x1f]/.test(args.mpvPath))
      for (const key of ['commentsEnabled', 'autoWallpaperText', 'rotateCover', 'floatingEnabled']) if (args[key] !== undefined) assert(typeof args[key] === 'boolean')
      if (args.visualMode !== undefined) assert(['cover', 'wallpaper'].includes(args.visualMode))
      if (args.wallpaperScope !== undefined) assert(['player','app'].includes(args.wallpaperScope))
      if (args.wallpaperBrightness !== undefined) assert(finite(args.wallpaperBrightness,0.1,1))
      if (args.wallpaperOverlay !== undefined) assert(finite(args.wallpaperOverlay,0,0.9))
      if (args.wallpaperBlur !== undefined) assert(finite(args.wallpaperBlur,0,40))
      if (args.panelBlur !== undefined) assert(finite(args.panelBlur,0,30))
      if (args.floatingOpacity !== undefined) assert(finite(args.floatingOpacity,0,1))
      if (args.panelOpacity !== undefined) assert(finite(args.panelOpacity,0,1))
      if (args.spectrum !== undefined) assert(args.spectrum && typeof args.spectrum.enabled === 'boolean' && typeof args.spectrum.gradient === 'boolean' && /^#[a-f0-9]{6}$/i.test(args.spectrum.color) && /^#[a-f0-9]{6}$/i.test(args.spectrum.secondaryColor))
      break
    case 'app.openExternal': {
      assert(text(args.url, 2048))
      let url: URL
      try { url = new URL(args.url) } catch { throw new MusicError('INVALID_ARGUMENT', '网址无效。') }
      assert(url.protocol === 'https:' && ['music.163.com', 'github.com', 'mpv.io'].includes(url.hostname) && !url.username && !url.password)
      break
    }
  }
}
