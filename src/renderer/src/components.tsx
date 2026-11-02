import { trackKey } from '../../shared/platforms'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDownToLine, Check, ChevronLeft, ChevronRight, Disc3, Heart, ListPlus, LoaderCircle, Music2, Pause, Play, Plus, RefreshCw, X } from 'lucide-react'
import type { Collection, Quality, Track } from '../../shared/types'
import { QUALITIES } from '../../shared/types'
import { request, useApp, platformPage, platformName } from './state'

export function IconButton({ title, children, onClick, active = false, disabled = false, className = '' }: { title: string; children: ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean; className?: string }) { return <button type="button" title={title} aria-label={title} className={`icon-button ${active ? 'active' : ''} ${className}`} disabled={disabled} onClick={onClick}>{children}</button> }
export function Cover({ url, title, size = '', id = title }: { url?: string; title: string; size?: string; id?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  const hue = [...id].reduce((value, character) => value + character.charCodeAt(0), 0) % 360
  return <div className={`cover ${size}`} style={{ '--cover-hue': hue } as React.CSSProperties}>{url && !failed ? <img src={url.includes('?') ? url : `${url}?param=400y400`} alt={title} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <><span className="cover-orbit"/><Disc3 size={size === 'tiny' ? 22 : 48} strokeWidth={1} /><span className="cover-caption">{title.slice(0, 12)}</span></>}</div>
}
export function Busy({ label = '正在加载音乐…' }: { label?: string }) { return <div className="state-block"><LoaderCircle className="spin" size={24}/><span>{label}</span></div> }
export function Empty({ title = '这里还没有音乐', description, action }: { title?: string; description?: string; action?: ReactNode }) { return <div className="state-block empty"><Music2 size={34} strokeWidth={1.2}/><h3>{title}</h3>{description && <p>{description}</p>}{action}</div> }
export function ErrorState({ error, retry }: { error: string; retry?: () => void }) { return <div className="state-block error-state"><p>{error}</p>{retry && <button className="button subtle" onClick={retry}><RefreshCw size={14}/>重新加载</button>}</div> }
export function LoginPrompt({ description = '登录后，把喜欢的音乐带到这里。' }: { description?: string }) { const { provider, session, login } = useApp(); return <Empty title="音乐，从你的账号开始" description={description} action={<button className="button primary" onClick={() => login()}>登录音乐账号</button>}/> }
export function PlatformSwitch() {
  const { data, page, provider, act } = useApp()
  const key = platformPage(page)
  if (!key || data.settings.enabledProviders.length < 2) return null
  return <div className="platform-switch tabs" role="tablist" aria-label="音乐平台">{data.settings.enabledProviders.map(id => <button type="button" role="tab" aria-selected={provider === id} className={provider === id ? 'selected' : ''} key={id} onClick={() => void act(request('settings.update', { pageProviders: { ...data.settings.pageProviders, [key]: id } }))}>{platformName(id)}</button>)}</div>
}
export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <><div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div><PlatformSwitch/></>
}
export function CollectionGrid({ collections }: { collections: Collection[] }) {
  const { provider, session, navigate } = useApp()
  return <div className="collection-grid">{collections.map(item => <button className="collection-card" aria-label={`${item.title} ${item.creatorName || (item.kind === 'artist' ? '歌手' : item.kind === 'album' ? '专辑' : '精选歌单')}`} key={`${item.provider}-${item.kind}-${item.id}`} onClick={() => navigate({ type: 'detail', provider: item.provider, kind: item.kind, id: item.id })}><div className="card-art"><Cover url={item.coverUrl} title={item.title} id={item.id}/><span className="cover-play"><Play size={22} fill="currentColor"/></span>{item.owned && <span className="card-badge">我的歌单</span>}</div><strong>{item.title}</strong><span>{item.creatorName || (item.kind === 'artist' ? '歌手' : item.kind === 'album' ? '专辑' : '精选歌单')}</span></button>)}</div>
}
export const time = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`
export function TracksTable({ tracks, total, getAll, compact = false }: { tracks: Track[]; total?: number; getAll?: () => Promise<Track[]>; compact?: boolean }) {
  const { provider, session, data, act, download, likedIds, toggleLike, liking, navigate, addToPlaylist } = useApp()
  const [selected, setSelected] = useState<Set<string>>(new Set()), [busy, setBusy] = useState(false)
  const allSelected = tracks.length > 0 && tracks.every(track => selected.has(track.id))
  const doAction = async (kind: 'play' | 'append' | 'download') => {
    setBusy(true)
    try {
      const list = selected.size ? tracks.filter(track => selected.has(track.id)) : getAll ? await getAll() : tracks
      if (kind === 'download') download(list)
      else await request('player.play', { tracks: list, append: kind === 'append' })
    } catch (error) { await act(Promise.reject(error)) } finally { setBusy(false) }
  }
  if (!tracks.length) return <Empty title="暂无歌曲"/>
  return <div className={`tracks-block ${compact ? 'compact' : ''}`}>
    <div className="track-toolbar"><button className="button primary" disabled={busy} onClick={() => void doAction('play')}>{busy ? <LoaderCircle size={16} className="spin"/> : <Play size={15} fill="currentColor"/>}{selected.size ? `播放所选 ${selected.size} 首` : '播放全部'}</button><button className="button subtle" disabled={busy} onClick={() => void doAction('append')}><ListPlus size={17}/>加入队列</button><button className="button subtle" disabled={busy} onClick={() => void doAction('download')}><ArrowDownToLine size={16}/>下载</button><span className="toolbar-count">共 {total ?? tracks.length} 首</span></div>
    <div className="track-header"><input type="checkbox" aria-label="选择本页全部歌曲" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(tracks.map(track => track.id)))}/><span>#</span><span>歌曲</span><span className="album-column">专辑</span><span>时长</span><span/></div>
    <div className="track-list">{tracks.map((track, index) => {
      const current = data.player.queue[data.player.index]?.id === track.id && data.player.queue[data.player.index]?.provider === track.provider
      return <div className={`track-row ${current ? 'current' : ''}`} key={`${track.provider}:${track.id}`} onDoubleClick={() => void act(request('player.play', { tracks, index }))}>
        <input type="checkbox" aria-label={`选择歌曲 ${track.title}`} checked={selected.has(track.id)} onChange={() => setSelected(ids => { const next = new Set(ids); if (next.has(track.id)) next.delete(track.id); else next.add(track.id); return next })}/>
        <button className="track-number" aria-label={`播放 ${track.title}`} onClick={() => void act(request('player.play', { tracks, index }))}><span>{current && data.player.status === 'playing' ? <span className="equalizer"><i/><i/><i/></span> : String(index + 1).padStart(2, '0')}</span><Play size={14} fill="currentColor"/></button>
        <div className="track-name"><Cover url={track.coverUrl} title={track.title} id={track.id} size="tiny"/><div><button className="text-link song-title" onClick={() => void act(request('player.play', { tracks, index }))}>{track.title}</button><div className="artist-line">{track.artists.map((artist, i) => <span key={`${artist.id}-${i}`}>{i > 0 && ' / '}<button className="text-link" onClick={() => navigate({ type: 'detail', provider: track.provider, kind: 'artist', id: artist.id })}>{artist.name}</button></span>)}</div></div></div>
        <button className="text-link album-column truncate" onClick={() => track.album.id && navigate({ type: 'detail', provider: track.provider, kind: 'album', id: track.album.id })}>{track.album.title}</button>
        <span className="track-duration">{time(track.durationMs / 1000)}</span>
        <div className="row-actions"><IconButton title={`将 ${track.title} 加入歌单`} onClick={()=>addToPlaylist(track)}><ListPlus size={16}/></IconButton><IconButton title={likedIds.has(trackKey(track)) ? `取消喜欢 ${track.title}` : `喜欢 ${track.title}`} active={likedIds.has(trackKey(track))} disabled={liking.has(trackKey(track))} onClick={() => void toggleLike(track)}><Heart size={16} fill={likedIds.has(trackKey(track)) ? 'currentColor' : 'none'}/></IconButton><IconButton title={`下载 ${track.title}`} onClick={() => download([track])}><ArrowDownToLine size={16}/></IconButton><IconButton title={`将 ${track.title} 加入队列`} onClick={() => void act(request('player.play', { tracks: [track], append: true }), '已加入播放队列')}><Plus size={16}/></IconButton></div>
      </div>
    })}</div>
  </div>
}
export function Pagination({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) { return total > limit ? <div className="pagination"><button className="button subtle" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}><ChevronLeft size={16}/>上一页</button><span>第 {Math.floor(offset / limit) + 1} 页 · 共 {Math.ceil(total / limit)} 页</span><button className="button subtle" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>下一页<ChevronRight size={16}/></button></div> : null }
export function QualitySelect({ value, onChange, label = '音质', disabled = false }: { value: Quality; onChange: (value: Quality) => void; label?: string; disabled?: boolean }) { return <select className="select" aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value as Quality)}>{Object.entries(QUALITIES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select> }
export function Modal({ title, subtitle, close, children, wide = false }: { title: string; subtitle?: string; close: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); close() }
      if (event.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]')
        if (!nodes?.length) return
        const first = nodes[0], last = nodes[nodes.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', listener, true)
    return () => { document.removeEventListener('keydown', listener, true); previous?.focus() }
  }, [])
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close() }}><div ref={ref} tabIndex={-1} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton title="关闭对话框" onClick={close}><X size={20}/></IconButton></div>{children}</div></div>
}
export function SuccessBadge({ children }: { children: ReactNode }) { return <span className="success-badge"><Check size={13}/>{children}</span> }
