import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, CheckCircle2, FolderOpen, LoaderCircle, QrCode, RefreshCw, ShieldCheck } from 'lucide-react'
import type { ProviderId, Quality } from '../../shared/types'
import { PROVIDERS } from '../../shared/platforms'
import { Busy, ErrorState, Modal, QualitySelect } from './components'
import { request, useApp } from './state'
import { QR_POLL_INTERVAL_MS, qrRetryDelay, transientLoginError } from '../../shared/login'

export function LoginDialog() {
  const { loginProvider: provider, setLoginOpen, toast, act } = useApp()
  const providerName = PROVIDERS[provider]
  const [tab, setTab] = useState<'qr' | 'cookie'>('qr'), [cookie, setCookie] = useState(''), [saving, setSaving] = useState(false)
  const [qr, setQr] = useState(''), [status, setStatus] = useState('loading'), [error, setError] = useState(''), [errorCode, setErrorCode] = useState(''), [retrying, setRetrying] = useState(false), [revision, setRevision] = useState(0)
  const resume = useRef<(() => void) | null>(null), version = useRef(0)
  useEffect(() => () => { version.current++; void request('auth.cancel', { provider }).catch(() => {}) }, [])
  useEffect(() => {
    const requestVersion = ++version.current
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined, key = '', failures = 0, inFlight = false
    setError(''); setErrorCode(''); setStatus('loading'); setQr(''); setRetrying(false); resume.current = null
    if (tab === 'qr') void (async () => {
      try {
        const code = await request('auth.qrStart', { provider })
        if (!alive || version.current !== requestVersion) {
          void request('auth.qrCancel', { key: code.key, provider }).catch(() => {})
          return
        }
        key = code.key; setQr(code.dataUrl); setStatus('waiting')
        const poll = async () => {
          if (!alive || version.current !== requestVersion || inFlight) return
          inFlight = true
          try {
            const result = await request('auth.qrCheck', { key, provider })
            if (!alive || version.current !== requestVersion) return
            failures = 0; setError(''); setErrorCode(''); setRetrying(false); setStatus(result.state)
            if (result.state === 'success') { toast(result.session?.message || '登录成功，欢迎回来。'); setLoginOpen(false); return }
            if (result.state !== 'expired') timer = setTimeout(() => void poll(), QR_POLL_INTERVAL_MS)
          } catch (error) {
            if (!alive || version.current !== requestVersion) return
            const problem = error as Error & { code?: string }
            const delay = transientLoginError(problem.code) ? qrRetryDelay(++failures) : null
            setErrorCode(problem.code || '')
            setRetrying(delay !== null)
            if (delay !== null) {
              setError('连接暂时中断，正在重新检查同一张二维码，无需重新扫码。')
              timer = setTimeout(() => void poll(), delay)
            } else {
              setError(problem.message); setStatus(problem.code === 'RISK_BLOCKED' ? 'blocked' : 'paused')
            }
          } finally { inFlight = false }
        }
        resume.current = () => { if (timer) clearTimeout(timer); failures = 0; setError(''); setRetrying(false); void poll() }
        timer = setTimeout(() => void poll(), QR_POLL_INTERVAL_MS)
      } catch (error) {
        if (alive && version.current === requestVersion) { const problem = error as Error & { code?: string }; setError(problem.message); setErrorCode(problem.code || ''); setStatus(problem.code === 'RISK_BLOCKED' ? 'blocked' : 'error') }
      }
    })()
    return () => {
      alive = false; resume.current = null
      if (timer) clearTimeout(timer)
      if (key) void request('auth.qrCancel', { key, provider }).catch(() => {})
    }
  }, [provider, tab, revision])
  const importCookie = async () => {
    const requestVersion = ++version.current
    setSaving(true); setError('')
    try { const session = await request('auth.importCookie', { cookie: cookie.trim(), provider }); if (version.current === requestVersion) { setCookie(''); toast(session.message || '登录成功，欢迎回来。'); setLoginOpen(false) } }
    catch (error) { if (version.current === requestVersion) setError((error as Error).message) } finally { if (version.current === requestVersion) setSaving(false) }
  }
  const retry = retrying || ['RISK_BLOCKED','RATE_LIMITED'].includes(errorCode) ? undefined : qr ? () => resume.current?.() : () => setRevision(value => value + 1)
  return <Modal title="让音乐，更懂你" subtitle={`登录你的${providerName}账号`} close={() => { version.current++; void request('auth.cancel', { provider }).catch(() => {}); setLoginOpen(false) }}>
    {provider === 'netease' && <div className="tabs centered"><button className={tab === 'qr' ? 'selected' : ''} disabled={saving} onClick={() => setTab('qr')}>扫码登录</button><button className={tab === 'cookie' ? 'selected' : ''} disabled={saving} onClick={() => setTab('cookie')}>Cookie 导入</button></div>}
    {tab === 'qr' ? <div className="qr-panel">
      {status === 'loading' ? <Busy label="正在生成二维码…"/> : qr ? <div className="qr-image"><img src={qr} alt={`${provider === 'qq' ? 'QQ音乐' : '网易云'}登录二维码`}/>
        {status === 'expired' && <div className="qr-expired"><span>二维码已过期</span><button className="button primary" onClick={() => setRevision(value => value + 1)}><RefreshCw size={15}/>刷新二维码</button></div>}
        {status === 'blocked' && <div className="qr-expired"><span>本次登录已被{providerName}限制</span>{provider === 'netease' && <button className="button subtle" onClick={() => setTab('cookie')}>使用已有 Cookie</button>}</div>}
      </div> : null}
      <div className={`qr-status ${status === 'confirm' ? 'confirmed' : ''}`}>{status === 'confirm' ? <><CheckCircle2 size={17}/>已扫码，请在手机上确认</> : status === 'waiting' && !error ? <><QrCode size={17}/>使用{providerName} App 扫码</> : null}</div>
      {retrying && <div className="qr-status"><LoaderCircle size={15} className="spin"/>正在恢复连接…</div>}
      {error && <ErrorState error={error} retry={retry}/>}
      <p className="qr-help">若手机提示“设备环境异常”或“操作被拦截”，请暂停重复扫码，按官方 App 提示处理。</p>
    </div> : <form className="cookie-panel" onSubmit={event => { event.preventDefault(); void importCookie() }}>
      <p>从本人已正常登录的网易云音乐网页中复制 Cookie，需包含 <code>MUSIC_U</code> 字段。导入已有会话也受平台账号权限与限制约束。</p>
      <button type="button" className="button subtle full-width" onClick={() => void act(request('app.openExternal', { url: 'https://music.163.com/' }))}>打开网易云音乐网页版</button>
      <label htmlFor="account-cookie">登录 Cookie</label><input id="account-cookie" className="input" type="password" autoComplete="off" spellCheck={false} placeholder="MUSIC_U=…" value={cookie} onChange={event => setCookie(event.target.value)}/>
      {error && <p className="inline-error">{error}</p>}<button type="submit" className="button primary full-width" disabled={!cookie.trim() || saving}>{saving ? <LoaderCircle size={17} className="spin"/> : <ShieldCheck size={17}/>}验证并登录</button>
    </form>}
    <div className="login-footnote"><ShieldCheck size={14}/>凭证由本机后台处理，密钥环可用时加密保存。</div>
  </Modal>
}
export function DownloadDialog() {
  const { data, downloadTracks, setDownloadTracks, act, toast } = useApp()
  const [quality, setQuality] = useState<Quality>(data.settings.downloadQuality), [busy, setBusy] = useState(false)
  const confirm = async () => {
    if (!downloadTracks) return
    setBusy(true)
    try { await request('downloads.add', { tracks: downloadTracks, quality }); toast(`已添加下载任务，重复任务会自动跳过。`); setDownloadTracks(null) }
    catch (error) { if ((error as Error & { code?: string }).code !== 'SESSION_CHANGED') toast((error as Error).message) } finally { setBusy(false) }
  }
  return <Modal title="把喜欢，留在本地" subtitle={`${downloadTracks?.length || 0} 首歌曲 · 下载原始音频文件`} close={() => { if (!busy) setDownloadTracks(null) }}><div className="download-dialog-summary"><ArrowDownToLine size={25}/><div><strong>{downloadTracks?.length === 1 ? downloadTracks[0].title : `${downloadTracks?.length} 首歌曲`}</strong><span>只保存账号有下载权限的完整歌曲</span></div></div><div className="setting-row"><strong>下载音质</strong><QualitySelect label="本次下载音质" value={quality} onChange={setQuality}/></div><div className="download-location"><div><FolderOpen size={17}/><span>{data.settings.downloadDirectory}</span></div><button className="text-link" disabled={busy} onClick={() => void act(request('settings.pickDirectory'))}>更改</button></div><p className="muted small-text">音质不可用或下载失败时，可以在下载中心更换音质并重试。</p><button className="button primary full-width" disabled={busy} onClick={() => void confirm()}>{busy ? <LoaderCircle size={17} className="spin"/> : <ArrowDownToLine size={17}/>}开始下载</button></Modal>
}
