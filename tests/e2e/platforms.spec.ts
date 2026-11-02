import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Command, CommandMap, ProviderId, Track } from '../../src/shared/types'

let instance: ElectronApplication, page: Page, server: Server, directory: string
let holdDownloads = false
const held = new Set<ServerResponse>()
const pcm = Buffer.alloc(44 + 48000 * 2 * 30)
pcm.write('RIFF'); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write('WAVEfmt ', 8)
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22)
pcm.writeUInt32LE(48000, 24); pcm.writeUInt32LE(96000, 28); pcm.writeUInt16LE(2, 32)
pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(pcm.length - 44, 40)
let netTracks: Track[], qqTracks: Track[]
async function invoke<K extends Command>(command: K, args?: CommandMap[K]['args']): Promise<CommandMap[K]['result']> {
  const result = await page.evaluate(({ command, args }) => window.music.invoke(command, args), { command, args })
  if (!result.ok) throw new Error(`${command}: ${result.error.code} ${result.error.message}`)
  return result.data as CommandMap[K]['result']
}
const label = (provider: ProviderId) => provider === 'qq' ? 'QQ音乐' : '网易云音乐'
async function accountSettings() {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '账号与隐私', exact: true }).click()
}
function account(provider: ProviderId) { return page.getByRole('region', { name: `${label(provider)}账号`, exact: true }) }
async function platform(provider: ProviderId) {
  await page.getByRole('tablist', { name: '音乐平台', exact: true }).getByRole('tab', { name: label(provider), exact: true }).click()
  await expect(page.getByRole('tablist', { name: '音乐平台', exact: true }).getByRole('tab', { name: label(provider), exact: true })).toHaveAttribute('aria-selected', 'true')
}
async function search(query: string) {
  await page.getByLabel('搜索音乐', { exact: true }).fill(query)
  await page.getByLabel('搜索音乐', { exact: true }).press('Enter')
  await expect(page.getByRole('heading', { name: `搜索「${query}」`, exact: true })).toBeVisible()
}
async function loginQq() {
  await accountSettings()
  await account('qq').getByRole('button', { name: '登录QQ音乐', exact: true }).click()
  await expect(async () => {
    const retry = page.getByRole('button', { name: '重新加载', exact: true })
    if (await retry.isVisible()) await retry.click()
    await expect(page.getByAltText('QQ音乐登录二维码')).toBeVisible({ timeout: 500 })
  }).toPass({ timeout: 15000, intervals: [1000] })
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10000 })
  await expect(account('qq').getByText('QQ测试听众', { exact: true })).toBeVisible()
}
function releaseDownloads() { holdDownloads = false; for (const response of held) { if (!response.destroyed) response.end(pcm) }; held.clear() }
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'libitum-dual-platform-'))
  server = createServer((req, res) => {
    if (req.url?.startsWith('/comments')) { res.writeHead(204); res.end(); return }
    const start = Math.min(Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] || 0), pcm.length - 1)
    res.writeHead(start ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': pcm.length - start, 'Accept-Ranges': 'bytes', ...(start ? { 'Content-Range': `bytes ${start}-${pcm.length - 1}/${pcm.length}` } : {}) })
    if (holdDownloads && req.headers['user-agent'] === 'CloudMusicPlayer/0.1.0') {
      res.flushHeaders(); held.add(res); res.on('close', () => held.delete(res)); return
    }
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
  releaseDownloads()
  if (instance) await instance.close()
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('single-platform defaults reject closing the last platform and keep public browsing', async () => {
  const state = await invoke('app.bootstrap')
  expect(state.settings.enabledProviders).toEqual(['netease'])
  expect(Object.values(state.sessions).every(session => !session.user)).toBe(true)
  await expect(page.getByRole('tablist', { name: '音乐平台', exact: true })).toHaveCount(0)
  const invalid = await page.evaluate(() => window.music.invoke('settings.update', { enabledProviders: [] }))
  expect(invalid.ok).toBe(false)
  const blocked = await page.evaluate(() => window.music.invoke('catalog.search', { provider: 'qq', keywords: '音乐', kind: 'song', offset: 0 }))
  expect(blocked.ok).toBe(false)
  await accountSettings()
  await expect(account('netease').getByRole('checkbox', { name: '启用网易云音乐', exact: true })).toBeDisabled()
  await account('qq').getByRole('checkbox', { name: '启用QQ音乐', exact: true }).check()
  await expect.poll(async () => (await invoke('app.bootstrap')).settings.enabledProviders).toEqual(['netease', 'qq'])
})

test('logs into both platforms without replacing the first account or its playback', async () => {
  await account('netease').getByRole('button', { name: '登录网易云音乐', exact: true }).click()
  await page.getByRole('button', { name: 'Cookie 导入', exact: true }).click()
  await page.getByLabel('登录 Cookie', { exact: true }).fill('MUSIC_U=fixture')
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  netTracks = (await invoke('catalog.search', { provider: 'netease', keywords: '晚风', kind: 'song', offset: 0 })).tracks
  await invoke('player.play', { tracks: [netTracks[0]] })
  await expect(page.getByRole('button', { name: '暂停播放', exact: true })).toBeVisible()
  await loginQq()
  const state = await invoke('app.bootstrap')
  expect(state.sessions.netease.user?.id).toBe('42'); expect(state.sessions.qq.user?.id).toBe('84')
  expect(state.player.queue[state.player.index].provider).toBe('netease')
  expect(state.player.status).toBe('playing')
  expect(JSON.stringify(state)).not.toContain('qqmusic_session=')
  expect(JSON.stringify(state)).not.toContain('MUSIC_U=')
  qqTracks = (await invoke('catalog.search', { provider: 'qq', keywords: '晚风', kind: 'song', offset: 0 })).tracks
})

test('all nine pages expose independent remembered platform choices, with search results separated', async () => {
  await page.getByRole('button', { name: '发现音乐', exact: true }).click(); await platform('qq')
  await expect(page.getByRole('heading', { name: 'QQ测试听众，今天想听点什么？', exact: true })).toBeVisible()
  for (const name of ['每日推荐', '音乐漫游', '私人 FM', '我喜欢的', '我的歌单', '收藏专辑', '下载中心']) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect(page.getByRole('tablist', { name: '音乐平台', exact: true }).getByRole('tab', { name: '网易云音乐', exact: true })).toHaveAttribute('aria-selected', 'true')
  }
  await page.getByRole('button', { name: '我喜欢的', exact: true }).click()
  await expect(page.getByRole('button', { name: '播放 晚风经过', exact: true })).toBeVisible()
  await platform('qq')
  await expect(page.getByRole('button', { name: '播放 QQ晚风经过', exact: true })).toBeVisible()
  await search('双端晚风'); await platform('netease')
  await expect(page.getByRole('button', { name: '播放 晚风经过', exact: true })).toBeVisible()
  await platform('qq')
  await expect(page.getByRole('button', { name: '播放 QQ晚风经过', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '发现音乐', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'QQ音乐', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: '每日推荐', exact: true }).click()
  await expect(page.getByRole('tab', { name: '网易云音乐', exact: true })).toHaveAttribute('aria-selected', 'true')
  const prefs = (await invoke('app.bootstrap')).settings.pageProviders
  expect(prefs.home).toBe('qq'); expect(prefs.daily).toBe('netease'); expect(prefs.likes).toBe('qq'); expect(prefs.search).toBe('qq')
})

test('search retains separate platform pagination and resets both pages for a new keyword', async () => {
  await search('双端分页验收'); await platform('netease')
  await expect(page.locator('.track-row').first()).toContainText('分页歌曲 1')
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.locator('.track-row').first()).toContainText('分页歌曲 31')
  await platform('qq')
  await expect(page.locator('.track-row').first()).toContainText('QQ分页歌曲 1')
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.locator('.track-row').first()).toContainText('QQ分页歌曲 31')
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.locator('.track-row')).toHaveCount(5)
  await platform('netease')
  await expect(page.getByText('第 2 页 · 共 3 页', { exact: true })).toBeVisible()
  await expect(page.locator('.track-row').first()).toContainText('分页歌曲 31')
  await search('双端分页新关键词'); await platform('qq')
  await expect(page.locator('.track-row')).toHaveCount(6)
})

