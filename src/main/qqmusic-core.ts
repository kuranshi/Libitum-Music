import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Pinned 3.3.5 has no public service-only export. Load its neutral modules without
// importing the package root, which starts an HTTP server as a side effect.
const requireCore = createRequire(import.meta.url)
const root = dirname(requireCore.resolve('@yakult-green-tea/qq-music-api/package.json'))
const core = (name: string) => requireCore(join(root, 'dist/src', `${name}.js`))
export const qqCore = {
  ...core('services/auth/qrLogin'),
  ...core('services/auth/deviceContextStore'),
  ...core('services/auth/androidDevice'),
  ...core('serverless/derivedDevice'),
  ...core('serverless/sealedResolver'),
  ...core('serverless/sealedSession'),
  ...core('serverless/router'),
  ...core('serverless/response'),
  ...core('transport/fetchAuthHttpClient'),
  ...core('transport/fetchLegacyTransport'),
  ...core('services/httpTransport'),
  ...core('routes/manifest')
}

interface AuthSession {
  token: string
  credential: Record<string, any>
  device: Record<string, any>
  expiresAt: number
}

/** Keep the bootstrapped device inside the encrypted session, alongside credentials. */
export function createQqSessionResolver(seed: string) {
  const secrets = { current: seed }
  const base = qqCore.createSealedSessionResolver({ secrets })
  const deviceOf = async (token?: string) => {
    if (!token) return null
    try {
      const payload = await qqCore.openToken(token, qqCore.SEALED_AUTH_PURPOSE, secrets)
      return qqCore.isAndroidDevice(payload.device) ? payload.device : null
    } catch { return null }
  }
  const attach = async (token: string, device: AuthSession['device']) => {
    const payload = await qqCore.openToken(token, qqCore.SEALED_AUTH_PURPOSE, secrets)
    return qqCore.sealToken({ ...payload, device }, qqCore.SEALED_AUTH_PURPOSE, seed)
  }
  return {
    mode: 'sealed' as const,
    issue: async (session: Omit<AuthSession, 'token'>): Promise<string> => attach(await base.issue(session), session.device),
    resolve: async (token?: string): Promise<AuthSession | null> => {
      const session = await base.resolve(token)
      if (!session) return null
      const device = await deviceOf(token)
      // Older tokens lack the login device. A fresh scan is needed to recover it.
      return device ? { ...session, device } : null
    },
    revoke: (token: string): Promise<void> => base.revoke(token),
    rotate: async (token: string, refresh: (session: AuthSession) => Promise<Record<string, any>>) => {
      const device = await deviceOf(token)
      if (!device) return null
      const result = await base.rotate(token, (session: AuthSession) => refresh({ ...session, device }))
      return result?.rotated ? { ...result, token: await attach(result.token, device) } : result
    }
  }
}
