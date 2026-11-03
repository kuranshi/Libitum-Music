import { trackKey } from '../../shared/platforms'
import {WallpaperBackground} from './WallpaperBackground'
import { useEffect, useRef, useState } from 'react'
import { Heart, ListPlus, LoaderCircle, MessageCircle, SlidersHorizontal, Waves, Palette, X } from 'lucide-react'
import { type WallpaperPalette } from '../../shared/wallpaper-palette'
import type { SpectrumFrame } from '../../shared/types'
import { PeqEditor } from './PeqEditor'
export { PeqEditor } from './PeqEditor'
import { Busy, Cover, Empty, ErrorState, IconButton, Modal, Pagination } from './components'
import { BlurControls } from './VisualControls'
import {SynchronizedLyrics} from './SynchronizedLyrics'
import { request, useApp, useResource } from './state'

export function Background({playerPage=false,onPalette}:{playerPage?:boolean;onPalette:(palette:WallpaperPalette)=>void}) {
  const { provider, session, data } = useApp(),settings=data.settings
  const active=settings.visualMode==='wallpaper'&&!!settings.wallpaper&&(settings.wallpaperScope==='app'||playerPage)
  return <WallpaperBackground settings={settings} status={data.player.status} active={active} onPalette={onPalette}/>
}
export function PeqDialog(){const { provider, session, setPeqOpen } = useApp();return <Modal title="十段参数均衡器" subtitle="音效只影响播放，不会修改下载文件。" close={()=>setPeqOpen(false)} wide><PeqEditor/></Modal>}
export function AddToPlaylistDialog(){
  const { provider, session, data,playlistTrack,setPlaylistTrack,toast,act } = useApp(),[offset,setOffset]=useState(0),[query,setQuery]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState('')
  const resource=useResource(()=>request('library.writablePlaylists', { provider, offset}),[session.user?.id,offset])
  const add=async(id:string)=>{setBusy(id);setError('');try{const result=await request('library.addToPlaylist', { provider, id,trackId:playlistTrack!.id});toast(result.alreadyPresent?'这首歌已在该歌单中。':'已加入歌单。');setPlaylistTrack(null)}catch(e){setError((e as Error).message)}finally{setBusy('')}}
  return <Modal title="加入歌单" subtitle={playlistTrack?.title} close={()=>{if(!busy)setPlaylistTrack(null)}}><input className="input" aria-label="筛选我的歌单" placeholder="筛选本页歌单" value={query} onChange={e=>setQuery(e.target.value)}/>{error&&<p className="inline-error">{error}</p>}{resource.loading?<Busy/>:resource.error?<ErrorState error={resource.error} retry={resource.reload}/>:<><div className="playlist-picker">{resource.data?.collections.filter(p=>p.title.toLowerCase().includes(query.toLowerCase())).map(p=><button className="playlist-choice" key={p.id} disabled={!!busy} onClick={()=>void add(p.id)}><Cover url={p.coverUrl} id={p.id} title={p.title} size="tiny"/><span><strong>{p.title}</strong><small>{p.trackCount} 首</small></span>{busy===p.id?<LoaderCircle size={18} className="spin"/>:<ListPlus size={18}/>}</button>)}{!resource.data?.collections.length&&<Empty title="本页没有可编辑歌单" description="可在对应平台创建歌单，或继续查看下一页。"/>}</div><div className="pagination"><button className="button subtle" disabled={!offset||!!busy} onClick={()=>setOffset(Math.max(0,offset-50))}>上一页</button><button className="button subtle" disabled={!resource.data?.more||!!busy} onClick={()=>setOffset(offset+50)}>下一页</button></div></>}</Modal>
}
function Comments({id}:{id:string}){
  const {provider} = useApp()
  const [offset,setOffset]=useState(0),resource=useResource(()=>request('catalog.comments', { provider, id,offset}),[id,offset])
  if(resource.loading)return <Busy label="正在加载评论…"/>
  if(resource.error)return <ErrorState error={resource.error} retry={resource.reload}/>
  const comment=(c:NonNullable<typeof resource.data>['items'][number])=><article className="music-comment" key={c.id}><div className="comment-author"><span>{c.author}</span><time>{new Date(c.time).toLocaleDateString('zh-CN')}</time><small>♡ {c.likes}</small></div><p>{c.content}</p>{c.replies.map((r,i)=><blockquote key={i}>{r.author}：{r.content}</blockquote>)}</article>
  return <section className="comments-content">{!!resource.data?.hot.length&&<><h3>精彩评论</h3>{resource.data.hot.map(comment)}</>}<h3>最新评论 <small>{resource.data?.total||0}</small></h3>{resource.data?.items.length?resource.data.items.map(comment):<Empty title="暂时还没有评论"/>}<Pagination offset={offset} limit={20} total={resource.data?.total||0} onChange={setOffset}/></section>
}
export function SpectrumView(){
  const { provider, session, data } = useApp(),[frame,setFrame]=useState<SpectrumFrame>({status:'idle',bins:[]}),canvas=useRef<HTMLCanvasElement>(null),current=useRef(frame)
  useEffect(()=>{current.current=frame},[frame])
  useEffect(()=>{
    if(!data.settings.spectrum.enabled)return
    const off=window.music.onEvent(event=>{if(event.type==='spectrum')setFrame(event.data)})
    const visibility=()=>void request('spectrum.subscribe',{active:!document.hidden}).catch(()=>{})
    visibility(); document.addEventListener('visibilitychange',visibility)
    return()=>{off();document.removeEventListener('visibilitychange',visibility);void request('spectrum.subscribe',{active:false}).catch(()=>{})}
  },[data.settings.spectrum.enabled])
  useEffect(()=>{
    if(!data.settings.spectrum.enabled || data.player.status!=='playing' || frame.status!=='active'){const node=canvas.current;node?.getContext('2d')?.clearRect(0,0,node.width,node.height);return}
    let animation=0,values=Array(64).fill(0)
    const draw=()=>{
      const node=canvas.current,context=node?.getContext('2d')
      if(node&&context&&!document.hidden){
        const rect=node.getBoundingClientRect(),ratio=window.devicePixelRatio||1
        if(node.width!==Math.round(rect.width*ratio)||node.height!==Math.round(rect.height*ratio)){node.width=Math.round(rect.width*ratio);node.height=Math.round(rect.height*ratio)}
        context.clearRect(0,0,node.width,node.height)
        const colors=data.settings.spectrum,gradient=context.createLinearGradient(0,node.height,node.width,0);gradient.addColorStop(0,colors.color);gradient.addColorStop(1,colors.gradient?colors.secondaryColor:colors.color);context.fillStyle=gradient
        const width=node.width/64
        for(let i=0;i<64;i++){values[i]+=(current.current.status==='active'?(current.current.bins[i]||0)-values[i]:-values[i])*0.35; const height=Math.max(1,values[i]*node.height);context.fillRect(i*width,node.height-height,Math.max(1,width*0.65),height)}
      }
      if(!document.hidden) animation=requestAnimationFrame(draw)
    }
    const visibility=()=>{cancelAnimationFrame(animation);if(!document.hidden)animation=requestAnimationFrame(draw)}
    visibility();document.addEventListener('visibilitychange',visibility);return()=>{cancelAnimationFrame(animation);document.removeEventListener('visibilitychange',visibility)}
  },[data.settings.spectrum,data.player.status,frame.status])
  if(!data.settings.spectrum.enabled)return null
  return <div className="spectrum-view"><canvas ref={canvas} aria-label="实时音乐频谱"/>{frame.status==='unavailable'&&<p className="muted small-text">{frame.reason}</p>}</div>
}
export function NowPlayingPage(){
  const { provider, session, data,act,likedIds,liking,toggleLike,addToPlaylist,setPeqOpen,navigate } = useApp(),track=data.player.queue[data.player.index]
  const [commentsOpen,setCommentsOpen]=useState(false),[visualOpen,setVisualOpen]=useState(false),[lyricsOpen,setLyricsOpen]=useState(false)
  const commentButton=useRef<HTMLButtonElement>(null),visualButton=useRef<HTMLButtonElement>(null)
  const layout=useRef<HTMLDivElement>(null),stage=useRef<HTMLElement>(null),[stageHeight,setStageHeight]=useState(400)
  useEffect(()=>{
    if(!lyricsOpen)return
    const frame=requestAnimationFrame(()=>{const node=stage.current;if(node)node.scrollTo({top:node.scrollHeight,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})})
    return()=>cancelAnimationFrame(frame)
  },[lyricsOpen])
  useEffect(()=>{
    const node=layout.current;if(!node)return
    const observer=new ResizeObserver(()=>setStageHeight(node.clientHeight));observer.observe(node)
    return()=>observer.disconnect()
  },[!!track])
  const opened=commentsOpen&&data.settings.commentsEnabled
  const closeComments=()=>{setCommentsOpen(false);commentButton.current?.focus()}
  useEffect(()=>{if(!data.settings.commentsEnabled)setCommentsOpen(false)},[data.settings.commentsEnabled])
  useEffect(()=>{
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape'||document.querySelector('[aria-modal="true"]'))return
      if(visualOpen){setVisualOpen(false);visualButton.current?.focus();event.stopPropagation()}
      else if(opened){closeComments();event.stopPropagation()}
    }
    document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape)
  },[opened,visualOpen])
  if(!track)return <Empty title="先播放一首音乐吧"/>
  return <div className="now-playing-page">
    <div className="immersive-heading"><span className="eyebrow">NOW PLAYING</span><div className="row-actions">
      {data.settings.commentsEnabled&&<button ref={commentButton} type="button" className={`button subtle comment-toggle ${opened?'active':''}`} aria-label="评论" aria-controls="song-comments-panel" aria-expanded={opened} onClick={()=>setCommentsOpen(!opened)}><MessageCircle size={17}/>评论</button>}
      <button ref={visualButton} type="button" className={`button subtle ${visualOpen?'active':''}`} aria-label="视觉设置" aria-expanded={visualOpen} aria-controls="player-visual-settings" onClick={()=>setVisualOpen(!visualOpen)}><Palette size={17}/>视觉</button>
      <IconButton title="十段 PEQ" onClick={()=>setPeqOpen(true)} active={data.settings.peq.enabled}><SlidersHorizontal size={20}/></IconButton>
      <IconButton title="切换实时频谱" active={data.settings.spectrum.enabled} onClick={()=>void act(request('settings.update',{spectrum:{...data.settings.spectrum,enabled:!data.settings.spectrum.enabled}}))}><Waves size={20}/></IconButton>
    </div></div>
    {visualOpen&&<section className="visual-popover" id="player-visual-settings" aria-label="播放视觉设置"><header><h2>视觉设置</h2><IconButton title="关闭视觉设置" onClick={()=>{setVisualOpen(false);visualButton.current?.focus()}}><X size={18}/></IconButton></header><BlurControls/></section>}
    <div ref={layout} className={`listening-layout ${opened?'with-comments':''}`} style={{'--stage-height':`${stageHeight}px`} as React.CSSProperties}>
      <section ref={stage} className={`listening-stage ${lyricsOpen?'lyrics-open':''} ${data.settings.spectrum.enabled?'has-spectrum':''}`} aria-label="歌曲封面与信息" tabIndex={0}><div className="listening-stage-content">
        <div className="cover-stage"><div className={`album-disc ${data.settings.rotateCover?'rotating':''} ${data.player.status==='playing'?'is-playing':''}`}><Cover url={track.coverUrl} title={track.title} id={track.id}/></div></div>
        <div className="listening-meta"><h1>{track.title}</h1><p className="muted">{track.artists.map((artist,i)=><span key={`${artist.id}-${i}`}>{i>0&&' / '}{/^[a-zA-Z0-9_-]{1,128}$/.test(artist.id)?<button className="text-link" aria-label={`查看歌手 ${artist.name}`} onClick={()=>navigate({type:'detail',provider:track.provider,kind:'artist',id:artist.id})}>{artist.name}</button>:artist.name}</span>)} · {track.album.title}</p>
          <div className="listening-actions"><button className="button subtle" disabled={liking.has(trackKey(track))} onClick={()=>void toggleLike(track)}><Heart size={16} fill={likedIds.has(trackKey(track))?'currentColor':'none'}/>{likedIds.has(trackKey(track))?'已喜欢':'喜欢'}</button><button className="button subtle" onClick={()=>addToPlaylist(track)}><ListPlus size={17}/>加入歌单</button><button className="button subtle" aria-expanded={lyricsOpen} aria-controls="listening-lyrics" onClick={()=>setLyricsOpen(!lyricsOpen)}>歌词</button></div>
        </div>
        <SpectrumView/>
        {lyricsOpen&&<div className="plain-lyrics" id="listening-lyrics" aria-label="歌曲歌词"><SynchronizedLyrics key={`${track.provider}:${track.id}`} trackId={track.id}/></div>}
      </div>
      </section>
      <aside className={`song-comments ${opened?'is-open':''}`} id="song-comments-panel" aria-label="歌曲评论" aria-hidden={!opened} inert={!opened}>
        <header className="comments-heading"><h2><MessageCircle size={19}/>听友的声音</h2><IconButton title="关闭评论" onClick={closeComments}><X size={19}/></IconButton></header>
        <div className="comments-scroll" key={track.id} tabIndex={opened?0:-1}>{opened&&<Comments key={`${track.provider}:${track.id}`} id={track.id}/>}</div>
      </aside>
    </div>
  </div>
}