test('a QQ search rejection does not hide the NetEase search results', async () => {
  await search('双端错误隔离验收'); await platform('qq')
  await expect(page.locator('.error-state')).toContainText('QQ 音乐拒绝')
  await platform('netease')
  await expect(page.locator('.track-row')).toHaveCount(6)
  await expect(page.locator('.error-state')).toHaveCount(0)
  await platform('qq')
  await expect(page.locator('.error-state')).toContainText('QQ 音乐拒绝')
})

test('browsing QQ keeps NetEase playing and mixed queue advances with the correct lyrics and likes', async () => {
  await invoke('player.play', { tracks: [netTracks[0]] })
  await expect(page.getByRole('button', { name: '暂停播放', exact: true })).toBeVisible()
  await search('混合队列')
  await platform('qq')
  await expect(page.getByRole('button', { name: `将 ${qqTracks[0].title} 加入队列`, exact: true })).toBeVisible()
  const before = await invoke('app.bootstrap')
  expect(before.player.queue[before.player.index].provider).toBe('netease'); expect(before.player.status).toBe('playing')
  await page.getByRole('button', { name: `将 ${qqTracks[0].title} 加入队列`, exact: true }).click()
  await expect.poll(async () => (await invoke('app.bootstrap')).player.queue.map(track => track.provider)).toEqual(['netease', 'qq'])
  await page.locator('.playback-controls').getByRole('button', { name: '下一首', exact: true }).click()
  await expect.poll(async () => (await invoke('app.bootstrap')).player.queue[(await invoke('app.bootstrap')).player.index]?.provider).toBe('qq')
  await expect(page.getByRole('button', { name: '暂停播放', exact: true })).toBeVisible()
  await platform('netease')
  await page.getByRole('button', { name: '同步歌词', exact: true }).click()
  await expect(page.getByText('QQ晚风轻轻经过', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭播放面板', exact: true }).click()
  await page.locator('.playback-bar').getByRole('button', { name: '喜欢当前播放歌曲', exact: true }).click()
  await expect.poll(async () => (await invoke('library.list', { provider: 'qq', kind: 'likes', offset: 0 })).likedIds.includes(qqTracks[0].id)).toBe(false)
  expect((await invoke('library.list', { provider: 'netease', kind: 'likes', offset: 0 })).likedIds).toContain(netTracks[0].id)
  await page.locator('.playback-options').getByRole('button', { name: '加入歌单', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '加入歌单', exact: true })).toBeVisible()
  await expect(page.locator('.playlist-choice').first()).toContainText('我的QQ歌单')
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
})

test('downloads both platforms concurrently and browsing filters never interrupt either task', async () => {
  holdDownloads = true
  await invoke('downloads.add', { tracks: [netTracks[0], qqTracks[0]], quality: 'exhigh' })
  await expect.poll(async () => (await invoke('app.bootstrap')).downloads.filter(task => task.status === 'downloading').length).toBe(2)
  await page.getByRole('button', { name: '下载中心', exact: true }).click()
  await platform('netease'); await expect(page.locator('.download-row')).toHaveCount(1)
  await platform('qq'); await expect(page.locator('.download-row')).toHaveCount(1)
  expect((await invoke('app.bootstrap')).downloads.every(task => task.status === 'downloading')).toBe(true)
  releaseDownloads()
  await expect.poll(async () => (await invoke('app.bootstrap')).downloads.filter(task => task.status === 'completed').length).toBe(2)
  const files = (await readdir(join(directory, 'Libitum music 下载'))).filter(name => name.endsWith('.wav'))
  expect(files).toHaveLength(2)
  for (const file of files) expect(await readFile(join(directory, 'Libitum music 下载', file))).toEqual(pcm)
})

test('disabling NetEase stops only its playback and download, retains both logins and restores preferences on re-enable', async () => {
  await invoke('player.play', { tracks: [netTracks[0], qqTracks[0]] })
  await expect(page.getByRole('button', { name: '暂停播放', exact: true })).toBeVisible()
  holdDownloads = true
  await invoke('downloads.add', { tracks: [netTracks[1], qqTracks[1]], quality: 'exhigh' })
  await expect.poll(async () => (await invoke('app.bootstrap')).downloads.filter(task => task.status === 'downloading').length).toBe(2)
  await accountSettings()
  await account('netease').getByRole('checkbox', { name: '启用网易云音乐', exact: true }).uncheck()
  await expect.poll(async () => (await invoke('app.bootstrap')).settings.enabledProviders).toEqual(['qq'])
  const disabled = await invoke('app.bootstrap')
  expect(disabled.player.status).toBe('idle'); expect(disabled.player.queue.map(track => track.provider)).toEqual(['qq'])
  expect(disabled.sessions.netease.user?.id).toBe('42'); expect(disabled.sessions.qq.user?.id).toBe('84')
  expect(disabled.downloads.filter(task => task.status === 'downloading').map(task => task.track.provider)).toEqual(['qq'])
  await expect(account('qq').getByRole('checkbox', { name: '启用QQ音乐', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '每日推荐', exact: true }).click()
  await expect(page.getByRole('tablist', { name: '音乐平台', exact: true })).toHaveCount(0)
  expect((await invoke('app.bootstrap')).settings.pageProviders.daily).toBe('netease')
  await accountSettings(); await account('netease').getByRole('checkbox', { name: '启用网易云音乐', exact: true }).check()
  await expect.poll(async () => (await invoke('app.bootstrap')).settings.enabledProviders.length).toBe(2)
  const restored = await invoke('app.bootstrap')
  expect(restored.downloads.find(task => task.track.id === netTracks[1].id)?.status).toBe('interrupted')
  expect(restored.downloads.find(task => task.track.id === qqTracks[1].id)?.status).toBe('downloading')
  releaseDownloads()
  await page.getByRole('button', { name: '每日推荐', exact: true }).click()
  await expect(page.getByRole('tab', { name: '网易云音乐', exact: true })).toHaveAttribute('aria-selected', 'true')
})

test('cancelling or logging out of QQ leaves the NetEase session and player intact', async () => {
  await invoke('player.play', { tracks: [netTracks[0], qqTracks[0]] })
  await expect(page.getByRole('button', { name: '暂停播放', exact: true })).toBeVisible()
  await accountSettings()
  await account('qq').getByRole('button', { name: '重新登录', exact: true }).click()
  await expect(page.getByAltText('QQ音乐登录二维码')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(4200)
  expect((await invoke('app.bootstrap')).sessions.qq.user?.id).toBe('84')
  await account('qq').getByRole('button', { name: '退出登录', exact: true }).click()
  await expect(account('qq').getByText('尚未登录', { exact: true })).toBeVisible()
  const state = await invoke('app.bootstrap')
  expect(state.sessions.netease.user?.id).toBe('42'); expect(state.sessions.qq.user).toBeNull()
  expect(state.player.status).toBe('playing'); expect(state.player.queue.map(track => track.provider)).toEqual(['netease'])
})
