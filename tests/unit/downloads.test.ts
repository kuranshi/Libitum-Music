import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Downloads, safeFilename } from '../../src/main/downloads'
import { JsonStore } from '../../src/main/store'
import { normalizeTrack } from '../../src/main/normalize'
import type { DownloadTask, Stream, Track } from '../../src/shared/types'
const song = (id: number) => normalizeTrack({ id, name: '同名歌曲', artists: [{ id: 3, name: '歌手' }] })
const stream = (id: string, quality = 'exhigh'): Stream => ({ url: `https://example.com/${id}`, quality, bitrate: 320000, format: 'mp3', size: 4, trial: false })
const response = () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'audio/mpeg', 'content-length': '4' } })
describe('download lifecycle', () => {
  let directory: string, manager: Downloads
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'music-download-')); vi.stubGlobal('fetch', vi.fn(async () => response())) })
  afterEach(async () => { if (manager) await manager.close(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }) })
  async function create(resolve: (track: Track, quality: any) => Promise<Stream>) {
    manager = new Downloads(new JsonStore<DownloadTask[]>(join(directory, 'tasks.json'), []), resolve, () => {}, () => {})
    await manager.init(directory); manager.setOwner('42'); return manager
  }
  it('never overwrites an existing audio file and removes the temporary file after completion', async () => {
    const dm = await create(async track => stream(track.id))
    const existing = join(directory, safeFilename('歌手 - 同名歌曲') + ' [netease-1-exhigh].mp3')
    await writeFile(existing, 'existing file')
    dm.add([song(1)], 'exhigh')
    await vi.waitFor(() => expect(dm.list()[0].status).toBe('completed'))
    expect(await readFile(existing, 'utf8')).toBe('existing file')
    expect(await readFile(dm.list()[0].path!)).toEqual(Buffer.from([1, 2, 3, 4]))
    expect((await readdir(directory)).some(name => name.endsWith('.part'))).toBe(false)
    dm.add([song(1)], 'exhigh'); expect(dm.list()).toHaveLength(1)
  })
  it('fails a downgraded stream before writing bytes, then retries with the newly chosen quality', async () => {
    const dm = await create(async track => stream(track.id, 'standard'))
    dm.add([song(1)], 'lossless')
    await vi.waitFor(() => expect(dm.list()[0].status).toBe('failed'))
    expect(dm.list()[0].error).toContain('所选音质不可用'); expect(fetch).not.toHaveBeenCalled()
    dm.retry(dm.list()[0].id, 'standard')
    await vi.waitFor(() => expect(dm.list()[0].status).toBe('completed'))
    expect(dm.list()[0].quality).toBe('standard')
  })
  it('limits concurrent resolution to two jobs and cancellation prevents stale download starts', async () => {
    const releases: Array<() => void> = []
    const resolver = vi.fn((track: Track) => new Promise<Stream>(resolve => releases.push(() => resolve(stream(track.id)))))
    const dm = await create(resolver)
    dm.add([song(1), song(2), song(3)], 'exhigh')
    expect(resolver).toHaveBeenCalledTimes(2)
    const first = dm.list()[0].id; dm.cancel(first); releases[0]()
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(3))
    expect(dm.list()[0].status).toBe('cancelled'); expect(fetch).not.toHaveBeenCalled()
    releases[1](); releases[2]()
    await vi.waitFor(() => expect(dm.list().filter(task => task.status === 'completed')).toHaveLength(2))
  })
  it('migrates legacy account records and keeps identical IDs isolated by music platform', async () => {
    const store = new JsonStore<DownloadTask[]>(join(directory, 'tasks.json'), [])
    await store.write([{ id: 'legacy', ownerId: '42', track: song(1), quality: 'exhigh', status: 'completed', received: 4, total: 4, createdAt: 0 }])
    const resolve = vi.fn(async (track: Track) => stream(`${track.provider}-${track.id}`))
    manager = new Downloads(store, resolve, () => {}, () => {})
    await manager.init(directory); manager.setOwner('netease:42')
    expect(manager.list()).toHaveLength(1)
    manager.add([song(1)], 'exhigh'); expect(resolve).not.toHaveBeenCalled()
    manager.setOwner('qq:42'); expect(manager.list()).toHaveLength(0)
    const qqSong: Track = { ...song(1), provider: 'qq' }
    manager.add([qqSong], 'exhigh')
    await vi.waitFor(() => expect(manager.list()[0].status).toBe('completed'))
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ provider: 'qq', id: '1' }), 'exhigh')
    expect(() => manager.add([song(1)], 'exhigh')).toThrow('不属于当前登录')
    manager.setOwner('netease:42'); expect(manager.list()[0].id).toBe('legacy')
  })
  it('starts a new account download while old resolutions are pending and discards late results', async () => {
    const releases: Array<() => void> = []
    const resolver = vi.fn((track: Track) => track.provider === 'netease' ? new Promise<Stream>(resolve => releases.push(() => resolve(stream(track.id)))) : Promise.resolve(stream(`qq-${track.id}`)))
    const dm = await create(resolver)
    dm.add([song(1), song(2), song(3)], 'exhigh')
    expect(resolver).toHaveBeenCalledTimes(2)
    dm.setOwner('qq:42')
    dm.add([{ ...song(1), provider: 'qq' }], 'exhigh')
    await vi.waitFor(() => expect(dm.list()[0].status).toBe('completed'))
    expect(resolver).toHaveBeenCalledTimes(3)
    releases.forEach(release => release())
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(fetch).toHaveBeenCalledWith('https://example.com/qq-1', expect.anything())
    dm.setOwner('netease:42')
    expect(dm.list().map(task => task.status)).toEqual(['interrupted', 'interrupted', 'interrupted'])
    expect(resolver).toHaveBeenCalledTimes(3)
    expect((await readdir(directory)).some(name => name.endsWith('.part'))).toBe(false)
  })
  it('shares the two-job limit across platforms and disables only one owner without losing its records', async () => {
    const releases = new Map<string, () => void>()
    const resolver = vi.fn((track: Track) => new Promise<Stream>(resolve => releases.set(`${track.provider}:${track.id}`, () => resolve(stream(`${track.provider}-${track.id}`)))))
    const dm = await create(resolver)
    dm.setOwners(['netease:42', 'qq:42'])
    dm.add([song(1), { ...song(1), provider: 'qq' }, { ...song(2), provider: 'qq' }], 'exhigh')
    expect(resolver).toHaveBeenCalledTimes(2)
    dm.setOwners(['qq:42'])
    expect(resolver).toHaveBeenCalledTimes(3)
    expect(dm.list().map(task => task.track.provider)).toEqual(['qq', 'qq'])
    for (const release of releases.values()) release()
    await vi.waitFor(() => expect(dm.list().every(task => task.status === 'completed')).toBe(true))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).not.toHaveBeenCalledWith('https://example.com/netease-1', expect.anything())
    dm.setOwners(['netease:42', 'qq:42'])
    expect(dm.list().find(task => task.track.provider === 'netease')?.status).toBe('interrupted')
    expect(dm.list()).toHaveLength(3)
  })
  it('aborts an active transfer and removes partial audio when the owner changes', async () => {
    let aborted = false
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        options.signal.addEventListener('abort', () => { aborted = true; controller.error(options.signal.reason) }, { once: true })
      }
    }), { headers: { 'content-type': 'audio/mpeg', 'content-length': '4' } })))
    const dm = await create(async track => stream(track.id))
    dm.add([song(1)], 'exhigh')
    await vi.waitFor(() => expect(dm.list()[0].status).toBe('downloading'))
    dm.setOwner('qq:42')
    await vi.waitFor(() => expect(aborted).toBe(true))
    await vi.waitFor(async () => expect((await readdir(directory)).filter(name => name.endsWith('.part') || name.endsWith('.mp3'))).toHaveLength(0))
    dm.setOwner('netease:42'); expect(dm.list()[0].status).toBe('interrupted')
  })
})
