import {test,expect,_electron as electron,type ElectronApplication,type Page} from '@playwright/test'
import {createServer,type Server} from 'node:http'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const exec=promisify(execFile)
let instance:ElectronApplication,page:Page,directory:string,server:Server,exited=false

test.describe.configure({mode:'serial'})
test.beforeAll(async()=>{
  directory=await mkdtemp(join(tmpdir(),'libitum-window-'))
  const audio=Buffer.alloc(44+16000*20);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40)
  server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':audio.length});res.end(audio)})
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port
  const env:Record<string,string>={...process.env,CLOUD_MUSIC_TEST:'1',CLOUD_MUSIC_TEST_DIR:directory,CLOUD_MUSIC_TEST_URL:`http://127.0.0.1:${port}/audio.wav`};delete env.ELECTRON_RUN_AS_NODE
  instance=await electron.launch({args:[resolve('out/main/index.js'),'--no-sandbox','--disable-gpu','--ozone-platform=headless','--password-store=basic'],env})
  page=await instance.firstWindow();await expect(page.locator('.app-titlebar')).toBeVisible()
})
test.afterAll(async()=>{if(instance&&!exited)await instance.close();if(server)await new Promise<void>(r=>server.close(()=>r()));if(directory)await rm(directory,{recursive:true,force:true})})

test('provides a narrow draggable title bar, operable buttons and synchronized window state',async()=>{
  const title=page.getByRole('banner',{name:'窗口标题栏'})
  expect((await title.boundingBox())!.height).toBe(36)
  expect(await title.evaluate(e=>getComputedStyle(e).getPropertyValue('-webkit-app-region'))).toBe('drag')
  for(const button of await title.getByRole('button').all())expect(await button.evaluate(e=>getComputedStyle(e).getPropertyValue('-webkit-app-region'))).toBe('no-drag')
  await title.getByRole('button',{name:'最大化窗口',exact:true}).focus();await page.keyboard.press('Enter')
  await expect(title.getByRole('button',{name:'还原窗口',exact:true})).toBeVisible()
  let state=await page.evaluate(()=>window.music.invoke('window.state'));expect(state.ok&&state.data.maximized).toBe(true)
  // Headless maximize may use a 1px virtual screen; exercise keyboard restore here. Native pointer checks run separately.
  await title.getByRole('button',{name:'还原窗口',exact:true}).focus();await page.keyboard.press('Enter')
  await expect(title.getByRole('button',{name:'最大化窗口',exact:true})).toBeVisible()
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].maximize())
  await expect(title.getByRole('button',{name:'还原窗口',exact:true})).toBeVisible()
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].unmaximize())
  await expect(title.getByRole('button',{name:'最大化窗口',exact:true})).toBeVisible()
  await title.getByRole('button',{name:'最小化窗口',exact:true}).click()
  await expect.poll(async()=>{const r=await page.evaluate(()=>window.music.invoke('window.state'));return r.ok&&r.data.minimized}).toBe(true)
  await page.evaluate(()=>window.music.invoke('window.restore'))
  await expect.poll(async()=>{const r=await page.evaluate(()=>window.music.invoke('window.state'));return r.ok&&r.data.minimized}).toBe(false)
})

test('displays downgraded quality only beside the selector while keeping playback errors',async()=>{
  const r=await page.evaluate(()=>window.music.invoke('catalog.search',{keywords:'晚风',kind:'song',offset:0}));if(!r.ok)throw new Error('Search fixture failed')
  await page.evaluate(()=>window.music.invoke('player.quality',{quality:'hires'}))
  await page.evaluate(tracks=>window.music.invoke('player.play',{tracks,index:3}),r.data.tracks)
  await expect(page.locator('.quality-info')).toContainText('实际：标准 · 降级')
  await expect(page.locator('.quality-info')).toHaveAttribute('title',/所选音质：Hi-Res；实际音质：标准/)
  await expect(page.locator('.player-notice')).toHaveCount(0)
  const current=await page.evaluate(()=>window.music.invoke('app.bootstrap'));if(!current.ok)throw new Error('Bootstrap failed')
  await instance.evaluate(({BrowserWindow},state)=>BrowserWindow.getAllWindows()[0].webContents.send('music:event',{type:'player',data:{...state,error:'测试播放错误',notice:null}}),current.data.player)
  await expect(page.locator('.player-notice.is-error')).toHaveText('测试播放错误')
  await instance.evaluate(({BrowserWindow},state)=>BrowserWindow.getAllWindows()[0].webContents.send('music:event',{type:'player',data:state}),current.data.player)
  await page.evaluate(()=>window.music.invoke('player.toggle'))
})

async function buttonContrast(){
  return page.locator('.window-button').evaluateAll(buttons=>{
    const rgb=(s:string)=>s.match(/[\d.]+/g)!.map(Number)
    const lum=(c:number[])=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)
    return Math.min(...buttons.flatMap(button=>{
      const css=getComputedStyle(button),text=rgb(css.color),bg=rgb(css.backgroundColor),alpha=bg[3]??1
      return [0,255].map(under=>{const back=bg.slice(0,3).map(v=>v*alpha+under*(1-alpha)),a=lum(text),b=lum(back);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})
    }))
  })
}

