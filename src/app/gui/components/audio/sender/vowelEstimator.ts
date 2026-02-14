/**
 * LPC -> formant(F1,F2) -> vowel推定
 * 無音時は -1 を返し、利用側で "xn"（口閉じ）へ変換する。
 */
export class VowelEstimator {
  public LPC_ORDER = 64;
  public samplingRate = 44100;
  public bufferSize = 1024;

  public th_volume = 0.00001;
  public th_volume_above = 0.0001;
  public th_volume_under = 0.000001;

  public VOWEL_WINDOW = 20;
  public pre_behavior: string = "n";
  public th_isSpeaking = 0.15;

  private vowelhist: number[] = [];
  private lockingBehavior = false;
  private timer_isSpeaking: number | null = null;

  private onVowel: (v: string) => void = () => {};
  private onSpeakStatus: (s: "start" | "stop") => void = () => {};

  constructor() {
    this.vowelhist = new Array(this.VOWEL_WINDOW);
    this.vowelhist.fill(0);
  }

  public setSampleRate(sr: number) {
    this.samplingRate = sr;
  }

  public setCallbacks(
    onVowel: (v: string) => void,
    onSpeakStatus: (s: "start" | "stop") => void,
  ) {
    this.onVowel = onVowel;
    this.onSpeakStatus = onSpeakStatus;
  }

  public analyzeData(buffer: Float32Array) {
    const df = this.samplingRate / this.bufferSize;
    const vol = volume(buffer);

    let v: number;

    if (vol < this.th_volume) {
      v = -1;
      this.th_volume_under = this.th_volume_under * 0.99 + vol * 0.01;
      this.th_volume =
        this.th_volume_under * 0.85 + this.th_volume_above * 0.15;
    } else {
      const f = this.extract_formant(buffer, df);
      v = vowel(f[0], f[1]);
      this.th_volume_above = this.th_volume_above * 0.99 + vol * 0.01;
      this.th_volume =
        this.th_volume_under * 0.85 + this.th_volume_above * 0.15;
    }

    this.vowelhist.shift();
    if (v >= 0) this.vowelhist.push(v);
    else this.vowelhist.push(-1);

    const count = this.vowelhist.filter((x) => x >= 0).length;
    const ave = count / this.vowelhist.length;

    let current = "n";

    if (ave > this.th_isSpeaking) {
      current = getVowelLabel(v);

      if (!this.timer_isSpeaking) {
        this.onSpeakStatus("start");
      }

      if (this.timer_isSpeaking) {
        clearTimeout(this.timer_isSpeaking);
        this.timer_isSpeaking = null;
      }

      this.timer_isSpeaking = window.setTimeout(() => {
        this.onSpeakStatus("stop");
        this.timer_isSpeaking = null;
        this.onVowel("N");
      }, 1500);

      if (this.pre_behavior !== current && !this.lockingBehavior) {
        this.onVowel(current);
        this.lockingBehavior = true;
        this.pre_behavior = current;
        window.setTimeout(() => (this.lockingBehavior = false), 200);
      }
    }
  }

  private hamming(data: Float32Array) {
    const ret = data.map((d, index) => {
      return (
        d * (0.54 - 0.46 * Math.cos((2 * Math.PI * index) / (data.length - 1)))
      );
    });
    ret[0] = 0;
    ret[data.length - 1] = 0;
    return ret;
  }

  private extract_formant(data: Float32Array, df: number) {
    const hammingResult = normalize(this.hamming(data));
    const lpcResult = normalize(lpc(hammingResult, this.LPC_ORDER, df));
    return formant(lpcResult, df);
  }
}

function volume(buffer: Float32Array) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = buffer[i];
    sum += v * v;
  }
  return sum / buffer.length;
}

function normalize(data: Float32Array) {
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > max) max = a;
  }
  if (max === 0) return data;
  return data.map((d) => d / max);
}

function expi(theta: number): [number, number] {
  return [Math.cos(theta), Math.sin(theta)];
}
function iadd(a: [number, number], b: [number, number]): [number, number] {
  return [a[0] + b[0], a[1] + b[1]];
}
function isub(a: [number, number], b: [number, number]): [number, number] {
  return [a[0] - b[0], a[1] - b[1]];
}
function imul(a: [number, number], b: [number, number]): [number, number] {
  return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
}

