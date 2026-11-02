import { trackKey } from '../../shared/platforms'
import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowRight, AudioLines, CalendarDays, Check, Disc3, FolderOpen, Heart, ListMusic, LoaderCircle, Music2, Play, Radio, RefreshCw, Search, Settings2, Sparkles, Waves, X } from 'lucide-react'
import type { CollectionKind, DownloadTask, HomeSection, LibraryKind, RadioSpec, SearchKind } from '../../shared/types'
import { SCENES } from '../../shared/types'
import { platformName, qualityName, request, useApp, useResource } from './state'
import { Busy, CollectionGrid, Cover, Empty, ErrorState, IconButton, LoginPrompt, PageHeading, Pagination, QualitySelect, TracksTable } from './components'

function HomeModule({ section, title, subtitle }: { section: HomeSection; title: string; subtitle: string }) {
  const { provider, session, data } = useApp()
  const resource = useResource(() => request('home.section', { provider,  section }), [section, session.user?.id])
  return <section className="home-module"><div className="section-heading"><div><h2>{title}</h2><span>{subtitle}</span></div><IconButton title={`刷新${title}`} onClick={resource.reload}><RefreshCw size={16}/></IconButton></div>{resource.loading ? <div className="collection-grid">{Array.from({ length: 5 }, (_, i) => <div className="card-skeleton" key={i}><div/><span/><span/></div>)}</div> : resource.error ? <ErrorState error={resource.error} retry={resource.reload}/> : resource.data?.collections.length ? <CollectionGrid collections={resource.data.collections}/> : <Empty title="暂时没有推荐内容"/>}</section>
}
export function HomePage() {
  const { provider, session, data, navigate } = useApp()
  const name = session.user?.nickname
  return <div className="home-page"><PageHeading eyebrow="YOUR DAILY SOUNDTRACK" title={name ? `${name}，今天想听点什么？` : '让生活，有声有色。'} description="熟悉的旋律，未知的惊喜。属于你的音乐时刻。"/>
    <div className="feature-grid"><button className="feature-card daily-feature" onClick={() => navigate({ type: 'daily' })}><div><span className="feature-tag"><CalendarDays size={14}/>每日推荐</span><h2>今天的好音乐，<br/>为你准备好了。</h2><p>每天更新 · 越听越懂你</p><span className="feature-link">开启今日歌单<ArrowRight size={16}/></span></div><div className="vinyl-scene" aria-hidden="true"><div className="vinyl-disc"><div className="vinyl-label"><AudioLines size={38}/></div></div><div className="vinyl-sleeve"><span>DAILY<br/>MIX</span><small>YOUR MUSIC, YOUR MOMENT.</small></div></div></button>
    <button className="feature-card radio-feature" onClick={() => navigate({ type: 'radio', fm: false })}><span className="feature-tag"><Sparkles size={14}/>音乐漫游</span><div className="radio-waves" aria-hidden="true">{Array.from({ length: 19 }, (_, i) => <i key={i} style={{ height: `${16 + Math.sin(i * 0.7) ** 2 * 66}px` }}/>)}</div><h2>跟着心情，<br/>听到下一站。</h2><p>探索 · 熟悉 · 场景</p><span className="feature-link">开始漫游<ArrowRight size={16}/></span></button></div>
    <HomeModule section="recommended" title="为你精选" subtitle="在喜欢的音乐里，遇见新的喜欢"/>
    <HomeModule section="charts" title="此刻正在流行" subtitle="听见大家的单曲循环"/>
    <HomeModule section="newAlbums" title="新专辑速递" subtitle="新鲜出炉，值得完整听一遍"/>
    <footer className="page-footer"><AudioLines size={14}/>好好生活，慢慢听歌。</footer>
  </div>
}
export function SearchPage({ query }: { query: string }) {
  const [kind, setKind] = useState<SearchKind>('song'), [offsets, setOffsets] = useState({ netease: 0, qq: 0 })
  const { provider, data } = useApp(), offset = offsets[provider]
  const visited = useRef(new Set([provider])); visited.current.add(provider)
  const netease = useResource(() => request('catalog.search', { provider: 'netease', keywords: query, kind, offset: offsets.netease }), [query, kind, offsets.netease], visited.current.has('netease') && data.settings.enabledProviders.includes('netease'), 'netease')
  const qq = useResource(() => request('catalog.search', { provider: 'qq', keywords: query, kind, offset: offsets.qq }), [query, kind, offsets.qq], visited.current.has('qq') && data.settings.enabledProviders.includes('qq'), 'qq')
  const resource = provider === 'qq' ? qq : netease
  const labels: Record<SearchKind, string> = { song: '歌曲', playlist: '歌单', album: '专辑', artist: '歌手' }
  return <><PageHeading eyebrow="FIND YOUR SOUND" title={`搜索「${query}」`} description={resource.data ? `找到 ${resource.data.total} 个相关结果` : '从一首歌，开始新的发现。'}/><div className="tabs" aria-label="搜索类型">{Object.entries(labels).map(([id, label]) => <button key={id} className={kind === id ? 'selected' : ''} onClick={() => { setKind(id as SearchKind); setOffsets({ netease: 0, qq: 0 }) }}>{label}</button>)}</div>{resource.loading ? <Busy label="正在搜索…"/> : resource.error ? <ErrorState error={resource.error} retry={resource.reload}/> : !resource.data?.total ? <Empty title="没有找到相关音乐" description="换一个关键词，试试歌名、歌手或专辑。"/> : <>{kind === 'song' ? <TracksTable tracks={resource.data.tracks} total={resource.data.total}/> : <CollectionGrid collections={resource.data.collections}/>}<Pagination offset={offset} limit={30} total={resource.data.total} onChange={offset => setOffsets(current => ({ ...current, [provider]: offset }))}/></>}</>
}
export function DetailPage({ kind, id }: { kind: CollectionKind; id: string }) {
  const { provider, session, data, libraryRevision, act, login, toast } = useApp()
  const [offset, setOffset] = useState(0), [subscribing, setSubscribing] = useState(false)
  const [pending,setPending]=useState(false),[artistTab,setArtistTab]=useState<'songs'|'albums'>('songs')
  useEffect(()=>setArtistTab('songs'),[kind,id])
  useEffect(()=>setPending(false),[kind,id,session.user?.id])
  const resource = useResource(() => request('catalog.detail', { provider,  kind, id, offset }), [kind, id, offset, session.user?.id, libraryRevision])
  if (resource.loading) return <Busy/>
  if (resource.error) return <ErrorState error={resource.error} retry={resource.reload}/>
  if (!resource.data) return null
  const { collection, tracks, total } = resource.data
  const subscribe = async () => {
    if (!session.user) { login(); return }
    if (kind === 'artist') return
    setSubscribing(true)
    try {
      const result=await request('library.subscribe', { provider, kind,id,subscribe:!collection.subscribed})
      setPending(!result.confirmed)
      toast(result.confirmed ? result.subscribed?'已收藏到我的音乐':'已取消收藏' : '收藏状态待确认，请刷新状态；不会自动重复提交。')
    } catch(error) { await act(Promise.reject(error)) } finally { setSubscribing(false) }
  }
  const refresh=async()=>{if(kind==='artist')return;setSubscribing(true);try{const result=await request('library.subscription', { provider, kind,id});setPending(!result.confirmed);resource.reload()}catch(error){await act(Promise.reject(error))}finally{setSubscribing(false)}}
  return <><div className="detail-hero"><Cover url={collection.coverUrl} title={collection.title} id={collection.id}/><div className="detail-info"><span className="kind-badge">{platformName(provider)} · {kind === 'playlist' ? '歌单' : kind === 'album' ? '专辑' : '歌手'}</span><h1>{collection.title}</h1><div className="detail-meta">{collection.creatorName && <span>{collection.creatorName}</span>}<span>{total} 首{kind === 'artist' ? '热门歌曲' : '歌曲'}</span></div><p>{collection.description || '把喜欢的声音，留在这里。'}</p>{kind !== 'artist' && !collection.owned && <button className={`button ${collection.subscribed ? 'subtle' : 'outline'}`} disabled={subscribing} onClick={() => void (pending?refresh():subscribe())}>{subscribing ? <LoaderCircle size={16} className="spin"/> : collection.subscribed ? <Check size={16}/> : <Heart size={16}/>} {pending?'状态待确认 · 刷新状态':collection.subscribed ? '已收藏' : kind === 'album' ? '收藏专辑' : '收藏歌单'}</button>}</div></div>{kind==='artist'&&<div className="tabs" aria-label="歌手作品"><button className={artistTab==='songs'?'selected':''} onClick={()=>setArtistTab('songs')}>热门歌曲</button><button className={artistTab==='albums'?'selected':''} onClick={()=>setArtistTab('albums')}>专辑</button></div>}{kind==='artist'&&artistTab==='albums'?<ArtistAlbums id={id}/>:<TracksTable tracks={tracks} total={total} getAll={() => request('catalog.allTracks', { provider,  kind, id })}/>} {kind === 'playlist' && <Pagination offset={offset} limit={100} total={total} onChange={setOffset}/>}</>
}
function ArtistAlbums({id}:{id:string}){
  const {provider} = useApp()
  const [offset,setOffset]=useState(0),resource=useResource(()=>request('catalog.artistAlbums', { provider, id,offset}),[id,offset])
  return <section aria-label="歌手专辑">{resource.loading?<Busy label="正在加载歌手专辑…"/>:resource.error?<ErrorState error={resource.error} retry={resource.reload}/>:<><CollectionGrid collections={resource.data?.albums||[]}/>{!resource.data?.albums.length&&<Empty title="这位歌手暂无专辑"/>}<div className="pagination"><button className="button subtle" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-30))}>上一页</button><span>第 {offset/30+1} 页</span><button className="button subtle" disabled={!resource.data?.more} onClick={()=>setOffset(offset+30)}>下一页</button></div></>}</section>
}
export function DailyPage() {
  const { provider, session, data } = useApp()
  const resource = useResource(() => request('home.section', { provider,  section: 'daily' }), [session.user?.id], !!session.user)
  return <><PageHeading eyebrow="MADE FOR YOU" title="每日推荐" description="每天为你挑选，让好音乐成为日常。" action={<span className="date-badge"><CalendarDays size={20}/>{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date())}</span>}/>{!session.user ? <LoginPrompt description={`登录后，听${platformName(provider)}为你准备的每日推荐。`}/> : resource.loading ? <Busy/> : resource.error ? <ErrorState error={resource.error} retry={resource.reload}/> : <TracksTable tracks={resource.data?.tracks || []}/>}</>
}
export function LibraryPage({ kind }: { kind: LibraryKind }) {
  const { provider, session, data, libraryRevision } = useApp()
  const [offset, setOffset] = useState(0)
  const resource = useResource(() => request('library.list', { provider,  kind, offset }), [kind, offset, libraryRevision, session.user?.id], !!session.user)
  const labels = { likes: ['我喜欢的音乐', '每一次心动，都值得收藏。'], playlists: ['我的歌单', '你的收藏与创建的歌单，都在这里。'], albums: ['收藏的专辑', '留一点时间，完整听一张专辑。'] }
  return <><PageHeading eyebrow="YOUR MUSIC LIBRARY" title={labels[kind][0]} description={labels[kind][1]} action={session.user && <button className="button subtle" onClick={resource.reload}><RefreshCw size={15}/>刷新</button>}/>{!session.user ? <LoginPrompt/> : resource.loading ? <Busy/> : resource.error ? <ErrorState error={resource.error} retry={resource.reload}/> : !resource.data?.total ? <Empty title="收藏夹还是空的" description="在搜索或推荐中收藏喜欢的音乐，它们就会出现在这里。"/> : <>{kind === 'likes' ? <TracksTable tracks={resource.data.tracks} total={resource.data.total}/> : <CollectionGrid collections={resource.data.collections}/>}<Pagination offset={offset} limit={50} total={resource.data.total} onChange={setOffset}/></>}</>
}
export function RadioPage({ fm }: { fm: boolean }) {
  const { provider, session, data, act, toggleLike, likedIds, login } = useApp()
  const [mode, setMode] = useState<RadioSpec['mode']>('EXPLORE'), [scene, setScene] = useState('FOCUS'), [busy, setBusy] = useState(false)
  const current = data.player.queue[data.player.index]
  const active = current?.provider === provider && !!data.player.radio && (fm ? data.player.radio.mode === 'FM' : data.player.radio.mode !== 'FM')
  const start = async () => { if (!session.user) { login(); return }; setBusy(true); await act(request('player.radio', fm ? { provider, mode: 'FM' } : { provider, mode, scene: mode === 'SCENE_RCMD' ? scene : undefined })); setBusy(false) }
  return <><PageHeading eyebrow={fm ? 'JUST FOR YOU' : 'GO WHERE MUSIC TAKES YOU'} title={fm ? '私人 FM' : '音乐漫游'} description={fm ? '不用选歌，让旋律自然发生。' : '熟悉、探索、随心情切换，听见新的可能。'}/><div className="radio-stage"><div className="radio-stage-orbit"/><div className="radio-art"><Cover url={active ? current?.coverUrl : undefined} title={active ? current?.title || '音乐漫游' : fm ? '私人 FM' : '音乐漫游'} id={active ? current?.id : 'roaming'}/>{active && data.player.status === 'playing' && <div className="playing-badge"><span className="equalizer"><i/><i/><i/></span>正在播放</div>}</div><div className="radio-content"><span className="eyebrow">{active ? 'NOW PLAYING' : 'A LITTLE SURPRISE'}</span><h2>{active ? current?.title : fm ? '下一首，就是惊喜。' : '今天，想去哪里？'}</h2><p>{active ? current?.artists.map(artist => artist.name).join(' / ') : '把选歌交给音乐，把时间留给自己。'}</p>{!fm && <><div className="mode-buttons">{([['DEFAULT', '随心听', Waves], ['FAMILIAR', '熟悉', Heart], ['EXPLORE', '探索', Sparkles], ['SCENE_RCMD', '场景', AudioLines]] as const).map(([id, label, Icon]) => <button className={mode === id ? 'selected' : ''} key={id} onClick={() => setMode(id)}><Icon size={16}/>{label}</button>)}</div>{mode === 'SCENE_RCMD' && <div className="scene-list">{Object.entries(SCENES).map(([id, label]) => <button className={scene === id ? 'selected' : ''} key={id} onClick={() => setScene(id)}>{label}</button>)}</div>}</>}<div className="radio-actions"><button className="button primary" disabled={busy} onClick={() => void start()}>{busy ? <LoaderCircle size={17} className="spin"/> : <Play size={17} fill="currentColor"/>}{active ? '重新开始' : fm ? '开始收听' : '开始漫游'}</button>{active && current && <><IconButton title={likedIds.has(trackKey(current)) ? '取消喜欢当前歌曲' : '喜欢当前歌曲'} active={likedIds.has(trackKey(current))} onClick={() => void toggleLike(current)}><Heart size={22} fill={likedIds.has(trackKey(current)) ? 'currentColor' : 'none'}/></IconButton><IconButton title="不感兴趣" onClick={() => void act(request('player.dislike'))}><X size={23}/></IconButton><button className="button subtle" onClick={() => void act(request('player.next'))}>下一首<ArrowRight size={17}/></button></>}</div></div></div><div className="info-note"><Radio size={16}/>{fm ? '根据你的听歌喜好持续推荐，喜欢与不感兴趣会同步到账号。' : `使用${platformName(provider)}提供的推荐流，支持连续播放。`}</div>{active && data.player.notice && <div className="info-note">{data.player.notice}</div>}</>
}
const statusNames: Record<DownloadTask['status'], string> = { queued: '等待下载', resolving: '获取音频', downloading: '正在下载', completed: '已完成', failed: '下载失败', cancelled: '已取消', interrupted: '已中断' }
const bytes = (value: number) => value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`
export function DownloadsPage() {
  const { provider, session, data, act, navigate } = useApp(), [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all')
  const list = data.downloads.filter(task => task.track.provider === provider).filter(task => filter === 'all' || (filter === 'completed' ? task.status === 'completed' : ['queued', 'resolving', 'downloading'].includes(task.status))).sort((a, b) => b.createdAt - a.createdAt)
  return <><PageHeading eyebrow="TAKE YOUR MUSIC WITH YOU" title="下载中心" description="喜欢的音乐，留一份在本地。" action={<button className="button subtle" onClick={() => navigate({ type: 'settings', section: 'downloads' })}><Settings2 size={16}/>下载设置</button>}/><div className="download-summary"><div><FolderOpen size={20}/><span className="truncate">{data.settings.downloadDirectory}</span></div><div><span className="muted">重试音质</span><QualitySelect label="重试下载音质" value={data.settings.downloadQuality} onChange={downloadQuality => void act(request('settings.update', { downloadQuality }))}/></div></div><div className="tabs">{([['all', '全部任务'], ['active', '进行中'], ['completed', '已完成']] as const).map(([id, label]) => <button key={id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div>{!session.user ? <LoginPrompt description="登录后可下载账号有权限保存的歌曲。"/> : !list.length ? <Empty title="还没有下载任务" description="在歌曲、歌单或专辑中点击下载，音乐就会来到这里。"/> : <div className="download-list">{list.map(task => <div className="download-row" key={task.id}><Cover url={task.track.coverUrl} title={task.track.title} size="tiny" id={task.track.id}/><div className="download-info"><strong>{task.track.title}</strong><span>{task.track.artists.map(artist => artist.name).join(' / ')} · {qualityName(task.actualQuality || task.quality)}</span>{task.status === 'downloading' && <div className="progress-line"><i style={{ width: task.total ? `${Math.min(100, task.received / task.total * 100)}%` : '20%' }}/></div>}{task.error && <p className="task-error">{task.error}</p>}</div><div className={`download-status status-${task.status}`}><span>{statusNames[task.status]}</span><small>{task.total ? `${bytes(task.received)} / ${bytes(task.total)}` : task.received ? bytes(task.received) : '—'}</small></div><div className="row-actions">{task.status === 'completed' ? <><IconButton title={`播放下载的 ${task.track.title}`} onClick={() => void act(request('downloads.play', { id: task.id }))}><Play size={18}/></IconButton><IconButton title={`打开 ${task.track.title} 所在目录`} onClick={() => void act(request('downloads.reveal', { id: task.id }))}><FolderOpen size={18}/></IconButton></> : ['queued', 'resolving', 'downloading'].includes(task.status) ? <IconButton title={`取消下载 ${task.track.title}`} onClick={() => void act(request('downloads.cancel', { id: task.id }))}><X size={18}/></IconButton> : <button className="button subtle" onClick={() => void act(request('downloads.retry', { id: task.id, quality: data.settings.downloadQuality }))}><RefreshCw size={14}/>重试</button>}</div></div>)}</div>}</>
}
