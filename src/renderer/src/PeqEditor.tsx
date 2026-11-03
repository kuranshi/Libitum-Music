import { useEffect, useId, useMemo, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { defaultPeq, validPeq } from '../../shared/peq'
import { peqResponse } from '../../shared/peq-response'
import type { PeqBand, PeqSettings } from '../../shared/types'
import { PeqGraph, formatFrequency, formatGain } from './PeqGraph'
import { request, useApp } from './state'

const RESPONSE_FREQUENCIES = Array.from({ length: 401 }, (_, i) => 20 * 1000 ** (i / 400))

export function PeqEditor() {
  const { data } = useApp()
  const id = useId(), saved = JSON.stringify(data.settings.peq)
  const [draft, setDraft] = useState<PeqSettings>(() => structuredClone(data.settings.peq))
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [imported, setImported] = useState(false)
  const [selected, setSelected] = useState(0)
  useEffect(() => { setDraft(JSON.parse(saved)); setImported(false) }, [saved])
  const change = (index: number, patch: Partial<PeqBand>) => setDraft(d => ({ ...d, bands: d.bands.map((b, i) => i === index ? { ...b, ...patch } : b) }))
  const valid = validPeq(draft), band = draft.bands[selected]
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings.peq)
  const peak = useMemo(() => valid ? Math.max(...peqResponse({ ...draft, enabled: true }, [...RESPONSE_FREQUENCIES, ...draft.bands.map(b => b.frequency)])) : 0, [draft, valid])
  const apply = async () => {
    setBusy(true); setError('')
    try { await request('peq.apply', draft); setImported(false) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  const read = async () => {
    setBusy(true); setError('')
    try { const preset = await request('peq.import'); if (preset) { setDraft(preset); setImported(true); setSelected(0) } }
    catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  return <div className="peq-editor">
    <fieldset className="peq-controls" disabled={busy}>
      <div className="peq-top"><label className="toggle-label"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })}/>启用十段 PEQ</label><span className={`peq-save-state ${dirty ? 'is-dirty' : ''}`} role="status">{dirty ? '有未应用的修改' : draft.enabled ? '已应用' : '已旁路'}</span></div>
      <PeqGraph settings={draft} selected={selected} onSelect={setSelected} onChange={change} disabled={busy}/>
      <div className="peq-band-tabs" role="group" aria-label="选择 EQ 频段">{draft.bands.map((b, index) => <button type="button" key={index} className={`${selected === index ? 'selected' : ''} ${b.enabled ? '' : 'is-disabled'}`} aria-label={`选择第 ${index + 1} 段`} aria-pressed={selected === index} onClick={() => setSelected(index)}><span>{index + 1}</span><strong>{formatFrequency(b.frequency)}</strong></button>)}</div>
      <div className="peq-band-panel" role="group" aria-label={`第 ${selected + 1} 段参数`}>
        <div className="peq-band-heading"><strong>频段 {selected + 1}</strong><label><input type="checkbox" aria-label="启用选中频段" checked={band.enabled} onChange={e => change(selected, { enabled: e.target.checked })}/>启用此段</label><select className="select" aria-label="选中频段类型" value={band.type} onChange={e => change(selected, { type: e.target.value as PeqBand['type'] })}><option value="PK">峰值</option><option value="LS">低架</option><option value="HS">高架</option></select></div>
        <div className="peq-band-controls">
          <label>频率 <span><input className="input" aria-label="选中频段频率" type="number" min="20" max="20000" value={band.frequency} onChange={e => change(selected, { frequency: Number(e.target.value) })}/> Hz</span></label>
          <label>增益 <output>{formatGain(band.gain)} dB</output><input type="range" aria-label="选中频段增益" min="-24" max="24" step="0.1" value={band.gain} onChange={e => change(selected, { gain: Number(e.target.value) })}/></label>
          <label>Q 值 <output>{band.q.toFixed(2)}</output><input type="range" aria-label="选中频段 Q" min="0.1" max="20" step="0.01" value={band.q} onChange={e => change(selected, { q: Number(e.target.value) })}/></label>
        </div>
      </div>
      <div className="peq-preamp"><label htmlFor={`${id}-preamp`}>前级增益</label><input id={`${id}-preamp`} aria-label="前级增益滑杆" type="range" min="-30" max="12" step="0.1" value={draft.preamp} onChange={e => setDraft({ ...draft, preamp: Number(e.target.value) })}/><input className="input numeric" aria-label="PEQ 前级增益" type="number" min="-30" max="12" step="0.1" value={draft.preamp} onChange={e => setDraft({ ...draft, preamp: Number(e.target.value) })}/><span>dB</span></div>
      <details className="peq-advanced"><summary>精确参数 · 全部十段</summary><div className="peq-table"><div className="peq-row peq-heading"><span>启用</span><span>类型</span><span>频率 Hz</span><span>增益 dB</span><span>Q</span></div>{draft.bands.map((b, index) => <div className="peq-row" key={index}><label><input type="checkbox" aria-label={`启用第 ${index + 1} 段`} checked={b.enabled} onChange={e => change(index, { enabled: e.target.checked })}/><span>{index + 1}</span></label><select className="select" aria-label={`第 ${index + 1} 段类型`} value={b.type} onChange={e => change(index, { type: e.target.value as PeqBand['type'] })}><option value="PK">峰值</option><option value="LS">低架</option><option value="HS">高架</option></select><input className="input" aria-label={`第 ${index + 1} 段频率`} type="number" min="20" max="20000" value={b.frequency} onChange={e => change(index, { frequency: Number(e.target.value) })}/><input className="input" aria-label={`第 ${index + 1} 段增益`} type="number" min="-24" max="24" step="0.1" value={b.gain} onChange={e => change(index, { gain: Number(e.target.value) })}/><input className="input" aria-label={`第 ${index + 1} 段 Q`} type="number" min="0.1" max="20" step="0.01" value={b.q} onChange={e => change(index, { q: Number(e.target.value) })}/></div>)}</div></details>
      {peak > 0.1 && <p className="peq-headroom">叠加频响最高约 +{peak.toFixed(1)} dB，建议降低前级以留出余量。</p>}
      {!valid && <p className="inline-error" role="alert">参数超出范围：频率 20–20000 Hz，增益 ±24 dB，Q 0.1–20，前级 -30–12 dB。</p>}
      <p className="muted small-text peq-apply-hint">修改后点击应用，无需重新播放。{imported && <span>已载入预览，尚未应用到播放。</span>}</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <div className="editor-actions"><button className="button subtle" onClick={() => void read()}>导入 TXT</button><button className="button subtle" onClick={() => { setDraft(defaultPeq()); setImported(false); setSelected(0); setError('') }}>重置预览</button><button className="button primary" disabled={!valid} onClick={() => void apply()}>{busy ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>}应用 PEQ</button></div>
    </fieldset>
  </div>
}
