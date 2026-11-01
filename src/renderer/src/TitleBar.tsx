import {useEffect,useState} from 'react'
import {Copy,Maximize2,Minus,X} from 'lucide-react'
import type {WindowState} from '../../shared/types'
import {request,useApp} from './state'

export function TitleBar(){
  const {act}=useApp(),[state,setState]=useState<WindowState>({maximized:false,minimized:false,focused:true}),[busy,setBusy]=useState(false)
  useEffect(()=>{
    let live=true,received=false
    const off=window.music.onEvent(event=>{if(event.type==='window'){received=true;setState(event.data)}})
    void request('window.state').then(value=>{if(live&&!received)setState(value)}).catch(error=>{if(live)void act(Promise.reject(error))})
    return()=>{live=false;off()}
  },[])
  const run=async(command:'window.minimize'|'window.toggleMaximize'|'window.close')=>{
    setBusy(true);try{await act(request(command))}finally{setBusy(false)}
  }
  return <header className={`app-titlebar ${state.focused?'':'is-inactive'}`} aria-label="窗口标题栏">
    <span className="window-title"><strong>Libitum music</strong><span> · 听见生活</span></span>
    <div className="window-controls">
      <button className="window-button" aria-label="最小化窗口" title="最小化" disabled={busy} onClick={()=>void run('window.minimize')}><Minus size={15}/></button>
      <button className="window-button" aria-label={state.maximized?'还原窗口':'最大化窗口'} title={state.maximized?'还原':'最大化'} disabled={busy} onClick={()=>void run('window.toggleMaximize')}>{state.maximized?<Copy size={13}/>:<Maximize2 size={13}/>}</button>
      <button className="window-button window-close" aria-label="关闭窗口" title="关闭窗口" disabled={busy} onClick={()=>void run('window.close')}><X size={16}/></button>
    </div>
  </header>
}
