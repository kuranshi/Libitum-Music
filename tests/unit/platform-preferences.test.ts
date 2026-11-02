import { describe, expect, it } from 'vitest'
import { normalizePlatforms, pageProvider, platformDefaults, PLATFORM_PAGES } from '../../src/shared/platforms'
import { sessionRecords } from '../../src/main/session-records'
import { validateCommand } from '../../src/main/validation'

describe('platform settings and saved account migration', () => {
  it('retains the previous platform while migrating settings without platform preferences', () => {
    expect(normalizePlatforms({}, 'qq').enabledProviders).toEqual(['qq'])
    expect(PLATFORM_PAGES.every(page => normalizePlatforms({}, 'qq').pageProviders[page] === 'qq')).toBe(true)
    expect(normalizePlatforms({ enabledProviders: [] }).enabledProviders).toEqual(['netease'])
    expect(normalizePlatforms({ enabledProviders: ['unknown', 'qq', 'qq'] }).enabledProviders).toEqual(['qq'])
  })
  it('temporarily uses the remaining platform without overwriting page preferences', () => {
    const settings = platformDefaults('netease')
    settings.pageProviders.home = 'qq'; settings.enabledProviders = ['netease', 'qq']
    expect(pageProvider(settings, 'home')).toBe('qq')
    expect(pageProvider(settings, 'likes')).toBe('netease')
    settings.enabledProviders = ['netease']
    expect(pageProvider(settings, 'home')).toBe('netease'); expect(settings.pageProviders.home).toBe('qq')
    settings.enabledProviders.push('qq'); expect(pageProvider(settings, 'home')).toBe('qq')
  })
  it('rejects closing the last platform, duplicate platforms and unscoped content requests at IPC', () => {
    for (const enabledProviders of [[], ['netease', 'netease'], ['unknown']]) expect(() => validateCommand('settings.update', { enabledProviders })).toThrow()
    expect(() => validateCommand('settings.update', { enabledProviders: ['qq'] })).not.toThrow()
    expect(() => validateCommand('settings.update', { pageProviders: { home: 'qq' } })).toThrow()
    expect(() => validateCommand('catalog.search', { keywords: '音乐', kind: 'song', offset: 0 })).toThrow()
    expect(() => validateCommand('auth.logout', undefined)).toThrow()
  })
  it('migrates the legacy encrypted account without exposing or rewriting credentials', () => {
    const user = { id: '42', nickname: '示例', avatarUrl: '' }
    expect(sessionRecords({ encrypted: 'ciphertext', user })).toEqual({ netease: { encrypted: 'ciphertext', user, provider: 'netease' } })
    expect(sessionRecords({ encrypted: 'ciphertext', user, provider: 'qq' })).toEqual({ qq: { encrypted: 'ciphertext', user, provider: 'qq' } })
    const saved = { schemaVersion: 2, sessions: { netease: { encrypted: 'net-ciphertext', user }, qq: { encrypted: 'qq-ciphertext', user } } }
    expect(Object.keys(sessionRecords(JSON.parse(JSON.stringify(saved))))).toEqual(['netease', 'qq'])
    expect(Object.keys(sessionRecords({ ...saved, sessions: { ...saved.sessions, qq: { encrypted: 4, user } } }))).toEqual(['netease'])
  })
})
