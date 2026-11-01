import type { DownloadTask, PeqSettings, PlayerState, Quality, RadioSpec, Settings, Stream, Track } from '../shared/types'
import { resolveDevices } from './devices'
import { defaultPeq, peqGraph, validPeq } from '../shared/peq'
import { MusicError } from '../shared/errors'
import { Mpv } from './mpv'
import { nextIndex } from './queue'

export interface Backend {
  call<T = any>(method: string, args?: any): Promise<T>
}
export interface SavedQueue { queue: Track[]; index: number; position: number; repeat: PlayerState['repeat'] }
export class Player {
  readonly state: PlayerState
  private generation = 0
  private radioRequest = 0
  private loading: { generation: number; url: string; position: number; paused: boolean } | null = null
  private loaded = false
  private local: { id: string; provider: Track['provider']; stream: Stream } | null = null
  private failedIds = new Set<string>()
  private refreshed = new Set<string>()
  private radioLoading: Promise<void> | null = null
  private listened = 0
  private lastTime = 0
  private lastEmit = 0
  private lastPositionEvent = 0
  private seekRevision = 0
  private progressTimer: ReturnType<typeof setInterval> | null = null
  private pollingProgress = false
  private deviceRevision = 0
  private deviceKey: string
  private peqSettings: PeqSettings
  private peqTail: Promise<void> = Promise.resolve()
  constructor(private mpv: Mpv, private backend: Backend, settings: Settings, private emit: (state: PlayerState) => void, private save: () => void, private saveSettings: (patch: Partial<Settings>) => void) {
    this.deviceKey = settings.deviceKey || ''
    this.peqSettings = validPeq(settings.peq) ? settings.peq : defaultPeq()
    this.state = { queue: [], index: -1, status: 'idle', position: 0, duration: 0, volume: settings.volume, repeat: 'list', requestedQuality: settings.quality, actualQuality: '', bitrate: 0, trial: false, deviceId: settings.deviceId, devices: [{ id: 'auto', label: '跟随系统默认' }], available: false, error: null, notice: null, radio: null }
    mpv.on('event', event => { void this.onEvent(event).catch(() => { this.state.notice = '播放器状态更新失败，请重试。'; this.changed() }) })
    mpv.on('crashed', () => { this.generation++; this.loaded = false; this.loading = null; this.state.available = false; this.state.status = 'error'; this.state.error = 'mpv 已退出，请在设置中重新检测播放器。'; this.changed() })
  }
  snapshot(): PlayerState { return structuredClone(this.state) }
  saved(): SavedQueue { return { queue: this.state.queue, index: this.state.index, position: this.state.position, repeat: this.state.repeat } }
  restore(value: SavedQueue) {
    if (!Array.isArray(value.queue) || value.queue.some(track => track.provider !== value.queue[0]?.provider)) {
      this.state.queue = []; this.state.index = -1; this.state.position = 0; this.state.duration = 0; this.state.status = 'idle'
      return
    }
    this.state.queue = value.queue.slice(0, 10000)
    this.state.index = Math.min(Math.max(-1, value.index || 0), this.state.queue.length - 1)
    this.state.position = Math.max(0, value.position || 0)
    this.state.duration = (this.current()?.durationMs || 0) / 1000
    if (['list', 'one', 'shuffle'].includes(value.repeat)) this.state.repeat = value.repeat
    this.state.status = this.current() ? 'paused' : 'idle'
  }
  private watchProgress() {
    if(this.progressTimer)return
    this.progressTimer=setInterval(()=>void this.refreshProgress(),500)
    this.progressTimer.unref?.()
  }
  private updatePosition(position:number) {
    const delta=position-this.lastTime
    if(this.state.status==='playing'&&delta>0&&delta<3)this.listened+=delta
    this.lastTime=position;this.state.position=position
  }
  private async refreshProgress() {
    if(this.pollingProgress||!this.loaded||this.state.status!=='playing'||!this.mpv.running||Date.now()-this.lastPositionEvent<750)return
    this.pollingProgress=true;const generation=this.generation,seek=this.seekRevision
    try{
      const position=await this.mpv.command(['get_property','time-pos'])
      if(generation!==this.generation||seek!==this.seekRevision||!this.loaded||this.state.status!=='playing')return
      if(typeof position==='number'&&Number.isFinite(position)&&position>=0){this.updatePosition(position);this.changed()}
    }catch{/* The process-exit handler reports player failure; do not fabricate elapsed time. */}
    finally{this.pollingProgress=false}
  }
  private current() { return this.state.queue[this.state.index] }
  private changed(persist = false) { this.emit(this.snapshot()); if (persist) this.save() }
  async initialize() {
    try {
      await this.mpv.start()
      this.state.available = true; this.state.error = null
      await this.mpv.command(['set_property', 'volume', this.state.volume])
      await this.refreshDevices()
      if (this.peqSettings.enabled) await this.applyPeq(this.peqSettings, false)
    } catch (error) {
      this.state.available = false; this.state.error = error instanceof MusicError ? error.message : '无法连接 mpv。'
    }
    this.changed()
  }
  async refreshDevices() {
    if (!this.mpv.running) { await this.initialize(); return }
    const devices = await this.mpv.command(['get_property', 'audio-device-list'])
    await this.updateDevices(devices)
  }
  private async updateDevices(raw: Array<{ name: string; description: string }>) {
    const revision = ++this.deviceRevision
    const devices = await resolveDevices(raw)
    if (revision !== this.deviceRevision) return
    this.state.devices = devices
    const match = this.deviceKey && devices.find(d => d.key === this.deviceKey)
    if (match && match.id !== this.state.deviceId) { this.state.deviceId = match.id; this.saveSettings({ deviceId: match.id, deviceKey: match.key }) }
    if (!this.deviceKey) { const existing = devices.find(d => d.id === this.state.deviceId); if (existing?.key) { this.deviceKey = existing.key; this.saveSettings({ deviceKey: existing.key }) } }
    if (this.state.deviceId !== 'auto' && !devices.some(device => device.id === this.state.deviceId)) {
      if (this.mpv.running) await this.mpv.command(['set_property', 'pause', true]).catch(() => {})
      this.state.status = this.current() ? 'paused' : 'idle'
      this.state.notice = '指定输出设备已断开，请选择可用设备后继续播放。'
    }
    this.changed()
  }
  async device(id: string) {
    if (!this.state.devices.some(device => device.id === id)) throw new MusicError('DEVICE_MISSING', '输出设备已不可用，请刷新设备列表。')
    if (!this.mpv.running) await this.initialize()
    await this.mpv.command(['set_property', 'audio-device', id])
    this.state.deviceId = id; this.deviceKey = this.state.devices.find(d => d.id === id)?.key || id; this.state.notice = null; this.saveSettings({ deviceId: id, deviceKey: this.deviceKey }); this.changed()
  }
  get processId() { return this.mpv.pid }
  applyPeq(value: PeqSettings, persist = true): Promise<void> {
    if (!validPeq(value)) return Promise.reject(new MusicError('INVALID_ARGUMENT', 'PEQ 参数无效。'))
    const requested = structuredClone(value)
    const operation = this.peqTail.catch(() => {}).then(async () => {
      if (!this.mpv.running) throw new MusicError('MPV_UNAVAILABLE', '播放器尚未就绪。')
      const previous = await this.mpv.command(['get_property', 'af']) || []
      const rate = await this.mpv.command(['get_property', 'audio-params/samplerate']).catch(() => 48000) || 48000
      const chain = previous.filter((filter: any) => filter.label !== 'libitum_peq')
      if (requested.enabled) chain.push({ name: 'lavfi', label: 'libitum_peq', enabled: true, params: { graph: peqGraph(requested, rate) } })
      try { await this.mpv.command(['set_property', 'af', chain]) }
      catch (error) { await this.mpv.command(['set_property', 'af', previous]).catch(() => {}); throw error }
      this.peqSettings = requested
      if (persist) this.saveSettings({ peq: requested })
      if (requested.enabled && requested.bands.some(b => b.enabled && b.gain && b.frequency >= rate / 2)) this.state.notice = '部分 PEQ 频段高于当前音频采样率的有效范围，本曲暂不应用这些频段。'
      this.changed()
    })
    this.peqTail = operation
    return operation
  }
  private assertDevice() { if (!this.state.devices.some(device => device.id === this.state.deviceId)) throw new MusicError('DEVICE_MISSING', '请选择可用的输出设备。') }
  async play(tracks: Track[], index = 0, append = false) {
    if (!tracks.length) throw new MusicError('EMPTY', '没有可播放的歌曲。')
    const provider = tracks[0].provider
    if (tracks.some(track => track.provider !== provider) || append && this.state.queue.some(track => track.provider !== provider)) throw new MusicError('PLATFORM_MISMATCH', '请在当前音乐平台内选择歌曲，切换平台后重新打开歌单。')
    if (append) {
      this.state.queue.push(...tracks)
      this.state.queue = this.state.queue.slice(0, 10000)
      if (this.state.index < 0) { this.state.index = 0; this.state.status = 'paused' }
      this.changed(true); return
    }
    this.report(); this.local = null; this.state.radio = null
    this.state.queue = tracks.slice(0, 10000); this.state.index = Math.min(Math.max(0, index), this.state.queue.length - 1)
    this.failedIds.clear(); this.refreshed.clear()
    await this.load(this.state.index)
  }
  async playDownload(task: DownloadTask) {
    this.report(); this.state.radio = null; this.state.queue = [task.track]; this.state.index = 0
    this.local = { id: task.track.id, provider: task.track.provider, stream: { url: task.path!, quality: task.actualQuality || task.quality, bitrate: 0, format: '', size: task.total, trial: false } }
    this.failedIds.clear(); this.refreshed.clear()
    await this.load(0)
  }
  private async load(index: number, position = 0, paused = false) {
    const track = this.state.queue[index]
    if (!track) return
    const generation = ++this.generation
    this.state.index = index; this.state.status = 'loading'; this.state.error = null; this.state.notice = null
    this.state.position = position; this.state.duration = track.durationMs / 1000; this.loaded = false
    this.changed(true)
    try {
      if (!this.mpv.running) await this.initialize()
      if (generation !== this.generation) return
      this.assertDevice()
      await this.mpv.command(['set_property', 'pause', true])
      if (generation !== this.generation) return
      const stream = this.local?.id === track.id && this.local.provider === track.provider ? this.local.stream : await this.backend.call<Stream>('resolve', { id: track.id, provider: track.provider, quality: this.state.requestedQuality })
      if (generation !== this.generation) return
      this.state.actualQuality = stream.quality; this.state.bitrate = stream.bitrate; this.state.trial = stream.trial
      if (stream.trial) this.state.notice = '当前账号只能播放本歌曲的试听片段。'
      await this.mpv.command(['set_property', 'pause', true])
      if (generation !== this.generation) return
      await this.mpv.command(['set_property', 'audio-device', this.state.deviceId])
      if (generation !== this.generation) return
      this.loading = { generation, url: stream.url, position, paused }
      this.listened = 0; this.lastTime = position
      await this.mpv.command(['loadfile', stream.url, 'replace'])
    } catch (error) {
      if (generation !== this.generation) return
      this.loading = null
      const problem = error instanceof MusicError ? error : new MusicError('PLAYBACK', '无法播放这首歌曲。')
      if (['UNAVAILABLE', 'UPSTREAM'].includes(problem.code)) { await this.skipFailed(track.id, problem.message); return }
      this.state.status = 'error'; this.state.error = problem.message; this.changed(true)
    }
  }
  private async skipFailed(id: string, message: string) {
    this.failedIds.add(id)
    const candidate = this.state.queue.findIndex((track, index) => index > this.state.index && !this.failedIds.has(track.id))
    if (candidate >= 0 && this.failedIds.size < 5) { this.state.notice = message; this.changed(); await this.load(candidate); return }
    this.state.status = 'error'; this.state.error = `连续歌曲无法播放，已停止。${message}`; this.changed(true)
  }
  private async onEvent(event: any) {
    if (event.event === 'property-change') {
      if (event.name === 'audio-device-list') { await this.updateDevices(event.data); return }
      if (event.name === 'time-pos' && typeof event.data === 'number' && Number.isFinite(event.data) && this.loaded) {
        this.lastPositionEvent=Date.now();this.updatePosition(event.data)
      }
      if (event.name === 'duration' && typeof event.data === 'number' && (this.loaded || this.loading)) this.state.duration = event.data
      if (event.name === 'pause' && typeof event.data === 'boolean' && this.loaded && this.state.status !== 'loading') this.state.status = event.data ? 'paused' : 'playing'
      if (Date.now() - this.lastEmit > 200) { this.lastEmit = Date.now(); this.changed() }
    }
    if (event.event === 'file-loaded' && this.loading) {
      const load = this.loading
      const path = await this.mpv.command(['get_property', 'path'])
      if (load !== this.loading || load.generation !== this.generation || path !== load.url) return
      if (load.position > 0) await this.mpv.command(['seek', load.position, 'absolute+exact'])
      if (load !== this.loading || load.generation !== this.generation) return
      if (this.peqSettings.enabled) await this.applyPeq(this.peqSettings, false)
      if (load !== this.loading || load.generation !== this.generation) return
      await this.mpv.command(['set_property', 'pause', load.paused])
      if (load.generation !== this.generation) return
      this.loading = null; this.loaded = true; this.failedIds.clear()
      this.state.status = load.paused ? 'paused' : 'playing'; this.lastPositionEvent=Date.now();this.watchProgress();this.changed(true)
    }
    if (event.event === 'end-file') {
      if (event.reason === 'eof') { this.report(); this.loaded = false; await this.next(true) }
      if (event.reason === 'error' && this.current()) {
        const track = this.current()!
        if (!this.refreshed.has(track.id) && !this.local) { this.refreshed.add(track.id); await this.load(this.state.index, this.state.position) }
        else await this.skipFailed(track.id, '音频加载失败，请检查网络或账号权限。')
      }
    }
  }
  async toggle() {
    if (!this.current()) return
    this.assertDevice()
    if (!this.loaded) { await this.load(this.state.index, this.state.position); return }
    const paused = this.state.status === 'playing'
    await this.mpv.command(['set_property', 'pause', paused]); this.state.status = paused ? 'paused' : 'playing'; this.changed(true)
  }
  async seek(seconds: number) {
    this.seekRevision++
    const position = Math.max(0, Math.min(seconds, this.state.duration || seconds))
    if (this.loaded) await this.mpv.command(['seek', position, 'absolute+exact'])
    this.state.position = position; this.lastTime = position; this.changed(true)
  }
  async volume(volume: number) {
    this.state.volume = Math.max(0, Math.min(100, volume))
    if (this.mpv.running) await this.mpv.command(['set_property', 'volume', this.state.volume])
    this.saveSettings({ volume: this.state.volume }); this.changed()
  }
  repeat(mode: PlayerState['repeat']) { this.state.repeat = mode; this.changed(true) }
  async quality(quality: Quality) {
    this.state.requestedQuality = quality; this.saveSettings({ quality }); this.changed()
    if (this.current() && this.loaded && !this.local) await this.load(this.state.index, this.state.position, this.state.status !== 'playing')
  }
  async next(ended = false) {
    if (!this.current()) return
    const generation = this.generation
    this.report()
    if (this.state.radio) {
      if (this.state.index >= this.state.queue.length - 3) await this.fillRadio()
      if (generation !== this.generation) return
      if (this.state.index + 1 >= this.state.queue.length) { this.state.status = 'paused'; this.state.notice = '推荐流暂时没有更多歌曲，点击下一首重试。'; this.changed(); return }
      await this.load(this.state.index + 1); return
    }
    await this.load(nextIndex(this.state.index, this.state.queue.length, this.state.repeat, ended))
  }
  async previous() {
    if (!this.current()) return
    if (this.state.position > 3) { await this.seek(0); return }
    this.report(); await this.load((this.state.index - 1 + this.state.queue.length) % this.state.queue.length)
  }
  async radio(spec: RadioSpec) {
    const generation = this.generation, request = ++this.radioRequest
    const tracks = await this.backend.call<Track[]>('radio', spec)
    if (generation !== this.generation || request !== this.radioRequest) return
    if (!tracks.length) throw new MusicError('EMPTY', '暂时没有推荐歌曲，请稍后重试。')
    if (tracks.some(track => track.provider !== tracks[0].provider)) throw new MusicError('PLATFORM_MISMATCH', '推荐结果来自不同音乐平台，请重新打开推荐。')
    this.report(); this.local = null; this.state.radio = spec; this.state.queue = tracks; this.state.index = 0
    this.failedIds.clear(); this.refreshed.clear(); await this.load(0)
  }
  private async fillRadio() {
    if (this.radioLoading) return this.radioLoading
    const spec = this.state.radio
    if (!spec) return
    const generation = this.generation, provider = this.current()?.provider
    const loading = (async () => {
      try {
        const tracks = await this.backend.call<Track[]>('radio', { ...spec, provider })
        if (this.state.radio !== spec || generation !== this.generation) return
        if (tracks.some(track => track.provider !== provider)) throw new MusicError('PLATFORM_MISMATCH', '推荐平台已改变，请重新开始漫游。')
        const ids = new Set(this.state.queue.slice(-30).map(track => track.id))
        const fresh = tracks.filter(track => !ids.has(track.id))
        this.state.queue.push(...(fresh.length ? fresh : tracks.filter(track => track.id !== this.current()?.id)))
        if (this.state.queue.length > 300) { const drop = Math.min(this.state.index, this.state.queue.length - 300); this.state.queue.splice(0, drop); this.state.index -= drop }
        this.changed(true)
      } catch { if (this.state.radio === spec && generation === this.generation) { this.state.notice = '补充推荐歌曲失败，可点击下一首重试。'; this.changed() } }
    })().finally(() => { if (this.radioLoading === loading) this.radioLoading = null })
    this.radioLoading = loading
    return loading
  }
  async dislike() {
    const track = this.current(), generation = this.generation
    if (!this.state.radio || !track) return
    await this.backend.call('dislike', { id: track.id, provider: track.provider })
    if (generation === this.generation) await this.next()
  }
  async remove(index: number) {
    if (index < 0 || index >= this.state.queue.length) return
    if (index === this.state.index) {
      this.report(); this.generation++; this.loading = null
      this.state.queue.splice(index, 1)
      if (!this.state.queue.length) { await this.stop(false); return }
      await this.load(Math.min(index, this.state.queue.length - 1)); return
    }
    this.state.queue.splice(index, 1); if (index < this.state.index) this.state.index--; this.changed(true)
  }
  private report() {
    const track = this.current(), seconds = this.listened
    this.listened = 0
    if (track && seconds >= 10 && !this.local) void this.backend.call('scrobble', { id: track.id, provider: track.provider, seconds }).catch(() => {})
  }
  /** Clear account-bound playback synchronously before awaiting the mpv stop. */
  reset() { return this.stop(true) }
  async stop(clear = true) {
    if(this.progressTimer)clearInterval(this.progressTimer);this.progressTimer=null
    this.report(); this.generation++; this.radioRequest++; this.radioLoading = null; this.loading = null; this.loaded = false; this.local = null
    if (clear) this.state.queue = []
    this.failedIds.clear(); this.refreshed.clear()
    this.state.index = this.state.queue.length ? 0 : -1; this.state.status = 'idle'; this.state.radio = null; this.state.position = 0; this.state.duration = 0; this.state.error = null; this.state.notice = null; this.state.actualQuality = ''; this.state.bitrate = 0; this.state.trial = false; this.changed(true)
    if (this.mpv.running) await this.mpv.command(['stop']).catch(() => {})
  }
  async dispose() { if(this.progressTimer)clearInterval(this.progressTimer);this.progressTimer=null;this.generation++; await this.mpv.stop() }
  async restart() { this.generation++; this.loaded = false; this.loading = null; await this.mpv.stop(); if (this.current()) this.state.status = 'paused'; await this.initialize() }
}
