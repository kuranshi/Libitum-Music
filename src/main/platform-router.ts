import { MusicError } from '../shared/errors'
import { isProvider } from '../shared/platforms'
import type { ProviderId, User } from '../shared/types'
import type { MusicProvider } from './provider'

/** Independent sessions and revisions; every content request declares its platform. */
export class PlatformRouter {
  private instances = new Map<ProviderId, Promise<MusicProvider>>()
  private revisions: Record<ProviderId, number> = { netease: 0, qq: 0 }
  constructor(netease: MusicProvider, private createQq: () => Promise<MusicProvider>) {
    this.instances.set('netease', Promise.resolve(netease))
  }
  candidate(id: ProviderId = 'netease'): Promise<MusicProvider> {
    if (!isProvider(id)) return Promise.reject(new MusicError('INVALID_ARGUMENT', '音乐平台无效。'))
    let provider = this.instances.get(id)
    if (!provider) {
      provider = this.createQq().catch(error => { this.instances.delete(id); throw error })
      this.instances.set(id, provider)
    }
    return provider
  }
  async setSession(id: ProviderId, cookie: string, user: User | null) {
    const revision = ++this.revisions[id]
    const target = await this.candidate(id)
    if (revision !== this.revisions[id]) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新登录。')
    target.setSession(cookie, user)
  }
  invalidate(id: ProviderId) { this.revisions[id]++ }
  async clear(id: ProviderId) {
    await this.setSession(id, '', null)
  }
  async run<T>(operation: (provider: MusicProvider) => Promise<T> | T, id: ProviderId): Promise<T> {
    if (!isProvider(id)) throw new MusicError('INVALID_ARGUMENT', '音乐平台无效。')
    const revision = this.revisions[id]
    const provider = await this.candidate(id)
    if (revision !== this.revisions[id]) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新加载。')
    try {
      const result = await operation(provider)
      if (revision !== this.revisions[id]) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新加载。')
      return result
    } catch (error) {
      if (revision !== this.revisions[id]) throw new MusicError('SESSION_CHANGED', '账号状态已改变，请重新加载。')
      throw error
    }
  }
}
