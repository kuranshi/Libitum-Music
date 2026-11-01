import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { experienceDefaults } from '../../src/shared/preferences'
import { defaultPeq } from '../../src/shared/peq'
import { Player } from '../../src/main/player'
import { normalizeTrack } from '../../src/main/normalize'
import type { Mpv } from '../../src/main/mpv'
import type { Settings } from '../../src/shared/types'
class FakeMpv extends EventEmitter {
  running = true
  path = ''
  commands: unknown[][] = []
  async start() {}
  async stop() { this.running = false }
  async command(command: unknown[]):Promise<any> {
    this.commands.push(command)
    if (command[0] === 'get_property' && command[1] === 'audio-device-list') return [{ name: 'auto', description: 'Default' }, { name: 'pulse/headphones', description: 'Headphones' }]
    if (command[0] === 'get_property' && command[1] === 'path') return this.path
    if (command[0] === 'loadfile') this.path = String(command[1])
  }
}
const track = (id: number) => normalizeTrack({ id, name: `Song ${id}`, dt: 60000 })
const settings: Settings = { ...experienceDefaults(), quality: 'exhigh', downloadQuality: 'exhigh', downloadDirectory: '/tmp', deviceId: 'auto', volume: 60, theme: 'system', mpvPath: 'mpv' }
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
describe('player state transitions', () => {
  it('replaces only its own PEQ filter and rolls back failed changes without losing playback state',async()=>{
    const mpv=new FakeMpv();let filters:any[]=[{name:'format',label:'other'}],fail=false
    const original=mpv.command.bind(mpv)
    mpv.command=async command=>{
      if(command[0]==='get_property'&&command[1]==='af')return structuredClone(filters)
      if(command[0]==='set_property'&&command[1]==='af'){if(fail){fail=false;throw new Error('filter rejected')}filters=structuredClone(command[2] as any[]);return}
      return original(command)
    }
    const save=vi.fn(),player=new Player(mpv as unknown as Mpv,{call:async()=>({})} as any,settings,()=>{},()=>{},save)
    player.restore({queue:[track(1)],index:0,position:12,repeat:'list'})
    const preset=defaultPeq();preset.enabled=true;preset.bands[0].gain=-3
    await player.applyPeq(preset);preset.preamp=-4;await player.applyPeq(preset)
    expect(filters.filter(f=>f.label==='libitum_peq')).toHaveLength(1);expect(filters[0].label).toBe('other')
    const good=structuredClone(filters);fail=true;preset.preamp=-8
    await expect(player.applyPeq(preset)).rejects.toThrow('filter rejected')
    expect(filters).toEqual(good);expect(save).toHaveBeenCalledTimes(2);expect(player.state.position).toBe(12);expect(player.state.status).toBe('paused')
  })
  it('ignores a slow stream resolution after the user selects another song', async () => {
    let resolveFirst: (value: any) => void = () => {}
    const backend = { call: vi.fn((method: string, args: any) => args.id === '1' ? new Promise(resolve => { resolveFirst = resolve }) : Promise.resolve({ url: 'https://example.com/2', quality: 'exhigh' })) }
    const mpv = new FakeMpv(), player = new Player(mpv as unknown as Mpv, backend as any, settings, () => {}, () => {}, () => {})
    const first = player.play([track(1)])
    await flush()
    await player.play([track(2)])
    resolveFirst({ url: 'https://example.com/1', quality: 'exhigh' }); await first
    expect(mpv.path).toBe('https://example.com/2'); expect(player.state.queue[player.state.index].id).toBe('2')
  })
  it('preserves progress and pause state on quality changes', async () => {
    const mpv = new FakeMpv(), backend = { call: vi.fn(async (_method, args) => ({ url: `https://example.com/${args.quality}`, quality: args.quality })) }
    const player = new Player(mpv as unknown as Mpv, backend as any, settings, () => {}, () => {}, () => {})
    await player.play([track(1)]); mpv.emit('event', { event: 'file-loaded' }); await flush()
    await player.seek(23); await player.toggle(); expect(player.state.status).toBe('paused')
    await player.quality('lossless'); mpv.emit('event', { event: 'file-loaded' }); await flush()
    expect(mpv.commands).toContainEqual(['seek', 23, 'absolute+exact']); expect(player.state.status).toBe('paused')
  })
  it('keeps downgraded quality in audio metadata without a duplicate notice and preserves trial warnings',async()=>{
    const mpv=new FakeMpv(),backend={call:vi.fn(async()=>({url:'https://example.com/audio',quality:'standard',bitrate:128000,trial:false}))}
    const player=new Player(mpv as unknown as Mpv,backend as any,{...settings,quality:'lossless'},()=>{},()=>{},()=>{})
    await player.play([track(1)])
    expect(player.state.actualQuality).toBe('standard');expect(player.state.bitrate).toBe(128000);expect(player.state.requestedQuality).toBe('lossless');expect(player.state.notice).toBeNull()
    backend.call.mockResolvedValue({url:'https://example.com/audio',quality:'standard',bitrate:128000,trial:true})
    await player.play([track(2)])
    expect(player.state.trial).toBe(true);expect(player.state.notice).toContain('试听片段')
  })
  it('pauses on a disconnected pinned device and exposes a useful notice', async () => {
    const mpv = new FakeMpv(), player = new Player(mpv as unknown as Mpv, { call: async () => ({}) } as any, { ...settings, deviceId: 'pulse/headphones' }, () => {}, () => {}, () => {})
    player.restore({ queue: [track(1)], index: 0, position: 10, repeat: 'list' })
    mpv.emit('event', { event: 'property-change', name: 'audio-device-list', data: [{ name: 'auto' }] }); await flush()
    expect(mpv.commands).toContainEqual(['set_property', 'pause', true]); expect(player.state.notice).toContain('已断开'); expect(player.state.position).toBe(10)
  })
  it('stops after an unavailable batch instead of recursing forever', async () => {
    const mpv = new FakeMpv(), backend = { call: vi.fn(async () => { throw Object.assign(new Error('not available'), { name: 'MusicError' }) }) }
    const { MusicError } = await import('../../src/shared/errors')
    backend.call.mockImplementation(async () => { throw new MusicError('UNAVAILABLE', '歌曲不可用') })
    const player = new Player(mpv as unknown as Mpv, backend as any, settings, () => {}, () => {}, () => {})
    await player.play([track(1), track(2), track(3)])
    expect(player.state.status).toBe('error'); expect(backend.call).toHaveBeenCalledTimes(3)
  })
  it('does not restart a late recommendation response after logout stops playback', async () => {
    let finish: (tracks: any[]) => void = () => {}
    const mpv = new FakeMpv(), backend = { call: () => new Promise(resolve => { finish = resolve }) }
    const player = new Player(mpv as unknown as Mpv, backend as any, settings, () => {}, () => {}, () => {})
    const pending = player.radio({ mode: 'EXPLORE' })
    await player.stop(); finish([track(1)]); await pending
    expect(player.state.queue).toHaveLength(0); expect(player.state.radio).toBeNull()
  })
})

