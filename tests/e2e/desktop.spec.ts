import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

function audioFixture() {
  const rate = 8000, samples = rate * 20, buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / rate) * 400), 44 + i * 2)
  return buffer
}
let app: ElectronApplication, page: Page, server: Server, directory: string
const pcm = audioFixture()
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cloud-music-e2e-'))
  server = createServer((req, res) => {
    const start = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0), body = pcm.subarray(start)
    res.writeHead(start ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': body.length, 'Accept-Ranges': 'bytes', ...(start ? { 'Content-Range': `bytes ${start}-${pcm.length - 1}/${pcm.length}` } : {}) }); res.end(body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const env: Record<string, string> = { ...process.env, CLOUD_MUSIC_TEST: '1', CLOUD_MUSIC_TEST_DIR: directory, CLOUD_MUSIC_TEST_URL: `http://127.0.0.1:${port}/music.wav` }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ args: [resolve('out/main/index.js'), '--no-sandbox', '--disable-gpu', '--ozone-platform=headless', '--password-store=basic'], env, timeout: 30000 })
  page = await app.firstWindow()
  page.on('pageerror', error => console.error('Renderer error:', error.message))
  await expect(page.getByRole('heading', { name: '让生活，有声有色。' })).toBeVisible()
})
test.afterAll(async () => {
  if (app) await app.close()
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  if (directory) await rm(directory, { recursive: true, force: true })
})
test.describe.configure({ mode: 'serial' })
test('homepage renders and renderer cannot access Node or arbitrary IPC', async () => {
  await expect(page.getByRole('heading', { name: '为你精选' })).toBeVisible()
  expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined')
  const rejected = await page.evaluate(() => (window.music.invoke as any)('run', { command: 'sh' }))
  expect(rejected.ok).toBe(false)
  await page.screenshot({ path: 'test-results/home.png', animations: 'disabled' })
})
test('QR login displays and invalid Cookie has an actionable error', async () => {
  await page.getByRole('button', { name: '登录音乐账号 同步你的专属音乐库' }).click()
  await expect(page.getByAltText('网易云登录二维码')).toBeVisible()
  await page.getByRole('button', { name: 'Cookie 导入' }).click()
  await page.getByLabel('登录 Cookie').fill('MUSIC_U=invalid')
  await page.getByRole('button', { name: '验证并登录' }).click()
  await expect(page.getByText('Cookie 无效或已经过期，请重新导入。', { exact: true })).toBeVisible()
  await page.getByLabel('登录 Cookie').fill('MUSIC_U=fixture')
  await page.getByRole('button', { name: '验证并登录' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '测试听众，今天想听点什么？' })).toBeVisible()
  const invalid = await page.evaluate(() => window.music.invoke('auth.importCookie', { provider: 'netease', cookie: 'MUSIC_U=bad' }))
  expect(invalid.ok).toBe(false)
  const active = await page.evaluate(() => window.music.invoke('app.bootstrap'))
  expect(active.ok && active.data.sessions.netease.user?.id).toBe('42')
})
test('search, play through real mpv IPC, seek, change quality, lyrics and queue', async () => {
  await page.getByLabel('搜索音乐').fill('晚风'); await page.getByLabel('搜索音乐').press('Enter')
  await expect(page.getByRole('heading', { name: '搜索「晚风」' })).toBeVisible()
  await expect(page.locator('.track-row')).toHaveCount(6)
  await page.getByRole('button', { name: '播放 晚风经过', exact: true }).click()
  await expect(page.getByRole('button', { name: '暂停播放' })).toBeVisible()
  await page.getByLabel('播放进度').focus(); await page.getByLabel('播放进度').press('ArrowRight')
  await page.getByRole('button', { name: '暂停播放' }).click()
  await page.getByLabel('播放音质', { exact: true }).selectOption('lossless')
  await expect(page.getByRole('button', { name: '开始播放', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '同步歌词' }).click()
  await expect(page.getByText('晚风轻轻经过', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭播放面板' }).click()
  await page.getByRole('button', { name: '播放队列 6 首' }).click()
  await expect(page.getByRole('complementary', { name: '播放队列' })).toBeVisible()
  await page.getByRole('button', { name: '关闭播放面板' }).click()
  await page.screenshot({ path: 'test-results/search.png', animations: 'disabled' })
})
test('likes and playlist subscriptions sync into library', async () => {
  await page.getByRole('button', { name: '喜欢 海岸线', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消喜欢 海岸线', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '我喜欢的', exact: true }).click()
  await expect(page.locator('.track-row')).toHaveCount(2)
  await page.getByLabel('搜索音乐').fill('歌单'); await page.getByLabel('搜索音乐').press('Enter')
  await page.locator('.tabs').getByRole('button', { name: '歌单', exact: true }).click()
  await page.getByRole('button', { name: '晚风与生活 Libitum music编辑部' }).click()
  await page.getByRole('button', { name: '收藏歌单', exact: true }).click()
  await expect(page.getByRole('button', { name: '已收藏', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '我的歌单', exact: true }).click()
  await expect(page.getByRole('button', { name: '晚风与生活 Libitum music编辑部' })).toBeVisible()
})
test('batch downloads finish, bytes match source, and local file plays', async () => {
  await page.getByRole('button', { name: '晚风与生活 Libitum music编辑部' }).click()
  await page.locator('.track-toolbar').getByRole('button', { name: '下载', exact: true }).click()
  await page.getByRole('button', { name: '开始下载', exact: true }).click()
  await page.getByRole('button', { name: '下载中心', exact: true }).click()
  await expect(page.locator('.download-status.status-completed')).toHaveCount(6)
  const files = (await readdir(join(directory, 'Libitum music 下载'))).filter(name => name.endsWith('.wav'))
  expect(files.length).toBe(6); expect(await readFile(join(directory, 'Libitum music 下载', files[0]))).toEqual(pcm)
  expect((await readdir(join(directory, 'Libitum music 下载'))).some(name => name.endsWith('.part'))).toBe(false)
  await page.getByRole('button', { name: '播放下载的 晚风经过', exact: true }).click()
  await expect(page.getByRole('button', { name: '暂停播放' })).toBeVisible()
})
test('recommendation radio starts and settings persist theme', async () => {
  await page.getByRole('button', { name: '音乐漫游', exact: true }).click()
  await page.getByRole('button', { name: '场景', exact: true }).click()
  await page.getByRole('button', { name: '专注', exact: true }).click()
  await page.getByRole('button', { name: '开始漫游', exact: true }).click()
  await expect(page.getByText('正在播放', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '外观与播放页', exact: true }).click()
  await page.getByLabel('界面主题').selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByLabel('界面主题').selectOption('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect.poll(async () => JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')).data.theme).toBe('light')
  await page.screenshot({ path: 'test-results/settings.png' })
})
test('logout removes account data and does not persist plaintext cookies', async () => {
  await page.getByRole('button', { name: '账号与隐私', exact: true }).click()
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('region', { name: '网易云音乐账号', exact: true }).getByText('尚未登录', { exact: true })).toBeVisible()
  const saved = JSON.parse(await readFile(join(directory, 'session.json'), 'utf8'))
  expect(saved.data.sessions).toEqual({})
  for (const file of ['settings.json', 'queue.json', 'downloads.json', 'session.json']) {
    const content = await readFile(join(directory, file), 'utf8').catch(() => '')
    expect(content).not.toContain('MUSIC_U=fixture')
  }
})
