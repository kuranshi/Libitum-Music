import { describe, expect, it } from 'vitest'
import { defaultPeq } from '../../src/shared/peq'
import { peqResponse } from '../../src/shared/peq-response'

describe('EQ response preview', () => {
  it('includes preamp, total bypass and individual band bypass', () => {
    const preset = defaultPeq(), frequencies = [20, 1000, 20000]
    preset.preamp = -5
    preset.bands[0] = { enabled: true, type: 'PK', frequency: 1000, gain: 6, q: 1 }
    expect(peqResponse(preset, frequencies)).toEqual([0, 0, 0])
    preset.enabled = true
    expect(peqResponse(preset, [1000])[0]).toBeCloseTo(1, 6)
    preset.bands[0].enabled = false
    expect(peqResponse(preset, frequencies)).toEqual([-5, -5, -5])
  })
  it('sums overlapping filters in dB and makes high Q narrower', () => {
    const preset = defaultPeq(); preset.enabled = true
    preset.bands[0] = { enabled: true, type: 'PK', frequency: 1000, gain: 6, q: 1 }
    const wide = peqResponse(preset, [1000, 1500])
    preset.bands[0].q = 10
    const narrow = peqResponse(preset, [1000, 1500])
    expect(wide[0]).toBeCloseTo(6, 6); expect(narrow[0]).toBeCloseTo(6, 6)
    expect(narrow[1]).toBeLessThan(wide[1] / 4)
    preset.bands[1] = { ...preset.bands[0] }
    expect(peqResponse(preset, [1000])[0]).toBeCloseTo(12, 6)
  })
  it('models shelf endpoints and half gain at their cutoff', () => {
    for (const type of ['LS', 'HS'] as const) {
      const preset = defaultPeq(); preset.enabled = true
      preset.bands[0] = { enabled: true, type, frequency: 1000, gain: -12, q: 0.7 }
      const [low, cutoff, high] = peqResponse(preset, [0, 1000, 24000])
      expect(low).toBeCloseTo(type === 'LS' ? -12 : 0, 6)
      expect(high).toBeCloseTo(type === 'HS' ? -12 : 0, 6)
      expect(cutoff).toBeCloseTo(-6, 6)
    }
  })
  it('matches playback omission above Nyquist and rejects invalid data', () => {
    const preset = defaultPeq(); preset.enabled = true
    preset.bands[0] = { enabled: true, type: 'PK', frequency: 16000, gain: 6, q: 1 }
    expect(peqResponse(preset, [1000, 10000], 24000)).toEqual([0, 0])
    expect(() => peqResponse({ ...preset, preamp: NaN }, [1000])).toThrow()
    expect(() => peqResponse(preset, [NaN])).toThrow()
    expect(() => peqResponse(preset, [25000])).toThrow()
    expect(() => peqResponse(preset, [1000], 0)).toThrow()
  })
  it('remains finite at the supported parameter extremes', () => {
    const preset = defaultPeq(); preset.enabled = true
    const frequencies = [0, 20, 31, 1000, 16000, 20000, 24000]
    for (const type of ['PK', 'LS', 'HS'] as const) for (const q of [0.1, 20]) for (const frequency of [20, 20000]) for (const gain of [-24, 24]) {
      preset.bands[0] = { enabled: true, type, frequency, gain, q }
      expect(peqResponse(preset, frequencies).every(Number.isFinite)).toBe(true)
    }
  })
})
