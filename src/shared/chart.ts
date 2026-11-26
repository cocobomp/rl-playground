// Graphique en canvas (aucune dépendance) : une ou plusieurs séries + moyenne glissante.
import { prepareCanvas } from './ui';

export interface ChartColors {
  raw: string;
  avg: string;
  axis: string;
  text: string;
}

export interface ChartOptions {
  /** Fenêtre de la moyenne glissante (défaut 20, 0 = pas de moyenne). */
  window?: number;
  /** Légende de l'axe horizontal (défaut « épisode »). */
  xLabel?: string;
  /** Message quand il n'y a pas encore de données. */
  emptyText?: string;
  /** Afficher les points bruts (défaut true). */
  showRaw?: boolean;
  /** Séries supplémentaires tracées en ligne simple (ex. comparaison). */
  extra?: Array<{ values: number[]; color: string; label?: string; dashed?: boolean }>;
}

export function movingAverage(values: number[], window: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out.push(sum / Math.min(i + 1, window));
  }
  return out;
}

export function drawChart(canvas: HTMLCanvasElement, values: number[], colors: ChartColors, opts: ChartOptions = {}): void {
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const win = opts.window ?? 20;
  const extra = opts.extra ?? [];
  const pad = { l: 44, r: 10, t: 10, b: 24 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = colors.text;

  const all = values.concat(...extra.map((e) => e.values));
  if (all.length === 0) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.emptyText ?? 'Lancez l’apprentissage pour voir la courbe', w / 2, h / 2);
    return;
  }

  let min = 0, max = 0;
  for (const v of all) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max - min < 1e-9) {
    max += 1;
    min -= 1;
  }
  const n = Math.max(values.length, ...extra.map((e) => e.values.length));
  const x = (i: number) => pad.l + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * ph;

  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t + ph);
  ctx.lineTo(pad.l + pw, pad.t + ph);
  ctx.stroke();

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [max, 0, min]) ctx.fillText(formatNum(v), pad.l - 6, y(v));
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(pad.l, y(0));
  ctx.lineTo(pad.l + pw, y(0));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('1', pad.l, pad.t + ph + 6);
  ctx.textAlign = 'right';
  ctx.fillText(`${opts.xLabel ?? 'épisode'} ${n}`, pad.l + pw, pad.t + ph + 6);

  if (opts.showRaw !== false) {
    ctx.fillStyle = colors.raw;
    const r = values.length > 300 ? 1.2 : 2;
    for (let i = 0; i < values.length; i++) {
      ctx.beginPath();
      ctx.arc(x(i), y(values[i]), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const line = (vals: number[], color: string, width: number, dashed = false) => {
    if (vals.length === 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dashed ? [5, 4] : []);
    ctx.beginPath();
    vals.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line(win > 0 ? movingAverage(values, win) : values, colors.avg, 2);
  for (const e of extra) line(e.values, e.color, 2, e.dashed);
}

function formatNum(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}
