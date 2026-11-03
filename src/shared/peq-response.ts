import { validPeq } from './peq'
import type { PeqBand, PeqSettings } from './types'

type Coefficients = { a: number[]; b: number[] }

// Biquad transfer functions matching the Q-width filters used by peqGraph.
// FFmpeg bass/treble use sqrt(2*A)*alpha; lowshelf/highshelf use 2*sqrt(A)*alpha.
// Reference: https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/af_biquads.c
function coefficients(band: PeqBand, sampleRate: number): Coefficients {
  const amplitude = 10 ** (band.gain / 40)
  const omega = 2 * Math.PI * band.frequency / sampleRate
  const cosine = Math.cos(omega), alpha = Math.sin(omega) / (2 * band.q)
  if (band.type === 'PK') return {
    a: [1 + alpha / amplitude, -2 * cosine, 1 - alpha / amplitude],
    b: [1 + alpha * amplitude, -2 * cosine, 1 - alpha * amplitude]
  }
  const plus = amplitude + 1, minus = amplitude - 1, slope = Math.sqrt(2 * amplitude) * alpha
  if (band.type === 'LS') return {
    a: [plus + minus * cosine + slope, -2 * (minus + plus * cosine), plus + minus * cosine - slope],
    b: [amplitude * (plus - minus * cosine + slope), 2 * amplitude * (minus - plus * cosine), amplitude * (plus - minus * cosine - slope)]
  }
  return {
    a: [plus - minus * cosine + slope, 2 * (minus - plus * cosine), plus - minus * cosine - slope],
    b: [amplitude * (plus + minus * cosine + slope), -2 * amplitude * (minus + plus * cosine), amplitude * (plus + minus * cosine - slope)]
  }
}

/** Combined response in dB, including preamp and bypass, at the supplied frequencies. */
export function peqResponse(settings: PeqSettings, frequencies: number[], sampleRate = 48000): number[] {
  if (!validPeq(settings) || !Number.isFinite(sampleRate) || sampleRate <= 0 || frequencies.some(f => !Number.isFinite(f) || f < 0 || f > sampleRate / 2)) throw new Error('频响参数无效。')
  if (!settings.enabled) return frequencies.map(() => 0)
  const filters = settings.bands.filter(b => b.enabled && b.gain && b.frequency < sampleRate / 2).map(b => coefficients(b, sampleRate))
  return frequencies.map(frequency => {
    const omega = 2 * Math.PI * frequency / sampleRate
    const cosine = Math.cos(omega), sine = Math.sin(omega), cosine2 = Math.cos(2 * omega), sine2 = Math.sin(2 * omega)
    const power = (c: number[]) => (c[0] + c[1] * cosine + c[2] * cosine2) ** 2 + (c[1] * sine + c[2] * sine2) ** 2
    return settings.preamp + filters.reduce((gain, { a, b }) => gain + 10 * Math.log10(Math.max(1e-30, power(b)) / Math.max(1e-30, power(a))), 0)
  })
}
