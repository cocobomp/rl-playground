// Dessin du pendule inversé (scène + jauges) et du réseau de neurones, en canvas.
import { ThemeColors, prepareCanvas } from '../../shared/ui';
import { ANGLE_LIMIT, State, X_LIMIT } from './env';
import { PolicySpec, forwardLayers } from './agent';

/** "#rrggbb" | "#rgb" | "rgb(r, g, b)" → [r, g, b]. */
export function parseColor(c: string): [number, number, number] {
  const s = c.trim();
  if (s.startsWith('#')) {
    const hex = s.length === 4 ? s.slice(1).split('').map((x) => x + x).join('') : s.slice(1, 7);
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [128, 128, 128];
}
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

export interface StageView {
  state: State;
  halfLength: number;
  /** Force du moteur, en fraction de la force maximale (−1 … 1). */
  force: number;
  /** Vent actuel en fraction de la rafale maximale (−1 … 1), 0 si pas de vent. */
  wind: number;
  failed: boolean;
  /** Texte en haut à gauche (ex. « 3,4 s »). */
  caption: string;
  /** Texte en haut à droite (ex. « génération 12 »). */
  badge?: string;
  /** Message central (ex. « Appuyez sur ← ou → »). */
  overlay?: string;
}

export function drawStage(canvas: HTMLCanvasElement, v: StageView, t: ThemeColors): void {
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const gaugeH = 54;
  const sceneH = h - gaugeH;
  const font = (px: number, weight = 400) => `${weight} ${px}px system-ui, sans-serif`;

  // Échelle : la piste (±2,4 m) + une marge tient en largeur ; le plus long bâton (2 m) tient en hauteur.
  const scale = Math.min((w - 24) / (2 * X_LIMIT + 0.8), (sceneH - 60) / 2.1);
  const cx = w / 2;
  const trackY = sceneH - 26;
  const X = (x: number) => cx + x * scale;

  // Piste et limites
  ctx.strokeStyle = t.muted;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X(-X_LIMIT - 0.3), trackY);
  ctx.lineTo(X(X_LIMIT + 0.3), trackY);
  ctx.stroke();
  ctx.strokeStyle = t.trap;
  ctx.lineWidth = 2;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(X(s * X_LIMIT), trackY - 14);
    ctx.lineTo(X(s * X_LIMIT), trackY + 8);
    ctx.stroke();
  }
  ctx.fillStyle = t.muted;
  ctx.font = font(10);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('0', X(0), trackY + 6);
  ctx.strokeStyle = t.border;
  ctx.beginPath();
  ctx.moveTo(X(0), trackY);
  ctx.lineTo(X(0), trackY + 5);
  ctx.stroke();

  // Chariot
  const [x, , theta] = v.state;
  const cartW = Math.max(36, 0.5 * scale);
  const cartH = Math.max(18, 0.28 * scale);
  const cartX = X(x);
  const cartTop = trackY - 6 - cartH;
  ctx.fillStyle = t.wall;
  roundRect(ctx, cartX - cartW / 2, cartTop, cartW, cartH, 4);
  ctx.fill();
  ctx.fillStyle = t.muted;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cartX + (s * cartW) / 3, trackY - 4, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Flèche de force du moteur
  if (Math.abs(v.force) > 0.01) {
    const len = 10 + 26 * Math.abs(v.force);
    const dir = Math.sign(v.force);
    const y = cartTop + cartH / 2;
    const x0 = cartX - dir * (cartW / 2 + 4);
    arrow(ctx, x0, y, x0 - dir * len, y, t.accent, 3);
  }

  // Bâton
  const pivotY = cartTop + 2;
  const L = 2 * v.halfLength * scale;
  const tipX = cartX + Math.sin(theta) * L;
  const tipY = pivotY - Math.cos(theta) * L;
  ctx.strokeStyle = v.failed ? t.trap : t.agent;
  ctx.lineWidth = Math.max(5, 0.06 * scale);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cartX, pivotY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = t.text;
  ctx.beginPath();
  ctx.arc(cartX, pivotY, 4, 0, Math.PI * 2);
  ctx.fill();

  // Vent : flèches à hauteur du bâton
  if (Math.abs(v.wind) > 0.02) {
    const c = parseColor(t.series[5] || t.accent);
    const dir = Math.sign(v.wind);
    const a = Math.min(1, 0.25 + Math.abs(v.wind));
    const midY = (pivotY + tipY) / 2;
    for (let i = -1; i <= 1; i++) {
      const y = midY + i * 16;
      const xs = cartX + Math.sin(theta) * (L / 2) * (1 + i * 0.3) - dir * 46;
      arrow(ctx, xs, y, xs + dir * (18 + 26 * Math.abs(v.wind)), y, rgba(c, a), 2);
    }
    ctx.fillStyle = rgba(c, 1);
    ctx.font = font(11, 600);
    ctx.textAlign = dir > 0 ? 'left' : 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('rafale', dir > 0 ? 10 : w - 10, 30);
  }

  // Textes
  ctx.fillStyle = t.text;
  ctx.font = font(13, 600);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(v.caption, 10, 8);
  if (v.badge) {
    ctx.fillStyle = t.muted;
    ctx.font = font(12);
    ctx.textAlign = 'right';
    ctx.fillText(v.badge, w - 10, 9);
  }
  if (v.overlay) {
    ctx.font = font(15, 600);
    const tw = Math.min(w - 20, ctx.measureText(v.overlay).width + 24);
    ctx.fillStyle = t.panel;
    ctx.globalAlpha = 0.9;
    roundRect(ctx, cx - tw / 2, sceneH / 2 - 40, tw, 32, 8);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = t.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(v.overlay, cx, sceneH / 2 - 24, w - 30);
  }

  // Jauges
  drawGauges(ctx, w, sceneH, v.state, t);
}

