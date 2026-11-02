import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import {lyricGroups,lyricIndex} from '../../shared/lyrics'
import {Busy,Empty,ErrorState} from './components'
import {request,useApp,useResource} from './state'

export function SynchronizedLyrics({trackId}:{trackId:string}){
  const { provider, session, data,act } = useApp(),resource=useResource(()=>request('catalog.lyrics', { provider, id:trackId}),[trackId])
  const groups=useMemo(()=>lyricGroups(resource.data?.original||'',resource.data?.translated||''),[resource.data])
  const current=lyricIndex(groups,data.player.position),scroll=useRef<HTMLDivElement>(null),active=useRef<HTMLButtonElement>(null)
  const [browsing,setBrowsing]=useState(false),manual=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null)
  const position=useRef(data.player.position),latestAlign=useRef<(smooth?:boolean)=>void>(()=>{})
  const clear=()=>{if(timer.current)clearTimeout(timer.current);timer.current=null}
  const align=(smooth=true)=>{
    const node=scroll.current,line=active.current
    if(node)node.style.setProperty('--lyrics-viewport',`${node.clientHeight}px`)
    if(!node||!line||document.hidden||manual.current)return
    const top=line.getBoundingClientRect().top-node.getBoundingClientRect().top+node.scrollTop-(node.clientHeight-line.offsetHeight)/2
    node.scrollTo({top:Math.max(0,top),behavior:smooth&&!matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'auto'})
  }
  latestAlign.current=align
  const resume=()=>{clear();manual.current=false;setBrowsing(false);latestAlign.current()}
  const browse=()=>{clear();manual.current=true;setBrowsing(true);timer.current=setTimeout(resume,5000)}
  useLayoutEffect(()=>{if(!manual.current)align()},[current,groups,browsing])
  useEffect(()=>{
    // A seek in either window may arrive without this renderer initiating it.
    if(Math.abs(data.player.position-position.current)>1.5)resume()
    position.current=data.player.position
  },[data.player.position])
  useEffect(()=>{
    const seek=()=>resume(),visible=()=>{if(!document.hidden)latestAlign.current(false)}
    const observer=new ResizeObserver(()=>latestAlign.current(false));if(scroll.current)observer.observe(scroll.current)
    window.addEventListener('music:seek',seek);document.addEventListener('visibilitychange',visible)
    return()=>{clear();observer.disconnect();window.removeEventListener('music:seek',seek);document.removeEventListener('visibilitychange',visible)}
  },[])
  const plain=resource.data?.original.replace(/\[[^\]]*\]/g,'').trim()
  return <div className="synchronized-lyrics">
    <div className="lyrics-heading"><span>{groups.length?(browsing?'正在浏览歌词':'跟随播放'):'歌曲歌词'}</span>{!!groups.length&&<button className="text-link" onClick={resume}>回到当前歌词</button>}</div>
    <div ref={scroll} className="lyrics-scroll" tabIndex={0} aria-label="同步歌词列表" onWheel={browse} onTouchStart={browse} onPointerDown={e=>{if(e.target===e.currentTarget)browse()}} onScroll={()=>{if(manual.current)browse()}} onKeyDown={e=>{if(['PageUp','PageDown','Home','End','ArrowUp','ArrowDown'].includes(e.key))browse()}}>
      {resource.loading?<Busy label="正在寻找歌词…"/>:resource.error?<ErrorState error={resource.error} retry={resource.reload}/>:groups.length?<div className="lyrics-lines">{groups.map((line,index)=><button className={`lyric-line ${index===current?'current':''}`} ref={index===current?active:null} key={`${line.time}-${index}`} aria-current={index===current?'true':undefined} onClick={()=>{resume();void act(request('player.seek',{seconds:line.time}))}}><span>{line.text||'♪'}</span>{line.translation&&<small>{line.translation}</small>}</button>)}</div>:plain?<div className="untimed-lyrics"><p className="small-text">无同步时间轴</p><pre>{plain}</pre></div>:<Empty title="暂无歌词" description="此刻，让旋律说话。"/>}
    </div>
  </div>
}