describe('authoritative playback progress recovery',()=>{
  it('reads actual mpv time if position notifications stop and never advances a paused clock',async()=>{
    vi.useFakeTimers()
    const mpv=new FakeMpv(),original=mpv.command.bind(mpv);let position=2
    mpv.command=async command=>command[0]==='get_property'&&command[1]==='time-pos'?position:original(command)
    const emit=vi.fn(),player=new Player(mpv as unknown as Mpv,{call:async()=>({url:'https://example.com/audio',quality:'exhigh'})} as any,settings,emit,()=>{},()=>{})
    try{
      await player.play([track(1)]);mpv.emit('event',{event:'file-loaded'});await flush()
      mpv.emit('event',{event:'property-change',name:'time-pos',data:2});await flush()
      position=5;await vi.advanceTimersByTimeAsync(1100);expect(player.state.position).toBe(5)
      await player.toggle();position=9;await vi.advanceTimersByTimeAsync(1500);expect(player.state.position).toBe(5)
    }finally{await player.dispose();vi.useRealTimers()}
  })
  it('discards a late clock read after a seek',async()=>{
    vi.useFakeTimers()
    const mpv=new FakeMpv(),original=mpv.command.bind(mpv);let finish!:(value:number)=>void
    mpv.command=async command=>command[0]==='get_property'&&command[1]==='time-pos'?new Promise<number>(resolve=>{finish=resolve}):original(command)
    const player=new Player(mpv as unknown as Mpv,{call:async()=>({url:'https://example.com/audio',quality:'exhigh'})} as any,settings,()=>{},()=>{},()=>{})
    try{
      await player.play([track(1)]);mpv.emit('event',{event:'file-loaded'});await flush()
      await vi.advanceTimersByTimeAsync(1000);await player.seek(23);finish(3);await flush();expect(player.state.position).toBe(23)
    }finally{await player.dispose();vi.useRealTimers()}
  })
})
