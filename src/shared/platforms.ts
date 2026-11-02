import type { ProviderId, Session, PlatformPreferences, PlatformPage, Track } from './types'

export const PROVIDERS: Record<ProviderId, string> = { netease: '网易云音乐', qq: 'QQ音乐' }
export function isProvider(value: unknown): value is ProviderId { return value === 'netease' || value === 'qq' }
export function sessionProvider(session: Session): ProviderId { return session.user && session.provider === 'qq' ? 'qq' : 'netease' }
export function accountKey(provider: ProviderId, userId: string): string { return `${provider}:${userId}` }

export const PLATFORM_IDS: ProviderId[] = ['netease', 'qq']
export const PLATFORM_PAGES: PlatformPage[] = ['home', 'daily', 'radio', 'fm', 'likes', 'playlists', 'albums', 'downloads', 'search']
export function platformDefaults(provider: ProviderId = 'netease'): PlatformPreferences {
  return { enabledProviders: [provider], pageProviders: Object.fromEntries(PLATFORM_PAGES.map(page => [page, provider])) as Record<PlatformPage, ProviderId> }
}
export function normalizePlatforms(value: any, legacy: ProviderId = 'netease'): PlatformPreferences {
  const result = platformDefaults(legacy)
  if (Array.isArray(value?.enabledProviders)) {
    const ids = PLATFORM_IDS.filter(id => value.enabledProviders.includes(id))
    if (ids.length) result.enabledProviders = ids
  }
  for (const page of PLATFORM_PAGES) if (isProvider(value?.pageProviders?.[page])) result.pageProviders[page] = value.pageProviders[page]
  return result
}
export function pageProvider(settings: PlatformPreferences, page: PlatformPage): ProviderId {
  const preferred = settings.pageProviders[page]
  return settings.enabledProviders.includes(preferred) ? preferred : settings.enabledProviders[0]
}
export function trackKey(track: Pick<Track, 'provider' | 'id'>): string { return `${track.provider}:${track.id}` }
export function emptySessions(): Record<ProviderId, Session> {
  return { netease: { provider: 'netease', user: null, persistent: false }, qq: { provider: 'qq', user: null, persistent: false } }
}
