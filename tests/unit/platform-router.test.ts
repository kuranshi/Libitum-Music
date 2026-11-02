import { describe, expect, it, vi } from 'vitest'
import { PlatformRouter } from '../../src/main/platform-router'
import { NeteaseProvider } from '../../src/main/provider'
import { createFixtureApi } from '../../src/main/test-fixtures'
import { isTrack, validateCommand } from '../../src/main/validation'
import { accountKey, sessionProvider } from '../../src/shared/platforms'
import { MusicError } from '../../src/shared/errors'
import type { SearchResult } from '../../src/shared/types'

const user = { id: '42', nickname: '示例听众', avatarUrl: '' }
function providers() {
  const netease = new NeteaseProvider(createFixtureApi()), qq = new NeteaseProvider(createFixtureApi())
  const factory = vi.fn(async () => qq)
  return { netease, qq, factory, router: new PlatformRouter(netease, factory) }
}
describe('independent platform routing', () => {
  it('initializes only the requested platform', async () => {
    const { router, factory, netease } = providers()
    expect(await router.run(p => p, 'netease')).toBe(netease)
    expect(factory).not.toHaveBeenCalled()
  })
  it('keeps both sessions and clears only the requested one', async () => {
    const { router, netease, qq, factory } = providers()
    const clearNet = vi.spyOn(netease, 'setSession')
    await router.setSession('qq', 'qqmusic_session=fixture', user)
    expect(clearNet).not.toHaveBeenCalled()
    expect(await router.run(p => p, 'qq')).toBe(qq)
    expect(await router.run(p => p, 'netease')).toBe(netease)
    await router.clear('qq')
    expect(clearNet).not.toHaveBeenCalled(); expect(factory).toHaveBeenCalledTimes(1)
  })
  it('discards responses from a replaced account on the same platform', async () => {
    const { router } = providers()
    let finish!: (value: string) => void
    const result = router.run(() => new Promise<string>(resolve => { finish = resolve }), 'netease')
    await vi.waitFor(() => expect(finish).toBeDefined())
    await router.setSession('netease', 'MUSIC_U=new', user)
    finish('old')
    await expect(result).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
  })
  it('keeps another platform request alive when QQ logs in or out', async () => {
    const { router } = providers()
    let finish!: (value: string) => void
    const result = router.run(() => new Promise<string>(resolve => { finish = resolve }), 'netease')
    await vi.waitFor(() => expect(finish).toBeDefined())
    await router.setSession('qq', 'qqmusic_session=fixture', user); await router.clear('qq')
    finish('netease-result'); await expect(result).resolves.toBe('netease-result')
  })
  it('does not turn a stale authentication error into a new account expiry', async () => {
    const { router } = providers()
    let fail!: (reason: Error) => void
    const result = router.run(() => new Promise((_, reject) => { fail = reject }), 'qq')
    await vi.waitFor(() => expect(fail).toBeDefined())
    await router.setSession('qq', 'qqmusic_session=fixture', user)
    fail(new MusicError('AUTH_EXPIRED', 'old'))
    await expect(result).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
  })
  it('rejects an obsolete QQ login while preserving an independent NetEase login', async () => {
    const { netease, qq } = providers()
    let ready!: (value: NeteaseProvider) => void
    const router = new PlatformRouter(netease, () => new Promise(resolve => { ready = resolve }))
    const pending = router.setSession('qq', 'qqmusic_session=old', user)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
    const replacement = router.setSession('qq', 'qqmusic_session=new', user)
    await router.setSession('netease', 'MUSIC_U=fixture', user)
    ready(qq); await replacement; await rejected
    expect(await router.run(p => p, 'netease')).toBe(netease)
  })
})
describe('platform identifiers at the IPC interface', () => {
  it('accepts QQ mids without accepting path fragments or unknown platforms', async () => {
    const track = (await new NeteaseProvider(createFixtureApi()).search('音乐', 'song', 0)).tracks[0]
    const qq = { ...track, provider: 'qq', id: '003aAYrm3GE0Ac', artists: track.artists.map(artist => ({ ...artist, provider: 'qq', id: '0025NhlN2yWrP4' })) }
    expect(isTrack(qq)).toBe(true)
    expect(() => validateCommand('player.play', { tracks: [qq] })).not.toThrow()
    expect(() => validateCommand('catalog.detail', { provider: 'qq', kind: 'artist', id: '0025NhlN2yWrP4', offset: 0 })).not.toThrow()
    expect(isTrack({ ...qq, id: '../secrets' })).toBe(false)
    expect(isTrack({ ...qq, provider: 'unknown' })).toBe(false)
    expect(() => validateCommand('auth.qrStart', { provider: 'unknown' })).toThrow()
  })
  it('does not use a QQ credential as a NetEase login, and keeps old sessions on NetEase', () => {
    expect(() => validateCommand('auth.importCookie', { cookie: 'qqmusic_session=fixture' })).toThrow()
    expect(() => validateCommand('auth.importCookie', { provider: 'qq', cookie: 'MUSIC_U=fixture' })).toThrow()
    expect(() => validateCommand('auth.importCookie', { provider: 'qq', cookie: 'qqmusic_session=fixture' })).not.toThrow()
    expect(sessionProvider({ user, persistent: true })).toBe('netease')
    expect(sessionProvider({ user: null, provider: 'qq', persistent: false })).toBe('netease')
    expect(accountKey('qq', '42')).not.toBe(accountKey('netease', '42'))
  })
})
