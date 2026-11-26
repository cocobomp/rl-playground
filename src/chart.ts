// Petit graphique en canvas (aucune dépendance) : récompense par épisode + moyenne glissante.

export interface ChartColors {
  raw: string;
  avg: string;
  axis: string;
  text: string;
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

export function drawChart(canvas: HTMLCanvasElement, values: number[], colors: ChartColors): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pad = { l: 44, r: 10, t: 10, b: 24 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = colors.text;

  if (values.length === 0) {
    ctx.textAlign = 'center';
    ctx.fillText('Lancez l’apprentissage pour voir la courbe', w / 2, h / 2);
    return;
  }

  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (max - min < 1e-9) {
    max += 1;
    min -= 1;
  }
  const n = values.length;
  const x = (i: number) => pad.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * ph;

  // Axes et graduations
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t + ph);
  ctx.lineTo(pad.l + pw, pad.t + ph);
  ctx.stroke();

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [max, 0, min]) {
    ctx.fillText(formatNum(v), pad.l - 6, y(v));
  }
  // Ligne zéro
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(pad.l, y(0));
  ctx.lineTo(pad.l + pw, y(0));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('1', pad.l, pad.t + ph + 6);
  ctx.fillText(`épisode ${n}`, pad.l + pw - 30, pad.t + ph + 6);

  // Points bruts
  ctx.fillStyle = colors.raw;
  const r = n > 300 ? 1.2 : 2;
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(x(i), y(values[i]), r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Moyenne glissante
  const avg = movingAverage(values, 20);
  ctx.strokeStyle = colors.avg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  avg.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
  ctx.stroke();
}

function formatNum(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}
