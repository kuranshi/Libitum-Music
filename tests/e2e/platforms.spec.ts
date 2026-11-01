import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Command, CommandMap } from '../../src/shared/types'

let instance: ElectronApplication, page: Page, server: Server, directory: string
let qqDownloadId = '', neteaseDownloadId = ''
const pcm = Buffer.alloc(44 + 48000 * 2 * 30)
pcm.write('RIFF'); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write('WAVEfmt ', 8)
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22)
pcm.writeUInt32LE(48000, 24); pcm.writeUInt32LE(96000, 28); pcm.writeUInt16LE(2, 32)
pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(pcm.length - 44, 40)

async function invoke<K extends Command>(command: K, args?: CommandMap[K]['args']): Promise<CommandMap[K]['result']> {
  const result = await page.evaluate(({ command, args }) => window.music.invoke(command, args), { command, args })
  if (!result.ok) throw new Error(`${command}: ${result.error.code} ${result.error.message}`)
  return result.data as CommandMap[K]['result']
}
async function search(query: string) {
  await page.getByLabel('搜索音乐', { exact: true }).fill(query)
  await page.getByLabel('搜索音乐', { exact: true }).press('Enter')
  await expect(page.getByRole('heading', { name: `搜索「${query}」`, exact: true })).toBeVisible()
}
async function waitForQqQr() {
  // A cancelled login retains the production ten-second generation cooldown.
  await expect(async () => {
    const retry = page.getByRole('button', { name: '重新加载', exact: true })
    if (await retry.isVisible()) await retry.click()
    await expect(page.getByAltText('QQ音乐登录二维码')).toBeVisible({ timeout: 500 })
  }).toPass({ timeout: 15000, intervals: [1000] })
}
async function openPlatformSwitch() {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '账号与隐私', exact: true }).click()
  await page.getByRole('button', { name: '切换平台或账号', exact: true }).click()
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'libitum-platforms-e2e-'))
  server = createServer((req, res) => {
    if (req.url?.startsWith('/comments')) { res.writeHead(204); res.end(); return }
    const start = Math.min(Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0), pcm.length - 1)
    res.writeHead(start ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': pcm.length - start, 'Accept-Ranges': 'bytes', ...(start ? { 'Content-Range': `bytes ${start}-${pcm.length - 1}/${pcm.length}` } : {}) })
    res.end(pcm.subarray(start))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const env: Record<string, string> = { ...process.env, CLOUD_MUSIC_TEST: '1', CLOUD_MUSIC_TEST_DIR: directory, CLOUD_MUSIC_TEST_QR: 'success', CLOUD_MUSIC_TEST_URL: `http://127.0.0.1:${port}/sample.wav` }
  delete env.ELECTRON_RUN_AS_NODE
  instance = await electron.launch({ args: [resolve('out/main/index.js'), '--no-sandbox', '--disable-gpu', '--ozone-platform=headless', '--password-store=basic'], env, timeout: 30000 })
  page = await instance.firstWindow()
  await expect(page.locator('.app-shell')).toBeVisible()
})
test.afterAll(async () => {
  if (instance) await instance.close()
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('anonymous browsing stays on NetEase while selecting or cancelling a QQ login', async () => {
  const guest = await invoke('app.bootstrap')
  expect(guest.session.user).toBeNull()
  expect(guest.session.provider || 'netease').toBe('netease')
  const home = await invoke('home.section', { section: 'recommended' })
  expect(home.collections.length).toBeGreaterThan(0)
  expect(home.collections.every(item => item.provider === 'netease')).toBe(true)
  const results = await invoke('catalog.search', { keywords: '音乐', kind: 'song', offset: 0 })
  expect(results.tracks.length).toBeGreaterThan(0)
  expect(results.tracks.every(track => track.provider === 'netease')).toBe(true)

  await page.getByRole('button', { name: '登录音乐账号 同步你的专属音乐库' }).click()
  await expect(page.getByAltText('网易云登录二维码')).toBeVisible()
  await page.getByRole('tab', { name: 'QQ音乐', exact: true }).click()
  await expect(page.getByAltText('QQ音乐登录二维码')).toBeVisible()
  await expect(page.getByText('使用QQ音乐 App 扫码', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cookie 导入', exact: true })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/qq-login.png', animations: 'disabled' })
  expect((await invoke('app.bootstrap')).session.user).toBeNull()
  expect((await invoke('home.section', { section: 'recommended' })).collections.every(item => item.provider === 'netease')).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await invoke('app.bootstrap')).session.user).toBeNull()
})

