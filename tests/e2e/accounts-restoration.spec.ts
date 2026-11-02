import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { randomBytes, createCipheriv } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { normalizeTrack } from '../../src/main/normalize'
import { platformDefaults } from '../../src/shared/platforms'
import type { Command, CommandMap } from '../../src/shared/types'

let instance: ElectronApplication | undefined, page: Page, directory: string, launcher: string, key: Buffer
const netUser = { id: '42', nickname: '测试听众', avatarUrl: '' }, qqUser = { id: '84', nickname: 'QQ测试听众', avatarUrl: '' }
function encrypt(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64')
}
async function invoke<K extends Command>(command: K, args?: CommandMap[K]['args']): Promise<CommandMap[K]['result']> {
  const result = await page.evaluate(({ command, args }) => window.music.invoke(command, args), { command, args })
  if (!result.ok) throw new Error(result.error.code)
  return result.data as CommandMap[K]['result']
}
async function open() {
  const env: Record<string, string> = { ...process.env, CLOUD_MUSIC_TEST: '1', CLOUD_MUSIC_TEST_DIR: directory }
  delete env.ELECTRON_RUN_AS_NODE
  instance = await electron.launch({ args: [launcher, '--no-sandbox', '--disable-gpu', '--ozone-platform=headless', '--password-store=basic'], env })
  page = await instance.firstWindow(); await expect(page.locator('.app-shell')).toBeVisible()
}
async function restart() { await instance!.close(); instance = undefined; await open() }
async function writeSettings() {
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ version: 1, data: { ...platformDefaults(), enabledProviders: ['netease', 'qq'] } }))
}
test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'libitum-session-restore-')); launcher = join(directory, 'launcher.cjs'); key = randomBytes(32)
  // A host-injected cipher exercises production persistence without needing or
  // altering a real keyring. This launcher exists only in the temporary test dir.
  await writeFile(launcher, `const {safeStorage}=require('electron');const crypto=require('node:crypto');const key=Buffer.from(${JSON.stringify(key.toString('base64'))},'base64');Object.assign(safeStorage,{isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=>'test-keyring',encryptString:value=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes])},decryptString:buffer=>{const decipher=crypto.createDecipheriv('aes-256-gcm',key,buffer.subarray(0,12));decipher.setAuthTag(buffer.subarray(12,28));return Buffer.concat([decipher.update(buffer.subarray(28)),decipher.final()]).toString('utf8')}});require(${JSON.stringify(resolve('out/main/index.js'))});`, { mode: 0o600 })
})
test.afterEach(async () => { if (instance) await instance.close(); instance = undefined; await rm(directory, { recursive: true, force: true }) })

test('restores simultaneous encrypted accounts and disabled-platform login after restart, then logs out only QQ', async () => {
  await open()
  await invoke('settings.update', { enabledProviders: ['netease', 'qq'] })
  await Promise.all([
    invoke('auth.importCookie', { provider: 'netease', cookie: 'MUSIC_U=fixture' }),
    invoke('auth.importCookie', { provider: 'qq', cookie: 'qqmusic_session=fixture-qq-session' })
  ])
  const before = await invoke('app.bootstrap')
  expect(before.sessions.netease.persistent).toBe(true); expect(before.sessions.qq.persistent).toBe(true)
  await invoke('settings.update', { enabledProviders: ['qq'], pageProviders: { ...before.settings.pageProviders, search: 'qq' } })
  const archive = await readFile(join(directory, 'session.json'), 'utf8')
  expect(archive).not.toContain('MUSIC_U=fixture'); expect(archive).not.toContain('qqmusic_session=fixture')
  expect(Object.keys(JSON.parse(archive).data.sessions)).toEqual(['netease', 'qq'])
  await restart()
  const restored = await invoke('app.bootstrap')
  expect(restored.settings.enabledProviders).toEqual(['qq'])
  expect(restored.settings.pageProviders.search).toBe('qq'); expect(restored.settings.pageProviders.home).toBe('netease')
  expect(restored.sessions.netease.user?.id).toBe('42'); expect(restored.sessions.qq.user?.id).toBe('84')
  await invoke('settings.update', { enabledProviders: ['netease', 'qq'] })
  await expect.poll(async () => (await invoke('library.list', { provider: 'netease', kind: 'likes', offset: 0 })).likedIds).toContain('1001')
  await invoke('auth.logout', { provider: 'qq' }); await restart()
  const final = await invoke('app.bootstrap')
  expect(final.sessions.qq.user).toBeNull(); expect(final.sessions.netease.user?.id).toBe('42')
})

test('migrates an old encrypted QQ login and defaults old settings to QQ without losing the account', async () => {
  await writeFile(join(directory, 'session.json'), JSON.stringify({ version: 1, data: { encrypted: encrypt('qqmusic_session=fixture-qq-session'), user: qqUser, provider: 'qq' } }))
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ version: 1, data: { theme: 'dark' } }))
  await open()
  await expect.poll(async () => {
    const archive = JSON.parse(await readFile(join(directory, 'session.json'), 'utf8'))
    return archive.data.schemaVersion
  }).toBe(2)
  const state = await invoke('app.bootstrap')
  expect(state.settings.enabledProviders).toEqual(['qq']); expect(state.settings.theme).toBe('dark')
  expect(state.sessions.qq.user?.id).toBe('84'); expect(state.sessions.netease.user).toBeNull()
  await expect(page.getByRole('tablist', { name: '音乐平台', exact: true })).toHaveCount(0)
})

test('expires only the rejected QQ account while retaining NetEase login and its queue entry', async () => {
  await writeSettings()
  await writeFile(join(directory, 'session.json'), JSON.stringify({ version: 1, data: { schemaVersion: 2, sessions: {
    netease: { encrypted: encrypt('MUSIC_U=fixture'), user: netUser, provider: 'netease' },
    qq: { encrypted: encrypt('qqmusic_session=expired-fixture'), user: qqUser, provider: 'qq' }
  } } }))
  const net = normalizeTrack({ id: 1001, name: '示例', dt: 20000 }), qq = { ...net, provider: 'qq' as const, id: 'QqSong1001' }
  await writeFile(join(directory, 'queue.json'), JSON.stringify({ version: 1, data: { queue: [net, qq], index: 1, position: 0, repeat: 'list' } }))
  await open()
  await expect.poll(async () => (await invoke('app.bootstrap')).sessions.qq.user).toBeNull()
  const state = await invoke('app.bootstrap')
  expect(state.sessions.netease.user?.id).toBe('42'); expect(state.player.queue.map(track => track.provider)).toEqual(['netease'])
  await expect.poll(async () => Object.keys(JSON.parse(await readFile(join(directory, 'session.json'), 'utf8')).data.sessions)).toEqual(['netease'])
})

test('a corrupted encrypted QQ record does not discard the valid NetEase record', async () => {
  await writeSettings()
  await writeFile(join(directory, 'session.json'), JSON.stringify({ version: 1, data: { schemaVersion: 2, sessions: {
    netease: { encrypted: encrypt('MUSIC_U=fixture'), user: netUser, provider: 'netease' },
    qq: { encrypted: 'invalid-ciphertext', user: qqUser, provider: 'qq' }
  } } }))
  await open()
  const state = await invoke('app.bootstrap')
  expect(state.sessions.netease.user?.id).toBe('42'); expect(state.sessions.qq.user).toBeNull()
  expect(state.sessions.qq.message).toContain('无法恢复')
})
