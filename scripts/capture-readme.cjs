// Capture the real Electron renderer with temporary profiles and synthetic audio.
const { _electron: electron, expect } = require('@playwright/test')
const { createServer } = require('node:http')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const images = path.join(root, 'docs/images')

async function invoke(page, command, args) {
  const result = await page.evaluate(async ({ command, args }) => window.music.invoke(command, args), { command, args })
  if (!result.ok) throw new Error(`${command}: ${result.error?.message || 'failed'}`)
  return result.data
}

async function launch(directory, fixture, audioUrl) {
  await fs.mkdir(directory, { recursive: true })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  for (const name of Object.keys(env)) if (name.startsWith('CLOUD_MUSIC_TEST')) delete env[name]
  if (fixture) Object.assign(env, { CLOUD_MUSIC_TEST: '1', CLOUD_MUSIC_TEST_DIR: directory, CLOUD_MUSIC_TEST_URL: audioUrl })
  const instance = await electron.launch({
    args: [path.join(root, 'out/main/index.js'), '--no-sandbox', '--disable-gpu', '--ozone-platform=headless', '--password-store=basic', `--user-data-dir=${directory}`],
    cwd: root, env, timeout: 30000
  })
  try {
    const page = await instance.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible()
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 940))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await invoke(page, 'settings.update', { theme: 'light' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    return { instance, page }
  } catch (error) { await instance.close(); throw error }
}

async function shot(page, name) {
  if (process.argv.includes('--mini-only') && name !== 'mini-player.png') return
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: path.join(images, name), animations: 'disabled' })
  console.log(`Captured docs/images/${name}`)
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'libitum-readme-'))
  let instance, server
  await fs.mkdir(images, { recursive: true })
  try {
    if (process.argv.includes('--public-home')) {
      const publicApp = await launch(path.join(directory, 'public'), false)
      instance = publicApp.instance
      const page = publicApp.page
      await expect(page.locator('.home-module').first().locator('.collection-card').first()).toBeVisible({ timeout: 60000 })
      await expect(page.locator('.home-module').first().locator('.cover img').first()).toBeVisible()
      await page.waitForFunction(() => [...document.querySelectorAll('.home-module:first-of-type img, .collection-card img')].slice(0, 5).every(img => img.complete && img.naturalWidth > 0))
      await shot(page, 'home.png')
      await instance.close(); instance = null
    }

    // Ninety seconds of PCM silence; test mode sends mpv output to ao=null.
    const rate = 48000, audio = Buffer.alloc(44 + rate * 2 * 90)
    audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8)
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22)
    audio.writeUInt32LE(rate, 24); audio.writeUInt32LE(rate * 2, 28); audio.writeUInt16LE(2, 32)
    audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40)
    server = createServer((req, res) => {
      if (req.url.startsWith('/comments')) { res.writeHead(204); res.end(); return }
      const start = Math.min(Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0), audio.length - 1)
      res.writeHead(start ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length - start, 'Accept-Ranges': 'bytes', ...(start ? { 'Content-Range': `bytes ${start}-${audio.length - 1}/${audio.length}` } : {}) })
      res.end(audio.subarray(start))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const fixtureApp = await launch(path.join(directory, 'fixture'), true, `http://127.0.0.1:${server.address().port}/sample.wav`)
    instance = fixtureApp.instance
    const page = fixtureApp.page
    if (!process.argv.includes('--public-home') && !process.argv.includes('--mini-only')) {
      await expect(page.locator('.home-module').first().locator('.collection-card').first()).toBeVisible()
      await shot(page, 'home.png')
    }
    await invoke(page, 'auth.importCookie', { provider: 'netease', cookie: 'MUSIC_U=fixture' })
    await expect.poll(async () => (await invoke(page, 'app.bootstrap')).player.available).toBe(true)
    await page.getByLabel('搜索音乐').fill('晚风')
    await page.getByLabel('搜索音乐').press('Enter')
    await page.getByRole('button', { name: '播放 晚风经过', exact: true }).click()
    await expect(page.getByRole('button', { name: '暂停播放', exact: true })).toBeVisible()
    await invoke(page, 'player.seek', { seconds: 6 })
    await invoke(page, 'player.toggle')
    await invoke(page, 'settings.update', { theme: 'dark' })
    await page.getByRole('button', { name: '打开当前歌曲播放详情', exact: true }).click()
    await page.getByRole('button', { name: '评论', exact: true }).click()
    await expect(page.getByText('愿每一段旋律都带来好心情。', { exact: true })).toBeVisible()
    await shot(page, 'listening.png')

    await invoke(page, 'settings.update', { theme: 'light' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '音效', exact: true }).click()
    await page.getByLabel('启用十段 PEQ', { exact: true }).check()
    await page.getByLabel('PEQ 前级增益', { exact: true }).fill('-4')
    await page.getByLabel('第 1 段类型', { exact: true }).selectOption('LS')
    await page.getByLabel('第 1 段增益', { exact: true }).fill('3')
    await page.getByLabel('第 5 段增益', { exact: true }).fill('-2')
    await page.getByLabel('第 9 段增益', { exact: true }).fill('2')
    await page.getByRole('button', { name: '应用 PEQ', exact: true }).click()
    await expect.poll(async () => (await invoke(page, 'app.bootstrap')).settings.peq.enabled).toBe(true)
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10000 })
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1100))
    await page.locator('.content-scroll').evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }))
    await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
    await shot(page, 'equalizer.png')

    await invoke(page, 'settings.update', { floatingEnabled: true })
    await expect.poll(() => instance.windows().length).toBe(2)
    const card = instance.windows().find(window => window !== page)
    await expect(card.locator('.mini-player')).toBeVisible()
    await shot(card, 'mini-player.png')

    if (!process.argv.includes('--mini-only')) {
      await invoke(page, 'settings.update', { floatingEnabled: false, enabledProviders: ['netease', 'qq'] })
      await invoke(page, 'auth.importCookie', { provider: 'qq', cookie: 'qqmusic_session=fixture-qq-session' })
      await page.getByRole('button', { name: '账号与隐私', exact: true }).click()
      await expect(page.getByRole('region', { name: '网易云音乐账号', exact: true }).getByText('测试听众', { exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name: 'QQ音乐账号', exact: true }).getByText('QQ测试听众', { exact: true })).toBeVisible()
      await page.locator('.content-scroll').evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }))
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10000 })
      await shot(page, 'platform-accounts.png')

      await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 940))
      await page.getByLabel('搜索音乐', { exact: true }).fill('晚风')
      await page.getByLabel('搜索音乐', { exact: true }).press('Enter')
      for (const [platform, name, title] of [['网易云音乐', 'search-netease.png', '播放 晚风经过'], ['QQ音乐', 'search-qq.png', '播放 QQ晚风经过']]) {
        await page.getByRole('tablist', { name: '音乐平台', exact: true }).getByRole('tab', { name: platform, exact: true }).click()
        await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
        await shot(page, name)
      }
    }
  } finally {
    if (instance) await instance.close()
    if (server) await new Promise(resolve => server.close(resolve))
    await fs.rm(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
