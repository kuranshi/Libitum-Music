import { join } from 'node:path'
import { NeteaseProvider, type ApiModule } from './provider'
import { QqMusicProvider } from './qqmusic-provider'
import { createQqMusicRuntime } from './qqmusic-runtime'
import { createQqMusicFixture } from './qqmusic-fixtures'
import { PlatformRouter } from './platform-router'
import { Downloads } from './downloads'
import { JsonStore } from './store'
import { MusicError, publicError } from '../shared/errors'
import type { DownloadTask, ProviderId } from '../shared/types'
import { accountKey, PLATFORM_IDS, isProvider } from '../shared/platforms'
import { createFixtureApi } from './test-fixtures'
import { setDefaultResultOrder } from 'node:dns'
import { setDefaultAutoSelectFamily } from 'node:net'
import { createRequire } from 'node:module'
import { runtimeOptions } from './netease-runtime'

const port = process.parentPort!
let platforms: PlatformRouter
let downloads: Downloads
const sessionVersion: Record<ProviderId, number> = { netease: 0, qq: 0 }
const sessionEpoch: Record<ProviderId, number> = { netease: 0, qq: 0 }
const owners: Record<ProviderId, string> = { netease: '', qq: '' }
let enabled: ProviderId[] = ['netease']
function syncOwners() { downloads.setOwners(enabled.map(id => owners[id]).filter(Boolean)) }
function run<T>(provider: ProviderId, operation: (p: import('./provider').MusicProvider) => Promise<T> | T) {
  if (!isProvider(provider) || !enabled.includes(provider)) throw new MusicError('PLATFORM_DISABLED', '该音乐平台已关闭，请在设置中开启。')
  return platforms.run(operation, provider)
}
function send(value: unknown) { port.postMessage(value) }
async function dispatch(method: string, args: any) {
  if (method === 'init') {
    setDefaultResultOrder('ipv4first')
    setDefaultAutoSelectFamily(true)
    const api = args.testMode ? createFixtureApi(args.testUrl, args.testQrScenario) : require('@neteasecloudmusicapienhanced/api') as ApiModule
    if (!args.testMode) {
      const upstreamRequire = createRequire(require.resolve('@neteasecloudmusicapienhanced/api'))
      upstreamRequire('axios').default.defaults.timeout = 10000
    }
    enabled = args.enabledProviders || ['netease']
    const credentials = (provider: ProviderId) => (cookie: string, user: unknown) => send({ event: 'credentials', data: { cookie, user, provider, epoch: sessionEpoch[provider] } })
    const netease = new NeteaseProvider(api, { ...(args.testMode ? {} : await runtimeOptions(api, args.userData, process.env.TMPDIR!)), onCredentials: credentials('netease') })
    platforms = new PlatformRouter(netease, async () => new QqMusicProvider(args.testMode ? createQqMusicFixture(args.testUrl, args.testQrScenario) : await createQqMusicRuntime(args.userData), { onCredentials: credentials('qq') }))
    downloads = new Downloads(new JsonStore<DownloadTask[]>(join(args.userData, 'downloads.json'), []), async (track, quality) => {
      const provider = track.provider, version = sessionVersion[provider], epoch = sessionEpoch[provider]
      try { return await run(provider, p => p.resolve(track.id, quality, true)) }
      catch (error) { if (version === sessionVersion[provider] && error instanceof MusicError && error.code === 'AUTH_EXPIRED') send({ event: 'expired', data: { provider, epoch } }); throw error }
    }, tasks => send({ event: 'downloads', data: tasks }), message => send({ event: 'notice', data: message }))
    await downloads.init(args.directory)
    return true
  }
  if (!platforms || !downloads) throw new MusicError('NOT_READY', '后台尚未就绪。')
  switch (method) {
    case 'session.set': {
      const provider: ProviderId = args.provider
      const version = ++sessionVersion[provider]
      sessionEpoch[provider] = args.epoch ?? 0
      await platforms.setSession(provider, args.cookie, args.user)
      if (version !== sessionVersion[provider]) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新登录。')
      owners[provider] = args.user ? accountKey(provider, args.user.id) : ''; syncOwners()
      return true
    }
    case 'session.clear': { const provider: ProviderId = args.provider; sessionVersion[provider]++; sessionEpoch[provider] = args.epoch; await platforms.clear(provider); owners[provider] = ''; syncOwners(); return true }
    case 'settings.platforms': { const next = PLATFORM_IDS.filter(id => args.enabledProviders.includes(id)); if (!next.length) throw new MusicError('INVALID_ARGUMENT', '至少开启一个音乐平台。'); for (const id of enabled.filter(id => !next.includes(id))) platforms.invalidate(id); enabled = next; syncOwners(); return true }
    case 'auth.qrStart': return (await platforms.candidate(args?.provider || 'netease')).qrStart()
    case 'auth.qrCheck': return (await platforms.candidate(args.provider || 'netease')).qrCheck(args.key)
    case 'auth.qrCancel': return (await platforms.candidate(args.provider || 'netease')).qrCancel(args.key)
    case 'auth.importCookie': return (await platforms.candidate(args.provider || 'netease')).validateSession(args.cookie)
    case 'catalog.search': return run(args.provider, p => p.search(args.keywords, args.kind, args.offset))
    case 'catalog.detail': return run(args.provider, p => p.detail(args.kind, args.id, args.offset))
    case 'catalog.allTracks': return run(args.provider, p => p.allTracks(args.kind, args.id))
    case 'catalog.lyrics': return run(args.provider, p => p.lyrics(args.id))
    case 'catalog.artistAlbums': return run(args.provider, p => p.artistAlbums(args.id, args.offset))
    case 'catalog.comments': return run(args.provider, p => p.comments(args.id, args.offset))
    case 'home.section': return run(args.provider, p => p.home(args.section))
    case 'library.list': return run(args.provider, p => p.library(args.kind, args.offset))
    case 'library.like': return run(args.provider, p => p.like(args.id, args.like))
    case 'library.subscribe': return run(args.provider, p => p.subscribe(args.kind, args.id, args.subscribe))
    case 'library.subscription': return run(args.provider, p => p.subscription(args.kind, args.id))
    case 'library.writablePlaylists': return run(args.provider, p => p.writablePlaylists(args.offset))
    case 'library.addToPlaylist': return run(args.provider, p => p.addToPlaylist(args.id, args.trackId))
    case 'library.diagnostics': return run(args.provider, p => p.diagnostics())
    case 'resolve': return run(args.provider, p => p.resolve(args.id, args.quality))
    case 'radio': return run(args.provider, p => p.radio(args))
    case 'dislike': return run(args.provider, p => p.dislike(args.id))
    case 'scrobble': return run(args.provider, p => p.scrobble(args.id, args.seconds))
    case 'downloads.list': return downloads.list()
    case 'downloads.add': return downloads.add(args.tracks, args.quality)
    case 'downloads.cancel': return downloads.cancel(args.id)
    case 'downloads.retry': return downloads.retry(args.id, args.quality)
    case 'downloads.get': return downloads.get(args.id)
    case 'settings.directory': downloads.configure(args.directory); return true
    case 'close': await downloads.close(); return true
    default: throw new MusicError('INVALID_COMMAND', '后台操作不受支持。')
  }
}
port.on('message', async ({ data }) => {
  const { id, method, args } = data
  const provider: ProviderId | undefined = isProvider(args?.provider) ? args.provider : undefined
  const version = provider ? sessionVersion[provider] : -1, epoch = provider ? sessionEpoch[provider] : -1
  try { send({ id, ok: true, data: await dispatch(method, args) }) }
  catch (error) {
    const problem = publicError(error)
    if (provider && version === sessionVersion[provider] && problem.code === 'AUTH_EXPIRED' && !method.startsWith('auth.')) send({ event: 'expired', data: { provider, epoch } })
    send({ id, ok: false, error: problem })
  }
})
