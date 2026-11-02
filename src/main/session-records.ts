import { isProvider, PLATFORM_IDS } from '../shared/platforms'
import type { ProviderId, User } from '../shared/types'

export interface SavedSession { encrypted: string; user: User; provider?: ProviderId }
export type SavedSessions = Partial<Record<ProviderId, SavedSession>>
export interface SessionArchive { schemaVersion: 2; sessions: SavedSessions }

/** Accept the former single-account shape without dropping the other valid records. */
export function sessionRecords(value: unknown): SavedSessions {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, any>
  const source = raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : { [raw.provider === 'qq' ? 'qq' : 'netease']: raw }
  const result: SavedSessions = {}
  for (const provider of PLATFORM_IDS) {
    const record = source[provider], user = record?.user
    if (typeof record?.encrypted !== 'string' || !record.encrypted || !user || typeof user.id !== 'string' || !user.id || typeof user.nickname !== 'string' || typeof user.avatarUrl !== 'string') continue
    if (record.provider !== undefined && (!isProvider(record.provider) || record.provider !== provider)) continue
    result[provider] = { encrypted: record.encrypted, user: { id: user.id, nickname: user.nickname, avatarUrl: user.avatarUrl }, provider }
  }
  return result
}
