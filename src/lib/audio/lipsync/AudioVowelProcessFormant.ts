export type SpeakAction = 'start' | 'stop'
export type VowelLabelLower = 'a' | 'i' | 'u' | 'e' | 'o' | 'n'
export type VowelLabel = VowelLabelLower | 'N'

type SampleBuffer = Float32Array | number[]

export default class AudioVowelProcessFormant {
  public LPC_ORDER = 64
  public samplingRate = 44100
  public bufferSize = 1024

  public th_volume = 0.00001
  public th_volume_above = 0.0001
  public th_volume_under = 0.000001

  public VOWEL_WINDOW = 20
  public pre_behavior: VowelLabelLower = 'n'
  public th_isSpeaking = 0.15

  public vowelhist: number[] = []
  public lockingBehavior = false

  public vowelresult: (v: VowelLabel) => void = console.log
  public actionstart: (a: SpeakAction) => void = console.log

  public timer_isSpeaking: ReturnType<typeof setTimeout> | null = null

  constructor(
    opts?: Partial<Pick<AudioVowelProcessFormant, 'LPC_ORDER' | 'samplingRate' | 'bufferSize' | 'VOWEL_WINDOW'>>
  ) {
    if (opts?.LPC_ORDER != null) {
      this.LPC_ORDER = opts.LPC_ORDER
    }
    if (opts?.samplingRate != null) {
      this.samplingRate = opts.samplingRate
    }
    if (opts?.bufferSize != null) {
      this.bufferSize = opts.bufferSize
    }
    if (opts?.VOWEL_WINDOW != null) {
      this.VOWEL_WINDOW = opts.VOWEL_WINDOW
    }

    this.vowelhist = new Array(this.VOWEL_WINDOW).fill(0)
  }

  public get_vowel = (vowelresult: (v: VowelLabel) => void): void => {
    this.vowelresult = vowelresult
  }

  public get_speak_status = (actionstart: (a: SpeakAction) => void): void => {
    this.actionstart = actionstart
  }

  public analyzeData = (buffer: SampleBuffer): void => {
    const df = this.samplingRate / this.bufferSize

    const vol = volume(buffer)
    let v: number

    if (vol < this.th_volume) {
      v = -1
      this.th_volume_under = this.th_volume_under * 0.99 + vol * 0.01
      this.th_volume = this.th_volume_under * 0.85 + this.th_volume_above * 0.15
    } else {
      const f = this.extract_formant(buffer, df)
      v = vowel(f[0], f[1])

      this.th_volume_above = this.th_volume_above * 0.99 + vol * 0.01
      this.th_volume = this.th_volume_under * 0.85 + this.th_volume_above * 0.15
    }

    this.vowelhist.shift()
    this.vowelhist.push(v >= 0 ? v : -1)

    const count = this.vowelhist.filter(x => x >= 0).length
    const ave = count / this.vowelhist.length

    if (ave > this.th_isSpeaking) {
      const _v: VowelLabelLower = getVowelLabel(v)

      // 発話開始
      if (!this.timer_isSpeaking) {
        this.actionstart('start')
      }

      // 発話停止タイマ更新
      if (this.timer_isSpeaking) {
        clearTimeout(this.timer_isSpeaking)
        this.timer_isSpeaking = null
      }
      this.timer_isSpeaking = setTimeout(() => {
        this.actionstart('stop')
        this.timer_isSpeaking = null
        this.vowelresult('N')
      }, 1500)

      // 口形の変化（過剰に変わり続けないよう200msロック）
      if (this.pre_behavior !== _v && !this.lockingBehavior) {
        this.vowelresult(_v)
        this.lockingBehavior = true
        this.pre_behavior = _v
        setTimeout(() => (this.lockingBehavior = false), 200)
      }
    }
  }

  private hamming = (data: SampleBuffer): number[] => {
    const N = data.length
    const ret = new Array<number>(N)

    for (let i = 0; i < N; i++) {
      const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (N - 1))
      ret[i] = data[i] * w
    }

    ret[0] = 0
    ret[N - 1] = 0
    return ret
  }

  private extract_formant = (data: SampleBuffer, df: number): [number, number] => {
    const hamming_result = normalize(this.hamming(data))
    const lpc_result = normalize(lpc(hamming_result, this.LPC_ORDER, df))
    return formant(lpc_result, df)
  }
}

/* =========================
 *  FFT / Formant helpers
 * ========================= */

type Complex = [number, number]

function expi(theta: number): Complex {
  return [Math.cos(theta), Math.sin(theta)]
}
function iadd([ax, ay]: Complex, [bx, by]: Complex): Complex {
  return [ax + bx, ay + by]
}
function isub([ax, ay]: Complex, [bx, by]: Complex): Complex {
  return [ax - bx, ay - by]
}
function imul([ax, ay]: Complex, [bx, by]: Complex): Complex {
  return [ax * bx - ay * by, ax * by + ay * bx]
}

function revBit(k: number, n: number): number {
  let r = 0
  for (let i = 0; i < k; i++) {
    r = (r << 1) | ((n >>> i) & 1)
  }
  return r
}

function fftin1(c: Complex[], T: number, N: number): Complex[] {
  const k = Math.log2(N)
  const rec: Complex[] = c.map((_, i) => c[revBit(k, i)])

  for (let Nh = 1; Nh < N; Nh *= 2) {
    T /= 2
    for (let s = 0; s < N; s += Nh * 2) {
      for (let i = 0; i < Nh; i++) {
        const l = rec[s + i]
        const re = imul(rec[s + i + Nh], expi(T * i))
        rec[s + i] = iadd(l, re)
        rec[s + i + Nh] = isub(l, re)
      }
    }
  }
  return rec
}

