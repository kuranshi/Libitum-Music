import { describe,expect,it } from 'vitest'
import { parsePeq,defaultPeq,peqGraph,validPeq } from '../../src/shared/peq'
import { normalizeExperience } from '../../src/shared/preferences'
import { groupDevices } from '../../src/main/devices'
import { spectrum } from '../../src/main/spectrum-fft'
import { validateCommand } from '../../src/main/validation'
describe('experience settings and audio processing',()=>{
  it('parses APO peak and shelf filters, preamp, disabled bands and comments',()=>{
    const result=parsePeq('\uFEFFPreamp: -6 dB\nFilter 1: ON PK Fc 1000 Hz Gain -4.2 dB Q 1.4\nFilter 2: OFF LSC Fc 105 Hz Gain 5.5 dB Q 0.71 # shelf\nFilter 3: ON HSC Fc 9000 Hz Gain -2 dB Q 0.7')
    expect(result.preamp).toBe(-6);expect(result.bands[1]).toMatchObject({enabled:false,type:'LS'});expect(result.bands).toHaveLength(10);expect(result.bands[9].enabled).toBe(false);expect(validPeq(result)).toBe(true)
  })
  it('accepts whitespace and CSV tables and rejects unsupported text with line numbers',()=>{
    expect(parsePeq('frequency gain Q\n1000,-6,1\n250 2 0.7').bands[0]).toMatchObject({frequency:1000,gain:-6,q:1})
    expect(()=>parsePeq('1000 -6 1\n<script>')).toThrow('第 2 行')
    expect(()=>parsePeq(Array(11).fill('1000 1 1').join('\n'))).toThrow('超过十段')
    expect(()=>parsePeq('1000 NaN 1')).toThrow()
    expect(()=>parsePeq('1 50 0')).toThrow('参数超出范围')
  })
  it('builds only numeric filter parameters and skips frequencies above Nyquist',()=>{
    const preset=defaultPeq();preset.enabled=true;preset.bands[0]={enabled:true,type:'PK',frequency:16000,gain:3,q:1}
    expect(peqGraph(preset,24000)).toBe('volume=0dB')
    expect(peqGraph(preset,48000)).toContain('equalizer=f=16000:t=q:w=1:g=3')
    expect(()=>peqGraph({...preset,preamp:NaN})).toThrow()
  })
  it('migrates old preferences and ignores invalid media paths and parameters',()=>{
    const value=normalizeExperience({wallpaper:{id:'../../session.json',kind:'image',name:'x'},peq:{enabled:true},spectrum:{enabled:true,color:'url(file://private)'}})
    expect(value.autoWallpaperText).toBe(false);expect(value.fontFamily).toBe('');expect(value.backgroundColor).toBe('');expect(value.panelBlur).toBe(12);expect(value.panelOpacity).toBe(.96);expect(normalizeExperience({panelOpacity:2}).panelOpacity).toBe(1);expect(normalizeExperience({panelOpacity:NaN}).panelOpacity).toBe(.96);expect(normalizeExperience({panelBlur:45,wallpaperBlur:23}).panelBlur).toBe(30);expect(normalizeExperience({panelBlur:7,wallpaperBlur:23}).wallpaperBlur).toBe(23);expect(value.commentsEnabled).toBe(true);expect(value.floatingEnabled).toBe(false);expect(value.wallpaper).toBeNull();expect(value.peq.enabled).toBe(false);expect(value.spectrum.enabled).toBe(false)
  })
  it('migrates compact card settings without changing main opacity or old window position',()=>{
    expect(normalizeExperience({panelOpacity:.3}).floatingOpacity).toBe(.96)
    const old={x:100,y:150,width:380,height:180}
    expect(normalizeExperience({floatingBounds:old}).floatingBounds).toEqual(old)
    expect(normalizeExperience({floatingBounds:{...old,width:280,height:64}}).floatingBounds).toEqual({...old,width:280,height:64})
    for(const floatingOpacity of [0,.35,1]){
      expect(normalizeExperience({floatingOpacity,panelOpacity:.7}).floatingOpacity).toBe(floatingOpacity)
      expect(()=>validateCommand('settings.update',{floatingOpacity})).not.toThrow()
    }
    for(const floatingOpacity of [-1,1.1,NaN,Infinity,'0.5'])expect(()=>validateCommand('settings.update',{floatingOpacity})).toThrow()
    expect(normalizeExperience({floatingOpacity:NaN}).floatingOpacity).toBe(.96)
    expect(normalizeExperience({floatingOpacity:-1}).floatingOpacity).toBe(0)
  })
  it('groups backend variants without merging distinct outputs by display name',()=>{
    const devices=groupDevices([{name:'auto',description:'Default'},{name:'pipewire',description:'Default (pipewire)'},{name:'pipewire/a',description:'Speaker'},{name:'pipewire/b',description:'Speaker'},{name:'pulse/a',description:'Speaker'},{name:'alsa/hw:0',description:'Speaker'}])
    expect(devices.filter(d=>!d.advanced).map(d=>d.id)).toEqual(['auto','pipewire/a','pipewire/b'])
    expect(devices.find(d=>d.id==='pulse/a')?.advanced).toBe(true)
    expect(groupDevices([{name:'pipewire',description:'Default (pipewire)'},{name:'pulse/speaker',description:'Speaker'}]).filter(d=>!d.advanced).map(d=>d.id)).toEqual(['auto','pulse/speaker'])
  })
  it('extracts a known tone and produces silence rather than decorative frequency bars',()=>{
    const samples=Float32Array.from({length:4096},(_,i)=>Math.sin(i*2*Math.PI*1000/48000)*0.5)
    const bins=spectrum(samples),index=bins.indexOf(Math.max(...bins)),frequency=20*Math.pow(1000,(index+0.5)/64)
    expect(frequency).toBeGreaterThan(850);expect(frequency).toBeLessThan(1150)
    expect(spectrum(new Float32Array(4096))).toEqual(Array(64).fill(0))
  })
  it('rejects arbitrary file access and malformed processing commands at the IPC boundary',()=>{
    expect(()=>validateCommand('settings.update',{autoWallpaperText:'yes'})).toThrow()
    for(const command of ['window.state','window.minimize','window.toggleMaximize','window.close']){expect(()=>validateCommand(command,undefined)).not.toThrow();expect(()=>validateCommand(command,{id:1})).toThrow()}
    expect(()=>validateCommand('settings.update',{fontFamily:'url(https://invalid)'})).toThrow()
    expect(()=>validateCommand('settings.update',{fontColor:'red;display:none'})).toThrow()
    expect(()=>validateCommand('settings.update',{autoWallpaperText:true,fontFamily:'Noto Sans CJK SC',backgroundColor:'#123456'})).not.toThrow()
    for(const panelOpacity of [-.01,1.01,NaN,Infinity,'0.5'])expect(()=>validateCommand('settings.update',{panelOpacity})).toThrow()
    expect(()=>validateCommand('settings.update',{panelOpacity:0})).not.toThrow()
    expect(()=>validateCommand('settings.update',{panelOpacity:1})).not.toThrow()
    expect(()=>validateCommand('settings.update',{panelBlur:-1})).toThrow()
    expect(()=>validateCommand('settings.update',{panelBlur:Infinity})).toThrow()
    expect(()=>validateCommand('settings.update',{panelBlur:30})).not.toThrow()
    expect(()=>validateCommand('settings.update',{wallpaper:{id:'/etc/passwd'}})).toThrow()
    expect(()=>validateCommand('peq.apply',{...defaultPeq(),preamp:Infinity})).toThrow()
    expect(()=>validateCommand('library.addToPlaylist',{id:'102',trackId:'shell-command'})).toThrow()
    expect(()=>validateCommand('spectrum.subscribe',{active:'true'})).toThrow()
  })
})