function fft(reals: Float32Array) {
  const n = reals.length;
  const xs: [number, number][] = new Array(n);
  for (let i = 0; i < n; i++) xs[i] = [reals[i], 0];

  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tmp = xs[i];
      xs[i] = xs[j];
      xs[j] = tmp;
    }
    let m = n >> 1;
    while (j >= m && m >= 2) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const w = expi(ang * k);
        const u = xs[i + k];
        const t = imul(xs[i + k + len / 2], w);
        xs[i + k] = iadd(u, t);
        xs[i + k + len / 2] = isub(u, t);
      }
    }
  }
  return xs;
}

function autocorr(x: Float32Array, lag: number) {
  let sum = 0;
  for (let i = 0; i < x.length - lag; i++) sum += x[i] * x[i + lag];
  return sum;
}

function levinsonDurbin(r: number[], order: number) {
  const a: number[] = new Array(order + 1).fill(0);
  const e: number[] = new Array(order + 1).fill(0);
  const k: number[] = new Array(order + 1).fill(0);

  a[0] = 1;
  e[0] = r[0];

  for (let i = 1; i <= order; i++) {
    let acc = 0;
    for (let j = 1; j < i; j++) {
      acc += a[j] * r[i - j];
    }
    k[i] = (r[i] - acc) / (e[i - 1] || 1e-12);

    a[i] = k[i];
    for (let j = 1; j < i; j++) {
      a[j] = a[j] - k[i] * a[i - j];
    }
    e[i] = (1 - k[i] * k[i]) * e[i - 1];
  }
  return a;
}

function lpc(data: Float32Array, order: number, _df: number) {
  const r: number[] = [];
  for (let i = 0; i <= order; i++) {
    r.push(autocorr(data, i));
  }

  const a = levinsonDurbin(r, order);

  const coeff = new Float32Array(data.length);
  coeff[0] = 1;
  for (let i = 1; i <= order && i < coeff.length; i++) {
    coeff[i] = a[i];
  }

  const x = fft(coeff);
  const spec = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const [re, im] = x[i];
    const mag = Math.sqrt(re * re + im * im);
    spec[i] = mag === 0 ? 0 : 1 / mag;
  }
  return spec;
}

function formant(spec: Float32Array, df: number) {
  const peaks: number[] = [];
  for (let i = 1; i < spec.length - 1; i++) {
    if (spec[i] > spec[i - 1] && spec[i] > spec[i + 1]) peaks.push(i);
  }

  peaks.sort((a, b) => spec[b] - spec[a]);

  const freqs: number[] = [];
  for (let i = 0; i < peaks.length && freqs.length < 5; i++) {
    const f = peaks[i] * df;
    if (f > 150 && f < 5000) freqs.push(f);
  }
  freqs.sort((a, b) => a - b);

  const f1 = freqs[0] ?? 0;
  const f2 = freqs[1] ?? 0;
  return [f1, f2];
}

function vowel(f1: number, f2: number) {
  const frameF1F2 = [
    [
      [1200, 2000],
      [1800, 2800],
    ],
    [
      [400, 1000],
      [3000, 6000],
    ],
    [
      [200, 600],
      [1000, 3200],
    ],
    [
      [800, 1200],
      [2000, 4800],
    ],
    [
      [500, 1500],
      [900, 2000],
    ],
  ];

  const cluster = [0, 0, 0, 0, 0];
  const xm = [750, 300, 350, 520, 480];
  const ym = [1180, 2200, 1100, 1900, 900];

  for (let i = 0; i < 5; i++) {
    if (
      f1 > frameF1F2[i][0][0] &&
      f1 < frameF1F2[i][0][1] &&
      f2 > frameF1F2[i][1][0] &&
      f2 < frameF1F2[i][1][1]
    ) {
      cluster[i] = 1;
    }
  }

  let distance = 99999;
  let ans = -1;
  for (let i = 0; i < 5; i++) {
    if (cluster[i] === 1) {
      const d = Math.sqrt(
        (f1 - xm[i]) * (f1 - xm[i]) + (f2 - ym[i]) * (f2 - ym[i]),
      );
      if (d < distance) {
        distance = d;
        ans = i;
      }
    }
  }
  return ans;
}

function getVowelLabel(v: number) {
  let out = "n";
  if (v === 0) out = "a";
  if (v === 1) out = "i";
  if (v === 2) out = "u";
  if (v === 3) out = "e";
  if (v === 4) out = "o";
  return out;
}
