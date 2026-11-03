import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { peqResponse } from '../../shared/peq-response'
import { validPeq } from '../../shared/peq'
import type { PeqBand, PeqSettings } from '../../shared/types'

const WIDTH = 720, HEIGHT = 280, LEFT = 48, RIGHT = 24, TOP = 20, BOTTOM = 36
const PLOT_WIDTH = WIDTH - LEFT - RIGHT, PLOT_HEIGHT = HEIGHT - TOP - BOTTOM
const FREQUENCIES = Array.from({ length: 401 }, (_, i) => 20 * 1000 ** (i / 400))
const TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const frequencyX = (frequency: number) => LEFT + Math.log10(clamp(frequency, 20, 20000) / 20) / 3 * PLOT_WIDTH
export const formatFrequency = (frequency: number) => frequency >= 1000 ? `${Number((frequency / 1000).toFixed(2))}k` : `${Math.round(frequency)}`
export const formatGain = (gain: number) => `${gain > 0 ? '+' : ''}${gain.toFixed(1)}`

export function PeqGraph({ settings, selected, onSelect, onChange, disabled }: {
  settings: PeqSettings; selected: number; onSelect: (index: number) => void
  onChange: (index: number, patch: Partial<PeqBand>) => void; disabled: boolean
}) {
  const id = useId(), svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ index: number; pointer: number; limit: number } | null>(null)
  const [dragLimit, setDragLimit] = useState<number | null>(null)
  const valid = validPeq(settings)
  const response = useMemo(() => valid ? peqResponse({ ...settings, enabled: true }, FREQUENCIES) : [], [settings, valid])
  const bandResponse = useMemo(() => valid ? peqResponse({ ...settings, enabled: true, preamp: 0, bands: settings.bands.map((b, i) => ({ ...b, enabled: b.enabled && i === selected })) }, FREQUENCIES) : [], [settings, selected, valid])
  const limit = dragLimit ?? Math.max(24, Math.ceil(Math.max(...response.map(Math.abs), Math.abs(settings.preamp) || 0) / 12) * 12)
  const gainY = (gain: number) => TOP + (limit - clamp(gain, -limit, limit)) / (2 * limit) * PLOT_HEIGHT
  const path = (values: number[]) => values.map((gain, i) => `${i ? 'L' : 'M'}${frequencyX(FREQUENCIES[i]).toFixed(2)},${gainY(gain).toFixed(2)}`).join(' ')
  const totalPath = path(response), baseline = gainY(0)
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current, matrix = svg.current?.getScreenCTM()
    if (!current || event.pointerId !== current.pointer || !matrix || disabled) return
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    onChange(current.index, {
      frequency: Math.round(20 * 1000 ** clamp((point.x - LEFT) / PLOT_WIDTH, 0, 1)),
      gain: Math.round(clamp(current.limit * (1 - 2 * (point.y - TOP) / PLOT_HEIGHT), -24, 24) * 10) / 10
    })
  }
  const finish = (event: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointer !== event.pointerId) return
    drag.current = null; setDragLimit(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const key = (event: KeyboardEvent<SVGGElement>, index: number) => {
    const band = settings.bands[index], step = event.shiftKey ? 1 : 0.1
    let patch: Partial<PeqBand>
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') patch = { gain: Math.round(clamp(band.gain + (event.key === 'ArrowUp' ? step : -step), -24, 24) * 10) / 10 }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') patch = { frequency: Math.round(clamp(band.frequency * 2 ** ((event.key === 'ArrowRight' ? 1 : -1) / (event.shiftKey ? 3 : 24)), 20, 20000)) }
    else if (event.key === 'Home') patch = { gain: 0 }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(index); return }
    else return
    event.preventDefault(); if (!disabled) onChange(index, patch)
  }
  return <div className={`peq-graph ${settings.enabled ? '' : 'is-bypassed'}`}>
    <div className="peq-graph-heading"><strong>频响预览</strong><span>{settings.enabled ? '含前级增益' : '总开关已关闭 · 仅预览'}</span></div>
    <svg ref={svg} className="peq-plot" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label="EQ 频响图" aria-describedby={`${id}-help`} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      <defs><clipPath id={`${id}-clip`}><rect x={LEFT} y={TOP} width={PLOT_WIDTH} height={PLOT_HEIGHT}/></clipPath></defs>
      <g className="peq-grid" aria-hidden="true">
        {TICKS.map(f => <g key={f}><line x1={frequencyX(f)} x2={frequencyX(f)} y1={TOP} y2={HEIGHT - BOTTOM}/><text x={frequencyX(f)} y={HEIGHT - 12} textAnchor="middle">{formatFrequency(f)}</text></g>)}
        {[-limit, -limit / 2, 0, limit / 2, limit].map(g => <g key={g}><line className={g === 0 ? 'peq-zero' : ''} x1={LEFT} x2={WIDTH - RIGHT} y1={gainY(g)} y2={gainY(g)}/><text x={LEFT - 10} y={gainY(g) + 4} textAnchor="end">{g > 0 ? '+' : ''}{g}</text></g>)}
        <text x={LEFT - 10} y={TOP - 7} textAnchor="end">dB</text>
      </g>
      <g clipPath={`url(#${id}-clip)`} aria-hidden="true">
        {response.length > 0 && <><path className="peq-area" d={`${totalPath} L${WIDTH - RIGHT},${baseline} L${LEFT},${baseline} Z`}/><path className="peq-band-curve" d={path(bandResponse)}/><path className="peq-total-curve" d={totalPath}/></>}
        <line className="peq-guide" x1={frequencyX(settings.bands[selected].frequency)} x2={frequencyX(settings.bands[selected].frequency)} y1={TOP} y2={HEIGHT - BOTTOM}/>
      </g>
      {/* Draw the selected handle last, so coincident bands remain selectable. */}
      {[...settings.bands.keys()].filter(i => i !== selected).concat(selected).map(index => {
        const band = settings.bands[index]
        return <g key={index} className={`peq-node ${index === selected ? 'selected' : ''} ${band.enabled ? '' : 'is-disabled'}`} transform={`translate(${frequencyX(band.frequency)},${gainY(band.gain)})`} tabIndex={disabled ? -1 : 0} role="button" aria-label={`第 ${index + 1} 段控制点`} aria-pressed={index === selected} aria-disabled={disabled} aria-description={`${band.frequency} Hz，${formatGain(band.gain)} dB，${band.enabled ? '启用' : '旁路'}`} onFocus={() => onSelect(index)} onKeyDown={e => key(e, index)} onClick={() => onSelect(index)} onDoubleClick={() => { if (!disabled) onChange(index, { gain: 0 }) }} onPointerDown={e => {
          if (disabled || e.button !== 0 || !e.isPrimary) return
          e.preventDefault(); e.currentTarget.focus(); onSelect(index)
          drag.current = { index, pointer: e.pointerId, limit }; setDragLimit(limit)
          svg.current?.setPointerCapture(e.pointerId)
        }}>
          <title>{`第 ${index + 1} 段 · ${band.frequency} Hz · ${formatGain(band.gain)} dB${band.enabled ? '' : ' · 旁路'}`}</title>
          <circle className="peq-node-hit" r="17"/><circle className="peq-node-disc" r="11"/><text textAnchor="middle" dy=".35em" aria-hidden="true">{index + 1}</text>
        </g>
      })}
    </svg>
    <p id={`${id}-help`} className="peq-graph-help">拖动圆点调整频率和增益，双击归零。方向键微调，Shift 加快。</p>
    <p className="peq-graph-note">按 48 kHz 估算；圆点表示各段参数，实线表示叠加频响。</p>
  </div>
}