function drawGauges(ctx: CanvasRenderingContext2D, w: number, top: number, s: State, t: ThemeColors): void {
  const gap = 12;
  const gw = (w - 3 * gap) / 2;
  const items = [
    { label: 'Position', value: s[0], limit: X_LIMIT, text: `${s[0] >= 0 ? '+' : '−'}${Math.abs(s[0]).toFixed(2).replace('.', ',')} m` },
    { label: 'Angle', value: s[2], limit: ANGLE_LIMIT, text: `${s[2] >= 0 ? '+' : '−'}${Math.abs((s[2] * 180) / Math.PI).toFixed(1).replace('.', ',')}°` },
  ];
  const good = parseColor(`rgb(${t.good})`);
  const bad = parseColor(`rgb(${t.bad})`);
  items.forEach((it, i) => {
    const x0 = gap + i * (gw + gap);
    const y0 = top + 8;
    ctx.fillStyle = t.muted;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(it.label, x0, y0);
    ctx.fillStyle = t.text;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(it.text, x0 + gw, y0);
    const by = y0 + 20;
    const bh = 10;
    ctx.fillStyle = t.cell;
    roundRect(ctx, x0, by, gw, bh, 5);
    ctx.fill();
    ctx.strokeStyle = t.border;
    ctx.lineWidth = 1;
    roundRect(ctx, x0, by, gw, bh, 5);
    ctx.stroke();
    const frac = Math.max(-1, Math.min(1, it.value / it.limit));
    const mid = x0 + gw / 2;
    const danger = Math.abs(frac);
    ctx.fillStyle = rgba(danger > 0.75 ? bad : good, 0.5 + 0.5 * danger);
    const bw = (frac * gw) / 2;
    ctx.fillRect(Math.min(mid, mid + bw), by + 1, Math.abs(bw), bh - 2);
    ctx.fillStyle = t.text;
    ctx.fillRect(mid - 0.5, by - 2, 1, bh + 4);
    ctx.fillStyle = t.muted;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(i === 0 ? '−2,4 m' : '−12°', x0, by + bh + 2);
    ctx.textAlign = 'right';
    ctx.fillText(i === 0 ? '+2,4 m' : '+12°', x0 + gw, by + bh + 2);
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, width: number): void {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const head = 4 + width * 2;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - Math.cos(ang) * head * 0.6, y1 - Math.sin(ang) * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - Math.cos(ang - 0.5) * head, y1 - Math.sin(ang - 0.5) * head);
  ctx.lineTo(x1 - Math.cos(ang + 0.5) * head, y1 - Math.sin(ang + 0.5) * head);
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Réseau de neurones
// ---------------------------------------------------------------------------

export const INPUT_LABELS = ['position', 'vitesse', 'angle', 'vitesse angulaire'];

/**
 * Dessine la politique : nœuds colorés selon leur activation (bleu = positif, orange = négatif),
 * liens dont l'épaisseur suit |poids| et la couleur son signe.
 */
export function drawNetwork(canvas: HTMLCanvasElement, spec: PolicySpec, obs: ArrayLike<number>, t: ThemeColors): void {
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const pos = parseColor(t.series[0]);
  const neg = parseColor(t.series[1]);
  const sizes = spec.sizes;
  const layers = forwardLayers(sizes, spec.params, obs, spec.brain === 'softmax' ? 'sigmoid' : 'tanh');
  const narrow = w < 420;
  const fontPx = narrow ? 11 : 12;
  // Largeurs réservées aux étiquettes, mesurées (aucun texte coupé, même à 360 px).
  ctx.font = `${fontPx}px system-ui, sans-serif`;
  const labelW = Math.max(...INPUT_LABELS.map((l) => ctx.measureText(l).width)) + 8;
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  const outW = Math.max(ctx.measureText(spec.brain === 'softmax' ? 'P(pousser →)' : 'pousser ← / →').width, narrow ? 50 : 60) + 6;
  const r0 = 13;
  const x0 = labelW + r0 + 6;
  const x1 = w - outW - r0 - 6;
  const top = sizes.length === 3 ? 26 : 18;
  const bottom = h - 14;
  const xs = sizes.map((_, l) => (sizes.length === 1 ? x0 : x0 + ((x1 - x0) * l) / (sizes.length - 1)));
  const ys = sizes.map((n) => Array.from({ length: n }, (_, i) => (n === 1 ? (top + bottom) / 2 : top + ((bottom - top) * i) / (n - 1))));
  const maxN = Math.max(...sizes);
  const r = Math.max(6, Math.min(13, (bottom - top) / maxN / 2.6));

  // Liens
  let k = 0;
  let wmax = 1e-6;
  for (const p of spec.params) wmax = Math.max(wmax, Math.abs(p));
  for (let l = 0; l + 1 < sizes.length; l++) {
    const nin = sizes[l];
    const nout = sizes[l + 1];
    for (let o = 0; o < nout; o++) {
      for (let i = 0; i < nin; i++) {
        const wt = spec.params[k + o * nin + i];
        const m = Math.abs(wt) / wmax;
        ctx.strokeStyle = rgba(wt >= 0 ? pos : neg, 0.15 + 0.75 * m);
        ctx.lineWidth = 0.5 + 4.5 * m;
        ctx.beginPath();
        ctx.moveTo(xs[l] + r, ys[l][i]);
        ctx.lineTo(xs[l + 1] - r, ys[l + 1][o]);
        ctx.stroke();
      }
    }
    k += nin * nout + nout;
  }

  // Nœuds
  layers.forEach((acts, l) => {
    acts.forEach((a, i) => {
      // Activation affichée dans [−1, 1] (la sortie σ de REINFORCE est recentrée : 2p − 1).
      const isProb = spec.brain === 'softmax' && l === layers.length - 1;
      const v = Math.max(-1, Math.min(1, isProb ? 2 * a - 1 : a));
      ctx.fillStyle = t.panel;
      ctx.beginPath();
      ctx.arc(xs[l], ys[l][i], r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(v >= 0 ? pos : neg, 0.1 + 0.9 * Math.abs(v));
      ctx.fill();
      ctx.strokeStyle = t.border;
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  });

  // Étiquettes
  ctx.font = `${narrow ? 11 : 12}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  INPUT_LABELS.forEach((lab, i) => {
    ctx.fillStyle = t.text;
    ctx.fillText(lab, xs[0] - r - 6, ys[0][i] - 6);
    ctx.fillStyle = t.muted;
    const val = layers[0][i];
    ctx.fillText(`${val >= 0 ? '+' : '−'}${Math.abs(val).toFixed(2).replace('.', ',')}`, xs[0] - r - 6, ys[0][i] + 7);
  });
  const out = layers[layers.length - 1][0];
  const oy = ys[ys.length - 1][0];
  const ox = xs[xs.length - 1] + r + 6;
  ctx.textAlign = 'left';
  ctx.fillStyle = t.text;
  ctx.font = `600 ${narrow ? 11 : 12}px system-ui, sans-serif`;
  if (spec.brain === 'softmax') {
    ctx.fillText('P(pousser →)', ox, oy - 8);
    ctx.font = `${narrow ? 11 : 12}px system-ui, sans-serif`;
    ctx.fillText(`= ${(out * 100).toFixed(0)} %`, ox, oy + 8);
  } else {
    ctx.fillText('pousser ← / →', ox, oy - 8, w - ox - 2);
    ctx.font = `${narrow ? 11 : 12}px system-ui, sans-serif`;
    ctx.fillStyle = t.muted;
    const dir = spec.continuous ? `${out >= 0 ? '→' : '←'} ${Math.abs(out * 100).toFixed(0)} %` : out >= 0 ? '→ droite' : '← gauche';
    ctx.fillText(dir, ox, oy + 8, w - ox - 2);
  }
  if (sizes.length === 3) {
    ctx.fillStyle = t.muted;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('neurones cachés', xs[1], 1);
  }
}
