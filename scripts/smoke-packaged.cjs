const { _electron: electron, expect } = require('@playwright/test')
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path')
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-music-package-check-'))
  let instance
  try {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.CLOUD_MUSIC_TEST
    instance = await electron.launch({ executablePath: path.resolve('release/linux-unpacked/cloud-music-player'), args: ['--no-sandbox', '--disable-gpu', '--ozone-platform=headless', '--password-store=basic', `--user-data-dir=${directory}`], env })
    const page = await instance.firstWindow()
    await page.waitForSelector('.app-shell', { timeout: 30000 })
    await page.waitForFunction(async () => (await window.music.invoke('app.bootstrap')).data?.player.available, { timeout: 15000 })
    const packaged = await instance.evaluate(({ app }) => app.isPackaged)
    const result = await page.evaluate(() => window.music.invoke('app.bootstrap'))
    if (!packaged || !result.ok || !result.data.player.available) throw new Error('Packaged startup failed')
    await page.waitForSelector('.app-titlebar')
    const titlebarHeight=await page.locator('.app-titlebar').evaluate(e=>e.getBoundingClientRect().height)
    if(titlebarHeight!==36)throw new Error('Packaged titlebar height mismatch')
    const windowState=await page.evaluate(()=>window.music.invoke('window.state'))
    if(!windowState.ok||typeof windowState.data.maximized!=='boolean')throw new Error('Packaged window state unavailable')
    const emptyPlatforms=await page.evaluate(()=>window.music.invoke('settings.update',{enabledProviders:[]}))
    if(emptyPlatforms.ok)throw new Error('Packaged app accepted zero platforms')
    const dual=await page.evaluate(()=>window.music.invoke('settings.update',{enabledProviders:['netease','qq']}))
    if(!dual.ok)throw new Error('Packaged dual-platform setup failed')
    await page.getByRole('tablist',{name:'音乐平台'}).waitFor()
    await page.getByRole('tab',{name:'QQ音乐',exact:true}).click()
    await page.getByRole('tab',{name:'QQ音乐',exact:true,selected:true}).waitFor()
    await page.getByRole('button',{name:'设置',exact:true}).click()
    await page.getByRole('button',{name:'音效',exact:true}).click()
    await expect(page.getByRole('group',{name:'EQ 频响图',exact:true})).toBeVisible()
    await page.getByLabel('启用十段 PEQ',{exact:true}).check()
    await page.getByRole('button',{name:'第 1 段控制点',exact:true}).focus()
    await page.keyboard.press('Shift+ArrowUp')
    await expect(page.getByLabel('选中频段增益',{exact:true})).toHaveValue('1')
    await page.getByLabel('PEQ 前级增益',{exact:true}).fill('-4')
    await page.getByRole('button',{name:'应用 PEQ',exact:true}).click()
    await expect.poll(async()=>{const value=await page.evaluate(()=>window.music.invoke('app.bootstrap'));return value.ok&&value.data.settings.peq}).toMatchObject({enabled:true,preamp:-4,bands:[{enabled:true,type:'PK',frequency:31,gain:1,q:1},...Array.from({length:9},(_,i)=>result.data.settings.peq.bands[i+1])]})
    await expect(page.locator('.peq-total-curve')).toHaveAttribute('d',/^M/)
    await page.getByRole('button',{name:'重置预览',exact:true}).click()
    await page.getByRole('button',{name:'应用 PEQ',exact:true}).click()
    await expect.poll(async()=>{const value=await page.evaluate(()=>window.music.invoke('app.bootstrap'));return value.ok&&value.data.settings.peq.enabled}).toBe(false)
    const opening=instance.waitForEvent('window')
    const enabled=await page.evaluate(()=>window.music.invoke('settings.update',{floatingEnabled:true,floatingOpacity:.5}))
    if(!enabled.ok)throw new Error('Packaged card did not enable')
    const card=await opening;await card.waitForSelector('.mini-song strong')
    await card.waitForFunction(()=>getComputedStyle(document.querySelector('.mini-background')).opacity==='0.5')
    const cardSize=await card.evaluate(()=>[innerWidth,innerHeight])
    if(cardSize[0]!==280||cardSize[1]!==64)throw new Error('Packaged card size mismatch')
    const mainControl=await card.evaluate(()=>window.music.invoke('window.close'));if(mainControl.ok)throw new Error('Packaged window control leak')
    const privateAccess=await card.evaluate(()=>window.music.invoke('app.bootstrap'))
    if(privateAccess.ok)throw new Error('Packaged card capability leak')
    const report = { graphicalEq:true,eqKeyboardApplyAndReset:true,titlebarHeight,cardSize,cardBackgroundOpacity:.5,restrictedIPC:true,dualPlatformSelector:true,zeroPlatformsRejected:true,version: await instance.evaluate(({ app }) => app.getVersion()), packaged, playerAvailable: result.data.player.available, devices: result.data.player.devices.length, fixtureDisabled: Object.values(result.data.sessions).every(session=>session.user===null) }
    if (process.argv.includes('--network')) {
      const home = await page.evaluate(() => window.music.invoke('home.section', { provider: 'netease', section: 'recommended' }))
      if (!home.ok || !home.data.collections.length) throw new Error('Packaged public homepage failed')
      const detail = await page.evaluate(id => window.music.invoke('catalog.detail', { provider: 'netease', kind: 'playlist', id, offset: 0 }), home.data.collections[0].id)
      if (!detail.ok || !detail.data.tracks.length) throw new Error('Packaged public playlist failed')
      report.homeCollections = home.data.collections.length; report.playlistTracks = detail.data.tracks.length
    }
    if (process.argv.includes('--qq-login')) {
      const qr = await page.evaluate(() => window.music.invoke('auth.qrStart', { provider: 'qq' }))
      if (!qr.ok || !qr.data.dataUrl.startsWith('data:image/')) throw new Error('Packaged QQ QR creation failed')
      try {
        const status = await page.evaluate(key => window.music.invoke('auth.qrCheck', { provider: 'qq', key }), qr.data.key)
        if (!status.ok || status.data.state !== 'waiting') throw new Error('Packaged QQ QR waiting state failed')
        const current = await page.evaluate(() => window.music.invoke('app.bootstrap'))
        if (!current.ok || Object.values(current.data.sessions).some(session=>session.user)) throw new Error('A pending QQ login changed the active platform')
        report.qqQrWaiting = true; report.anonymousPlatform = current.data.sessions.netease.provider
      } finally { await page.evaluate(key => window.music.invoke('auth.qrCancel', { provider: 'qq', key }), qr.data.key) }
    }
    console.log(JSON.stringify(report))
  } finally { if (instance) await instance.close(); await fs.rm(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