function fft1(f: Complex[]): Complex[] {
  const N = f.length
  const T = -2 * Math.PI
  return fftin1(f, T, N)
}

function volume(data: SampleBuffer): number {
  let v = 0.0
  const N = data.length
  for (let i = 0; i < N; i++) {
    const x = data[i]
    v += (x * x) / N
  }
  return v
}

function freqz(b: number[], a: number[], df: number, N: number): number[] {
  const size_a = a.length
  const size_b = b.length
  const s = 2

  const la: number[] = []
  const lb: number[] = []
  for (let i = 0; i < s * N; i++) {
    la.push(i >= size_a ? 0 : a[i])
    lb.push(i >= size_b ? 0 : b[i])
  }

  const fft_a = fft1(la.map(r => [r, 0] as Complex))
  const fft_b = fft1(lb.map(r => [r, 0] as Complex))

  const fft_a1 = fft_a.map(([re, im]) => Math.sqrt(re * re + im * im))
  const fft_b1 = fft_b.map(([re, im]) => Math.sqrt(re * re + im * im))

  const h: number[] = []
  for (let i = 0; i < N; i++) {
    h.push(fft_b1[i] / fft_a1[i])
  }
  return h
}

function normalize(data: number[]): number[] {
  let maxAbs = 0
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i])
    if (a > maxAbs) {
      maxAbs = a
    }
  }
  if (maxAbs === 0) {
    return data.map(() => 0)
  }
  return data.map(d => d / maxAbs)
}

function lpc(data: number[], order: number, df: number): number[] {
  const N = data.length

  const lags_num = order + 1
  const r = new Array<number>(lags_num).fill(0)

  for (let l = 0; l < lags_num; ++l) {
    let sum = 0
    for (let n = 0; n < N - l; ++n) {
      sum += data[n] * data[n + l]
    }
    r[l] = sum
  }

  const a = new Array<number>(order + 1).fill(0)
  const e = new Array<number>(order + 1).fill(0)

  a[0] = 1.0
  e[0] = 1.0

  a[1] = -r[1] / r[0]
  e[1] = r[0] + r[1] * a[1]

  for (let k = 1; k < order; ++k) {
    let lambda = 0.0
    for (let j = 0; j < k + 1; ++j) {
      lambda -= a[j] * r[k + 1 - j]
    }
    lambda /= e[k]

    const U = new Array<number>(k + 2)
    const V = new Array<number>(k + 2)

    U[0] = 1.0
    V[0] = 0.0

    for (let i = 1; i < k + 1; ++i) {
      U[i] = a[i]
      V[k + 1 - i] = a[i]
    }
    U[k + 1] = 0.0
    V[k + 1] = 1.0

    for (let i = 0; i < k + 2; ++i) {
      a[i] = U[i] + lambda * V[i]
    }

    e[k + 1] = e[k] * (1.0 - lambda * lambda)
  }

  return freqz(e, a, df, N)
}

function formant(data: number[], df: number): [number, number] {
  let f1 = 0.0
  let f2 = 0.0
  let is_find_first = false

  for (let i = 1; i < data.length - 1; ++i) {
    if (data[i] > data[i - 1] && data[i] > data[i + 1]) {
      if (!is_find_first) {
        f1 = df * i
        is_find_first = true
      } else {
        f2 = df * i
        break
      }
    }
  }
  return [f1, f2]
}

function vowel(f1: number, f2: number): number {
  const frame_f1_f2: [[[number, number], [number, number]], ...Array<[[number, number], [number, number]]>] = [
    [
      [1200, 2000],
      [1800, 2800]
    ],
    [
      [400, 1000],
      [3000, 6000]
    ],
    [
      [200, 600],
      [1000, 3200]
    ],
    [
      [800, 1200],
      [2000, 4800]
    ],
    [
      [500, 1500],
      [900, 2000]
    ]
  ]

  const claster = [0, 0, 0, 0, 0]
  const xm = [750, 300, 350, 520, 480]
  const ym = [1180, 2200, 1100, 1900, 900]

  for (let i = 0; i < 5; i++) {
    if (
      f1 > frame_f1_f2[i][0][0] &&
      f1 < frame_f1_f2[i][0][1] &&
      f2 > frame_f1_f2[i][1][0] &&
      f2 < frame_f1_f2[i][1][1]
    ) {
      claster[i] = 1
    }
  }

  let distance = Number.POSITIVE_INFINITY
  let ans = -1

  for (let i = 0; i < 5; i++) {
    if (claster[i] === 1) {
      const d = Math.sqrt((f1 - xm[i]) * (f1 - xm[i]) + (f2 - ym[i]) * (f2 - ym[i]))
      if (d < distance) {
        distance = d
        ans = i
      }
    }
  }
  return ans
}

function getVowelLabel(v: number): VowelLabelLower {
  let _v: VowelLabelLower = 'n'
  if (v === 0) {
    _v = 'a'
  }
  if (v === 1) {
    _v = 'i'
  }
  if (v === 2) {
    _v = 'u'
  }
  if (v === 3) {
    _v = 'e'
  }
  if (v === 4) {
    _v = 'o'
  }
  return _v
}
