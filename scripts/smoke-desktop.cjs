// Real compositor smoke with isolated fixture data and silent mpv, never a user profile.
const {_electron:electron,expect}=require('@playwright/test')
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path')
async function check(mode){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),`libitum-${mode}-`));let instance
  try{
    const env={...process.env,CLOUD_MUSIC_TEST:'1',CLOUD_MUSIC_TEST_DIR:directory};delete env.ELECTRON_RUN_AS_NODE
    instance=await electron.launch({args:[path.resolve('out/main/index.js'),'--no-sandbox','--disable-gpu',`--ozone-platform=${mode}`,'--password-store=basic'],env,timeout:20000})
    const main=await instance.firstWindow();await main.waitForSelector('.app-shell',{timeout:20000})
    // Native windows may be occluded by the active app; do not wait for animation frames before dispatching controls.
    await expect(main.locator('.app-titlebar')).toHaveCSS('height','36px')
    await main.getByRole('button',{name:'最大化窗口',exact:true}).click({force:true})
    await expect(main.getByRole('button',{name:'还原窗口',exact:true})).toBeVisible()
    await main.getByRole('button',{name:'还原窗口',exact:true}).click({force:true})
    await expect(main.getByRole('button',{name:'最大化窗口',exact:true})).toBeVisible()
    await main.getByRole('button',{name:'最小化窗口',exact:true}).click({force:true})
    await expect.poll(async()=>{const r=await main.evaluate(()=>window.music.invoke('window.state'));return r.ok&&r.data.minimized}).toBe(true)
    await main.evaluate(()=>window.music.invoke('window.restore'))
    await expect.poll(async()=>{const r=await main.evaluate(()=>window.music.invoke('window.state'));return r.ok&&r.data.minimized}).toBe(false)
    const resize=await instance.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1000,680);return w.isResizable()})
    if(!resize)throw new Error('Main window resize disabled')
    if(await main.locator('.app-titlebar').evaluate(e=>getComputedStyle(e).getPropertyValue('-webkit-app-region'))!=='drag')throw new Error('Missing drag region')
    const opening=instance.waitForEvent('window')
    const enabled=await main.evaluate(()=>window.music.invoke('settings.update',{floatingEnabled:true}));if(!enabled.ok)throw new Error('Mini card did not enable')
    const card=await opening;await card.waitForSelector('.mini-player')
    const control=await card.evaluate(()=>window.music.invoke('window.close'));if(control.ok)throw new Error('Window control capability leak')
    const denied=await card.evaluate(()=>window.music.invoke('auth.qrStart'));if(denied.ok)throw new Error('Mini IPC capability leak')
    const info=await instance.evaluate(({BrowserWindow})=>{const card=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('#mini'));return {windows:BrowserWindow.getAllWindows().length,alwaysOnTop:card.isAlwaysOnTop(),size:card.getSize(),resizable:card.isResizable()}})
    if(info.size[0]!==280||info.size[1]!==64||info.resizable)throw new Error('Compact card size mismatch')
    await main.getByRole('button',{name:'关闭窗口',exact:true}).click({force:true})
    await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('#mini')).isVisible())).toBe(false)
    await card.getByRole('button',{name:'返回主窗口',exact:true}).click({force:true})
    await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('#mini')).isVisible())).toBe(true)
    await main.evaluate(()=>window.music.invoke('settings.update',{floatingEnabled:false}))
    console.log(JSON.stringify({mode,...info,restrictedIPC:true,titlebarControls:true,nativeResize:true,profile:'isolated-fixture',audio:'null'}))
  }finally{if(instance)await instance.close();await fs.rm(directory,{recursive:true,force:true})}
}
(async()=>{for(const mode of ['wayland','x11'])await check(mode)})().catch(error=>{console.error(error.message);process.exitCode=1})
