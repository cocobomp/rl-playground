// Dessins en canvas propres au bandit : courbes de croyance (lois Beta) et repère de changement.
import { prepareCanvas, ThemeColors } from '../../shared/ui';
import { betaPdf } from './bandit';

export interface BetaCurve {
  a: number;
  b: number;
  color: string;
  dashed: boolean;
  label: string;
  /** Vraie probabilité (affichée si non nulle). */
  truth: number | null;
}

const PAD = { l: 12, r: 12, t: 14, b: 22 };
const SAMPLES = 240;

export function drawBeta(canvas: HTMLCanvasElement, curves: BetaCurve[], theme: ThemeColors): void {
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const pw = w - PAD.l - PAD.r;
  const ph = h - PAD.t - PAD.b;
  if (pw <= 0 || ph <= 0) return;
  const x = (p: number) => PAD.l + p * pw;

  // Densités échantillonnées ; l'échelle verticale suit la courbe la plus haute (bornée pour rester lisible).
  const dens = curves.map((c) =>
    Array.from({ length: SAMPLES + 1 }, (_, i) => {
      const p = Math.min(0.9995, Math.max(0.0005, i / SAMPLES));
      return betaPdf(p, c.a, c.b);
    }),
  );
  let max = 1.2;
  for (const d of dens) for (const v of d) if (Number.isFinite(v) && v > max) max = v;
  max = Math.min(max * 1.08, 80);
  const y = (v: number) => PAD.t + ph - (Math.min(v, max) / max) * ph;

  // Axe et graduations 0 %, 25 %, 50 %, 75 %, 100 %.
  ctx.font = '11px system-ui, sans-serif';
  ctx.strokeStyle = theme.border;
  ctx.fillStyle = theme.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD.l, PAD.t + ph);
  ctx.lineTo(PAD.l + pw, PAD.t + ph);
  ctx.stroke();
  ctx.textBaseline = 'top';
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    ctx.textAlign = p === 0 ? 'left' : p === 1 ? 'right' : 'center';
    ctx.fillText(`${Math.round(p * 100)} %`, x(p), PAD.t + ph + 5);
    ctx.beginPath();
    ctx.moveTo(x(p), PAD.t + ph);
    ctx.lineTo(x(p), PAD.t + ph + 3);
    ctx.stroke();
  }

  const labels: Array<{ x: number; y: number; text: string; color: string }> = [];
  curves.forEach((c, k) => {
    const d = dens[k];
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(c.dashed ? [5, 3] : []);
    ctx.beginPath();
    let peak = 0;
    d.forEach((v, i) => {
      const px = x(i / SAMPLES);
      const py = y(Number.isFinite(v) ? v : max);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
      if (v > d[peak]) peak = i;
    });
    ctx.stroke();
    ctx.setLineDash([]);
    labels.push({ x: x(peak / SAMPLES), y: y(d[peak]) - 4, text: c.label, color: c.color });

    if (c.truth !== null) {
      // Petit triangle sous l'axe : vraie probabilité.
      const tx = x(c.truth);
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.moveTo(tx, PAD.t + ph - 1);
      ctx.lineTo(tx - 5, PAD.t + ph - 9);
      ctx.lineTo(tx + 5, PAD.t + ph - 9);
      ctx.closePath();
      ctx.fill();
    }
  });

  // Étiquettes « M1 », « M2 »… au sommet de chaque courbe, décalées si elles se chevauchent.
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const placed: Array<{ x: number; y: number }> = [];
  labels
    .sort((a, b) => a.y - b.y)
    .forEach((l) => {
      let ly = Math.max(PAD.t + 10, l.y);
      for (let tries = 0; tries < 12; tries++) {
        const clash = placed.some((p) => Math.abs(p.x - l.x) < 22 && Math.abs(p.y - ly) < 12);
        if (!clash) break;
        ly += 12;
      }
      placed.push({ x: l.x, y: ly });
      const lx = Math.min(PAD.l + pw - 10, Math.max(PAD.l + 10, l.x));
      ctx.fillStyle = theme.panel;
      ctx.fillRect(lx - 11, ly - 12, 22, 12);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, lx, ly);
    });
}

/**
 * Trait vertical à l'indice `at` sur un graphique tracé par drawChart (mêmes marges : 44/10/10/24).
 * `n` = nombre de points des séries.
 */
export function drawChangeMarker(canvas: HTMLCanvasElement, n: number, at: number, theme: ThemeColors, text: string): void {
  if (n <= 1 || at >= n) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const pad = { l: 44, r: 10, t: 10, b: 24 };
  const px = pad.l + (at / (n - 1)) * (w - pad.l - pad.r);
  ctx.save();
  ctx.strokeStyle = theme.muted;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px, pad.t);
  ctx.lineTo(px, h - pad.b);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = theme.muted;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = px > w / 2 ? 'right' : 'left';
  ctx.fillText(text, px + (px > w / 2 ? -4 : 4), pad.t + 2);
  ctx.restore();
}