test('blends title bar into images and video, previews panel blur and protects button contrast',async()=>{
  test.setTimeout(60000)
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'外观与播放页',exact:true}).click()
  const images=[]
  for(const color of ['white','black']){const path=join(directory,`${color}.png`);await exec('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=${color}:s=320x180`,'-frames:v','1',path]);images.push(path)}
  const video=join(directory,'titlebar.mkv');await exec('ffmpeg',['-v','error','-f','lavfi','-i','color=c=0x225588:s=320x180:d=1','-c:v','libx264',video])
  for(const source of [...images,video]){
    await instance.evaluate(({dialog},path)=>{(dialog as any).showOpenDialog=async()=>({canceled:false,filePaths:[path]})},source)
    await page.evaluate(()=>window.music.invoke('wallpaper.import'))
    await expect.poll(async()=>{const r=await page.evaluate(()=>window.music.invoke('app.bootstrap'));return r.ok&&r.data.settings.wallpaper?.name}).toBe(source.split('/').pop())
    await page.evaluate(()=>window.music.invoke('settings.update',{wallpaperScope:'app',wallpaperBrightness:1,wallpaperOverlay:0,panelOpacity:0,fontColor:'#ff00ff'}))
    for(const [theme,scheme] of [['light','light'],['dark','light'],['system','light'],['system','dark']] as const){
      await page.emulateMedia({colorScheme:scheme});await page.evaluate(theme=>window.music.invoke('settings.update',{theme}),theme)
      await expect.poll(()=>page.locator('.app-titlebar').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
      expect(await buttonContrast()).toBeGreaterThanOrEqual(4.5)
      await page.getByRole('button',{name:'关闭窗口',exact:true}).hover();expect(await buttonContrast()).toBeGreaterThanOrEqual(4.5)
    }
  }
  const blur=page.getByLabel('面板模糊',{exact:true});await blur.fill('23')
  await expect(page.locator('.app-titlebar')).toHaveCSS('backdrop-filter','blur(23px)')
  let stored=await page.evaluate(()=>window.music.invoke('app.bootstrap'));expect(stored.ok&&stored.data.settings.panelBlur).toBe(12)
  await blur.press('ArrowRight');await expect(page.locator('.app-titlebar')).toHaveCSS('backdrop-filter','blur(24px)')
  stored=await page.evaluate(()=>window.music.invoke('app.bootstrap'));expect(stored.ok&&stored.data.settings.panelBlur).toBe(24)
  await page.evaluate(()=>window.music.invoke('settings.update',{theme:'dark',fontColor:'',panelOpacity:.96}))
  await page.screenshot({path:'test-results/wallpaper-titlebar.png',animations:'disabled'})
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,680))
  await page.getByRole('button',{name:'打开当前歌曲播放详情',exact:true}).click();await page.getByRole('button',{name:'评论',exact:true}).click();await page.getByRole('button',{name:'歌词',exact:true}).click();await page.getByRole('button',{name:'切换实时频谱',exact:true}).click()
  expect(await page.locator('.content-scroll').evaluate(e=>e.scrollHeight<=e.clientHeight+1)).toBe(true)
  const controls=await page.locator('.window-controls').boundingBox();expect(controls!.x+controls!.width).toBeLessThanOrEqual(1000)
  await page.locator('.playback-options').getByRole('button',{name:'十段 PEQ',exact:true}).click()
  await expect.poll(async()=>(await page.locator('.modal-backdrop').boundingBox())!.y).toBe(36)
  expect(await page.getByRole('button',{name:'关闭窗口',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})).toBe(true)
  await page.getByRole('button',{name:'关闭对话框',exact:true}).click()
  await page.getByRole('button',{name:/播放队列 \d+ 首/}).click();expect((await page.locator('.playback-panel').boundingBox())!.y).toBe(119)
  await page.getByRole('button',{name:'关闭播放面板',exact:true}).click()
  await page.evaluate(()=>window.music.invoke('wallpaper.clear'))
  await page.evaluate(()=>window.music.invoke('settings.update',{backgroundColor:'#123456'}))
  await expect(page.locator('.app-titlebar')).toHaveCSS('background-color','rgb(18, 52, 86)')
})

test('keeps main-only window commands unavailable to the card and closes through the existing lifecycle',async()=>{
  const opening=instance.waitForEvent('window');await page.evaluate(()=>window.music.invoke('settings.update',{floatingEnabled:true}));const card=await opening
  await expect(card.locator('.mini-player')).toBeVisible()
  for(const command of ['window.state','window.minimize','window.toggleMaximize','window.close']){
    const r=await card.evaluate(command=>(window.music.invoke as any)(command),command);expect(r.ok).toBe(false)
  }
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click()
  await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('#mini'))!.isVisible())).toBe(false)
  await card.getByRole('button',{name:'返回主窗口',exact:true}).click()
  await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('#mini'))!.isVisible())).toBe(true)
  await card.getByRole('button',{name:'关闭悬浮卡片',exact:true}).click();await expect.poll(()=>instance.windows().length).toBe(1)
  const stored=JSON.parse(await readFile(join(directory,'settings.json'),'utf8'));expect(stored.data.floatingEnabled).toBe(false)
  const closed=instance.waitForEvent('close');await page.getByRole('button',{name:'关闭窗口',exact:true}).click();await closed;exited=true
})