test('a confirmed QQ QR switches the existing homepage and catalog without exposing credentials', async () => {
  await page.getByRole('button', { name: '登录音乐账号 同步你的专属音乐库' }).click()
  await page.getByRole('tab', { name: 'QQ音乐', exact: true }).click()
  await waitForQqQr()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10000 })
  const state = await invoke('app.bootstrap')
  expect(state.session.provider).toBe('qq')
  expect(state.session.user).not.toBeNull()
  await expect(page.getByRole('heading', { name: `${state.session.user!.nickname}，今天想听点什么？`, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回上一页', exact: true })).toBeDisabled()
  const home = await invoke('home.section', { section: 'recommended' })
  expect(home.collections.length).toBeGreaterThan(0)
  expect(home.collections.every(item => item.provider === 'qq')).toBe(true)
  await expect(page.locator('.home-module').first().locator('.collection-card strong').first()).toHaveText(home.collections[0].title)
  expect(JSON.stringify(state)).not.toMatch(/MUSIC_U=|qqmusic_key|qm_keyst|sealed|refresh_token/)
  await page.screenshot({ path: 'test-results/qq-home.png', animations: 'disabled' })
})

test('QQ songs reuse search, real mpv playback, likes, lyrics, comments and downloads', async () => {
  const results = await invoke('catalog.search', { keywords: '音乐', kind: 'song', offset: 0 })
  expect(results.tracks.length).toBeGreaterThan(1)
  expect(results.tracks.every(track => track.provider === 'qq')).toBe(true)
  const track = results.tracks[0]
  await search('QQ歌曲验收')
  await expect(page.locator('.track-row')).toHaveCount(results.tracks.length)
  await page.getByRole('button', { name: `播放 ${track.title}`, exact: true }).click()
  await expect(page.getByRole('button', { name: '暂停播放', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '暂停播放', exact: true }).click()
  expect((await invoke('app.bootstrap')).player.queue.every(item => item.provider === 'qq')).toBe(true)

  const before = await invoke('library.list', { kind: 'likes', offset: 0 })
  const unliked = results.tracks.find(item => !before.likedIds.includes(item.id))!
  expect(unliked).toBeDefined()
  await page.getByRole('button', { name: `喜欢 ${unliked.title}`, exact: true }).click()
  await expect(page.getByRole('button', { name: `取消喜欢 ${unliked.title}`, exact: true })).toBeVisible()
  expect((await invoke('library.list', { kind: 'likes', offset: 0 })).likedIds).toContain(unliked.id)

  await page.getByRole('button', { name: '同步歌词', exact: true }).click()
  await expect(page.locator('.playback-panel .lyric-line').first()).toBeVisible()
  await page.getByRole('button', { name: '关闭播放面板', exact: true }).click()
  await page.getByRole('button', { name: '打开当前歌曲播放详情', exact: true }).click()
  const comments = await invoke('catalog.comments', { id: track.id, offset: 0 })
  expect(comments.hot.length + comments.items.length).toBeGreaterThan(0)
  await page.getByRole('button', { name: '评论', exact: true }).click()
  await expect(page.getByText((comments.hot[0] || comments.items[0]).content, { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/qq-listening.png', animations: 'disabled' })

  await search('QQ下载验收')
  await page.getByRole('button', { name: `下载 ${track.title}`, exact: true }).click()
  await page.getByLabel('本次下载音质', { exact: true }).selectOption('standard')
  await page.getByRole('button', { name: '开始下载', exact: true }).click()
  await page.getByRole('button', { name: '下载中心', exact: true }).click()
  await expect(page.locator('.download-status.status-completed')).toHaveCount(1)
  const tasks = (await invoke('app.bootstrap')).downloads
  qqDownloadId = tasks[0].id
  expect(tasks[0].track.provider).toBe('qq')
  expect(tasks[0].ownerId).toMatch(/^qq:/)
  const files = (await readdir(join(directory, 'Libitum music 下载'))).filter(name => name.endsWith('.wav'))
  expect(files).toHaveLength(1)
  expect(await readFile(join(directory, 'Libitum music 下载', files[0]))).toEqual(pcm)
})

test('QQ playlist and album pages keep the same collection and editable-playlist interactions', async () => {
  for (const kind of ['playlist', 'album'] as const) {
    const results = await invoke('catalog.search', { keywords: '音乐', kind, offset: 0 })
    expect(results.collections.length).toBeGreaterThan(0)
    expect(results.collections.every(collection => collection.provider === 'qq')).toBe(true)
    await search(kind === 'playlist' ? 'QQ歌单验收' : 'QQ专辑验收')
    await page.locator('.tabs').getByRole('button', { name: kind === 'playlist' ? '歌单' : '专辑', exact: true }).click()
    await page.locator('.collection-card').first().click()
    await expect(page.getByRole('heading', { name: results.collections[0].title, exact: true })).toBeVisible()
    await expect(page.locator('.track-row').first()).toBeVisible()
    await page.getByRole('main').getByRole('button', { name: kind === 'playlist' ? '收藏歌单' : '收藏专辑', exact: true }).click()
    await expect(page.getByRole('button', { name: '已收藏', exact: true })).toBeVisible()
    expect(await invoke('library.subscription', { kind, id: results.collections[0].id })).toEqual({ subscribed: true, confirmed: true })
  }
  const writable = await invoke('library.writablePlaylists', { offset: 0 })
  expect(writable.collections.length).toBeGreaterThan(0)
  const first = (await invoke('catalog.search', { keywords: '音乐', kind: 'song', offset: 0 })).tracks[0]
  await search('QQ加入歌单验收')
  await page.getByRole('button', { name: `将 ${first.title} 加入歌单`, exact: true }).click()
  await expect(page.getByRole('dialog', { name: '加入歌单', exact: true })).toBeVisible()
  await page.locator('.playlist-choice').first().click()
  await expect(page.getByRole('dialog', { name: '加入歌单', exact: true })).toHaveCount(0)
  const own = await invoke('catalog.detail', { kind: 'playlist', id: writable.collections[0].id, offset: 0 })
  expect(own.tracks.map(track => track.id)).toContain(first.id)
})

test('changing back to NetEase clears QQ navigation, queue and downloads', async () => {
  await openPlatformSwitch()
  await page.getByRole('tab', { name: '网易云音乐', exact: true }).click()
  await expect(page.getByAltText('网易云登录二维码')).toBeVisible()
  expect((await invoke('app.bootstrap')).session.provider).toBe('qq')
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10000 })
  const state = await invoke('app.bootstrap')
  expect(state.session.provider).toBe('netease')
  expect(state.player.queue).toEqual([])
  expect(state.downloads).toEqual([])
  await expect(page.getByLabel('搜索音乐', { exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: '返回上一页', exact: true })).toBeDisabled()
  expect((await invoke('home.section', { section: 'recommended' })).collections.every(item => item.provider === 'netease')).toBe(true)
  const track = (await invoke('catalog.search', { keywords: '音乐', kind: 'song', offset: 0 })).tracks[0]
  await search('网易云下载验收')
  await page.getByRole('button', { name: `播放 ${track.title}`, exact: true }).click()
  await expect(page.getByRole('button', { name: '暂停播放', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '暂停播放', exact: true }).click()
  await page.getByRole('button', { name: `下载 ${track.title}`, exact: true }).click()
  await page.getByLabel('本次下载音质', { exact: true }).selectOption('standard')
  await page.getByRole('button', { name: '开始下载', exact: true }).click()
  await page.getByRole('button', { name: '下载中心', exact: true }).click()
  await expect(page.locator('.download-status.status-completed')).toHaveCount(1)
  const downloads = (await invoke('app.bootstrap')).downloads
  expect(downloads.every(task => task.track.provider === 'netease' && task.ownerId.startsWith('netease:'))).toBe(true)
  neteaseDownloadId = downloads[0].id
})

test('cancelling a QQ login preserves the signed-in NetEase account and its downloads', async () => {
  const before = await invoke('app.bootstrap')
  await openPlatformSwitch()
  await expect(page.getByText('登录你的网易云音乐账号', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'QQ音乐', exact: true }).click()
  await waitForQqQr()
  expect((await invoke('app.bootstrap')).session).toEqual(before.session)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // Wait through one normal QR poll period: the cancelled success fixture must stay inactive.
  await page.waitForTimeout(4200)
  const after = await invoke('app.bootstrap')
  expect(after.session).toEqual(before.session)
  expect(after.player.queue.every(track => track.provider === 'netease')).toBe(true)
  expect(after.downloads.map(task => task.id)).toEqual([neteaseDownloadId])
})

test('logging back into the same QQ account restores only its own downloads, then logout returns to anonymous NetEase', async () => {
  await openPlatformSwitch()
  await page.getByRole('tab', { name: 'QQ音乐', exact: true }).click()
  await waitForQqQr()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10000 })
  const state = await invoke('app.bootstrap')
  expect(state.session.provider).toBe('qq')
  expect(state.player.queue).toEqual([])
  expect(state.downloads.map(task => task.id)).toEqual([qqDownloadId])
  expect(state.downloads.every(task => task.track.provider === 'qq' && task.ownerId.startsWith('qq:'))).toBe(true)
  expect(state.downloads.some(task => task.id === neteaseDownloadId)).toBe(false)
  await page.getByRole('button', { name: '下载中心', exact: true }).click()
  await expect(page.locator('.download-status.status-completed')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '播放下载的 QQ晚风经过', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '账号与隐私', exact: true }).click()
  await expect(page.getByText('当前平台：QQ音乐', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(page.getByRole('button', { name: '登录音乐账号 同步你的专属音乐库', exact: true })).toBeVisible()
  const guest = await invoke('app.bootstrap')
  expect(guest.session.user).toBeNull()
  expect(guest.session.provider || 'netease').toBe('netease')
  expect(guest.player.queue).toEqual([])
  expect((await invoke('catalog.search', { keywords: '音乐', kind: 'song', offset: 0 })).tracks.every(track => track.provider === 'netease')).toBe(true)
})
