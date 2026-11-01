import {TitleBar} from './TitleBar'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDownToLine, AudioLines, CalendarDays, ChevronLeft, Compass, Disc3, Headphones, Heart, Home, Library, ListMusic, Radio, Search, Settings2, Sparkles, UserRound } from 'lucide-react'
import { AppProvider, accountKey, platformName, request, useApp, type Page } from './state'
import { sessionProvider } from '../../shared/platforms'
import { IconButton } from './components'
import { DailyPage, DetailPage, DownloadsPage, HomePage, LibraryPage, RadioPage, SearchPage } from './pages'
import { DownloadDialog, LoginDialog } from './dialogs'
import { SAFE_WALLPAPER_PALETTE, type WallpaperPalette } from '../../shared/wallpaper-palette'
import appIcon from '../../../resources/icon.png'
import { SettingsPage } from './Settings'
import { Background, NowPlayingPage, PeqDialog, AddToPlaylistDialog } from './Experience'
import { MiniPlayer } from './MiniPlayer'
import { PlaybackBar, PlaybackPanel } from './Playback'
import {AppearanceContext,useAppearance} from './appearance'

function SidebarItem({ icon, label, target, active }: { icon: ReactNode; label: string; target: Page; active: boolean }) { const { navigate } = useApp(); return <button className={`nav-item ${active ? 'selected' : ''}`} onClick={() => navigate(target)}>{icon}<span>{label}</span>{active && <i/>}</button> }
function Shell() {
  const [wallpaperColors,setWallpaperColors]=useState<WallpaperPalette>(SAFE_WALLPAPER_PALETTE)
  const { data, visualPreview, page, navigate, back, canBack, login, loginOpen, setLoginOpen, downloadTracks, toasts, act, setPanel, playlistTrack, peqOpen } = useApp()
  const [search, setSearch] = useState(''), searchInput = useRef<HTMLInputElement>(null), scroll = useRef<HTMLDivElement>(null)
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }) }, [page])
  useEffect(() => { setSearch('') }, [accountKey(data.session)])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.current?.focus(); return }
      if (element.closest('input, textarea, select, button, [role="dialog"]') || loginOpen || downloadTracks) return
      if (event.code === 'Space') { event.preventDefault(); void act(request('player.toggle')) }
      if (event.key === 'Escape') setPanel(null)
    }
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [loginOpen, downloadTracks, data.player.status])
  const user = data.session.user
  let content: ReactNode
  switch (page.type) {
    case 'home': content = <HomePage/>; break
    case 'search': content = <SearchPage query={page.query}/>; break
    case 'detail': content = <DetailPage kind={page.kind} id={page.id}/>; break
    case 'daily': content = <DailyPage/>; break
    case 'library': content = <LibraryPage kind={page.kind}/>; break
    case 'radio': content = <RadioPage fm={page.fm}/>; break
    case 'downloads': content = <DownloadsPage/>; break
    case 'settings': content = <SettingsPage initialSection={page.section}/>; break
    case 'nowPlaying': content = <NowPlayingPage/>; break
  }
  const wallpaperActive=data.settings.visualMode==='wallpaper'&&!!data.settings.wallpaper&&(data.settings.wallpaperScope==='app'||page.type==='nowPlaying')
  const appearance=useAppearance(data.settings,visualPreview,wallpaperColors,wallpaperActive)
  return <AppearanceContext.Provider value={{contrastRatio:appearance.contrastRatio}}><div style={appearance.style} data-wallpaper-ink={wallpaperColors.ink} className={`app-shell ${data.settings.backgroundColor?'custom-background':''} ${data.settings.autoWallpaperText?'wallpaper-auto':'wallpaper-theme'} ${data.settings.visualMode==='wallpaper' && data.settings.wallpaper && (data.settings.wallpaperScope==='app'||page.type==='nowPlaying')?'has-wallpaper':''}`}><TitleBar/><Background playerPage={page.type==='nowPlaying'} onPalette={setWallpaperColors}/><aside className="sidebar"><button className="brand" aria-label="Libitum music首页" onClick={() => navigate({ type: 'home' })}><img className="brand-mark app-icon" src={appIcon} alt=""/><span><strong>Libitum music</strong><small>LISTEN FREELY</small></span></button><div className="nav-section-label">探索音乐</div><nav><SidebarItem icon={<Compass size={20}/>} label="发现音乐" target={{ type: 'home' }} active={page.type === 'home'}/><SidebarItem icon={<CalendarDays size={19}/>} label="每日推荐" target={{ type: 'daily' }} active={page.type === 'daily'}/><SidebarItem icon={<Sparkles size={19}/>} label="音乐漫游" target={{ type: 'radio', fm: false }} active={page.type === 'radio' && !page.fm}/><SidebarItem icon={<Radio size={19}/>} label="私人 FM" target={{ type: 'radio', fm: true }} active={page.type === 'radio' && page.fm}/></nav><div className="nav-section-label library-label">我的音乐</div><nav><SidebarItem icon={<Heart size={19}/>} label="我喜欢的" target={{ type: 'library', kind: 'likes' }} active={page.type === 'library' && page.kind === 'likes'}/><SidebarItem icon={<ListMusic size={20}/>} label="我的歌单" target={{ type: 'library', kind: 'playlists' }} active={page.type === 'library' && page.kind === 'playlists'}/><SidebarItem icon={<Disc3 size={19}/>} label="收藏专辑" target={{ type: 'library', kind: 'albums' }} active={page.type === 'library' && page.kind === 'albums'}/><SidebarItem icon={<ArrowDownToLine size={19}/>} label="下载中心" target={{ type: 'downloads' }} active={page.type === 'downloads'}/></nav><div className="sidebar-bottom"><div className="sidebar-tip"><Headphones size={22} strokeWidth={1.5}/><span>给生活一点<br/><strong>好听的陪伴。</strong></span></div><SidebarItem icon={<Settings2 size={19}/>} label="设置" target={{ type: 'settings' }} active={page.type === 'settings'}/><button className="account-card" onClick={user ? () => navigate({ type: 'settings', section: 'account' }) : login}><span className="avatar">{user?.avatarUrl ? <img src={user.avatarUrl} alt="账号头像" referrerPolicy="no-referrer"/> : <UserRound size={20}/>}</span><span><strong>{user?.nickname || '登录音乐账号'}</strong><small>{user ? platformName(sessionProvider(data.session)) : '同步你的专属音乐库'}</small></span><ChevronLeft size={15} className="chevron-forward"/></button></div></aside><div className="main-shell"><header className="topbar"><IconButton title="返回上一页" disabled={!canBack} onClick={back}><ChevronLeft size={22}/></IconButton><form className="search-box" onSubmit={event => { event.preventDefault(); if (search.trim()) navigate({ type: 'search', query: search.trim() }) }}><Search size={17}/><input ref={searchInput} aria-label="搜索音乐" placeholder="搜索歌曲、歌手、专辑、歌单" value={search} maxLength={200} onChange={event => setSearch(event.target.value)}/><kbd>Ctrl K</kbd></form><div className="topbar-right"><span className="topbar-note"><span/>听见，每一个好时刻</span><button className="header-avatar" title={user ? '账号设置' : '登录'} onClick={user ? () => navigate({ type: 'settings', section: 'account' }) : login}>{user?.avatarUrl ? <img src={user.avatarUrl} alt="个人头像" referrerPolicy="no-referrer"/> : <UserRound size={18}/>}</button></div></header><div ref={scroll} className={`content-scroll ${page.type==='nowPlaying'?'listening-scroll':''}`}
><main className="page-content" key={`${accountKey(data.session)}:${JSON.stringify(page)}`}>{content}</main></div></div><PlaybackBar/><PlaybackPanel/>{playlistTrack && <AddToPlaylistDialog/>}{peqOpen && <PeqDialog/>}{loginOpen && <LoginDialog/>}{downloadTracks && <DownloadDialog/>}<div className="toast-stack" role="status" aria-live="polite">{toasts.map(toast => <div className="toast" key={toast.id}><AudioLines size={17}/>{toast.message}</div>)}</div></div></AppearanceContext.Provider>
}
export default function App() { if(location.hash==='#mini')return <MiniPlayer/>; return <AppProvider><Shell/></AppProvider> }
