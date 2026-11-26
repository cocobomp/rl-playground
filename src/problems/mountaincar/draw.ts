// Dessins sur canvas : la vallée (vue « film ») et l’espace des phases (position × vitesse).
import { readTheme, ThemeColors } from '../../shared/ui';
import { Agent } from './agent';
import { GOAL_X, N_ACTIONS, V_MAX, X_MAX, X_MIN, height } from './env';

export interface Colors {
  theme: ThemeColors;
  /** Triplets RGB pour l’image de la carte des phases. */
  rgbGood: [number, number, number];
  rgbBad: [number, number, number];
  rgbMid: [number, number, number];
  rgbLeft: [number, number, number];
  rgbRight: [number, number, number];
  rgbNone: [number, number, number];
  left: string;
  right: string;
  none: string;
}

let probe: CanvasRenderingContext2D | null = null;
/** Convertit n’importe quelle couleur CSS (#hex, rgb(), triplet « r, g, b ») en [r, g, b]. */
export function toRgb(color: string): [number, number, number] {
  const c = color.trim();
  if (/^\d+\s*,\s*\d+\s*,\s*\d+$/.test(c)) return c.split(',').map((x) => Number(x.trim())) as [number, number, number];
  probe ??= document.createElement('canvas').getContext('2d');
  if (!probe) return [128, 128, 128];
  probe.fillStyle = '#808080';
  probe.fillStyle = c;
  const s = String(probe.fillStyle);
  if (s.startsWith('#')) {
    const n = parseInt(s.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/[\d.]+/g);
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [128, 128, 128];
}

export function readColors(): Colors {
  const theme = readTheme();
  const left = theme.series[0];
  const right = theme.series[1];
  const none = theme.muted;
  return {
    theme,
    rgbGood: toRgb(theme.good),
    rgbBad: toRgb(theme.bad),
    rgbMid: toRgb(theme.cell),
    rgbLeft: toRgb(left),
    rgbRight: toRgb(right),
    rgbNone: toRgb(theme.muted),
    left,
    right,
    none,
  };
}

const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

// ---------- Vallée ----------

export interface SceneState {
  x: number;
  v: number;
  /** Action jouée (0 gauche, 1 rien, 2 droite) ou −1 si aucune. */
  action: number;
  /** Positions récentes (les plus anciennes d’abord). */
  trail: number[];
  /** Mode test : couleur différente. */
  testing: boolean;
  reached: boolean;
}

export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, s: SceneState, col: Colors): void {
  const t = col.theme;
  ctx.clearRect(0, 0, w, h);
  const padX = 14;
  const top = 62;
  const bottom = h - 18;
  const sx = (x: number) => padX + ((x - X_MIN) / (X_MAX - X_MIN)) * (w - 2 * padX);
  const sy = (y: number) => bottom - ((y + 1) / 2) * (bottom - top);

  // Zone de départ
  ctx.fillStyle = rgba(toRgb(t.start), 0.12);
  ctx.fillRect(sx(-0.6), top - 10, sx(-0.4) - sx(-0.6), bottom - top + 10);

  // Sol
  ctx.beginPath();
  const n = 160;
  for (let i = 0; i <= n; i++) {
    const x = X_MIN + ((X_MAX - X_MIN) * i) / n;
    const px = sx(x);
    const py = sy(height(x));
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.lineTo(sx(X_MAX), h);
  ctx.lineTo(sx(X_MIN), h);
  ctx.closePath();
  ctx.fillStyle = t.cell;
  ctx.fill();
  ctx.strokeStyle = t.wall;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const x = X_MIN + ((X_MAX - X_MIN) * i) / n;
    if (i === 0) ctx.moveTo(sx(x), sy(height(x)));
    else ctx.lineTo(sx(x), sy(height(x)));
  }
  ctx.stroke();

  // Mur de gauche
  ctx.fillStyle = t.wall;
  ctx.fillRect(sx(X_MIN) - 4, sy(height(X_MIN)) - 26, 4, 26);

  // Drapeau
  const fx = sx(GOAL_X) - 2;
  const fy = sy(height(GOAL_X));
  ctx.strokeStyle = t.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(fx, fy - 34);
  ctx.stroke();
  ctx.fillStyle = t.goal;
  ctx.beginPath();
  ctx.moveTo(fx, fy - 34);
  ctx.lineTo(fx - 18, fy - 28);
  ctx.lineTo(fx, fy - 22);
  ctx.closePath();
  ctx.fill();

  // Traînée
  const trail = s.trail;
  const agentRgb = toRgb(s.testing ? t.accent : t.agent);
  for (let i = 0; i < trail.length; i++) {
    const x = trail[i];
    const a = ((i + 1) / trail.length) * 0.55;
    ctx.fillStyle = rgba(agentRgb, a);
    ctx.beginPath();
    ctx.arc(sx(x), sy(height(x)) - 4, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Voiture, inclinée selon la pente (en pixels)
  const cx = sx(s.x);
  const cy = sy(height(s.x));
  const dx = 0.01;
  const ang = Math.atan2(sy(height(s.x + dx)) - sy(height(s.x - dx)), sx(s.x + dx) - sx(s.x - dx));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  const W = 30;
  const H = 12;
  // Flamme / poussée
  if (s.action === 0 || s.action === 2) {
    const dir = s.action === 2 ? 1 : -1;
    ctx.fillStyle = s.action === 2 ? col.right : col.left;
    ctx.beginPath();
    ctx.moveTo(-dir * (W / 2), -H / 2 - 5);
    ctx.lineTo(-dir * (W / 2 + 12), -H / 2 - 1);
    ctx.lineTo(-dir * (W / 2), -H / 2 + 3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = s.testing ? t.accent : t.agent;
  ctx.beginPath();
  ctx.roundRect(-W / 2, -H - 5, W, H, 4);
  ctx.fill();
  ctx.fillStyle = t.panel;
  ctx.fillRect(-W / 2 + 15, -H - 2, 9, 5);
  ctx.fillStyle = t.text;
  for (const wx of [-W / 2 + 6, W / 2 - 6]) {
    ctx.beginPath();
    ctx.arc(wx, -4, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Légende
  ctx.font = '12px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = t.muted;
  const act = s.action === 0 ? '◀ gauche' : s.action === 2 ? 'droite ▶' : s.action === 1 ? 'roue libre' : '';
  const speedTxt = `vitesse ${s.v >= 0 ? '+' : '−'}${Math.abs(s.v * 1000).toFixed(0)} (×10⁻³)`;
  ctx.fillText(`${s.testing ? 'Test sans exploration · ' : ''}${speedTxt}${act ? ' · ' + act : ''}`, 8, 8);
  ctx.textAlign = 'center';
  ctx.fillText('départ', (sx(-0.6) + sx(-0.4)) / 2, h - 16);
  if (s.reached) {
    ctx.fillStyle = t.goal;
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('Arrivée !', fx - 24, fy - 28);
  }
}

// ---------- Espace des phases ----------

export type PhaseMode = 'value' | 'policy';

export const PHASE_NX = 85;
export const PHASE_NY = 60;

export interface PhaseImage {
  canvas: HTMLCanvasElement;
  minCost: number;
  maxCost: number;
}

/** Calcule l’image (petite) de la carte : coût −max Q ou action gloutonne, en chaque point de la grille. */
export function renderPhaseImage(agent: Agent, mode: PhaseMode, col: Colors, target?: PhaseImage): PhaseImage {
  const canvas = target?.canvas ?? document.createElement('canvas');
  canvas.width = PHASE_NX;
  canvas.height = PHASE_NY;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(PHASE_NX, PHASE_NY);
  const q = new Float64Array(N_ACTIONS);
  const cost = new Float64Array(PHASE_NX * PHASE_NY);
  const best = new Uint8Array(PHASE_NX * PHASE_NY);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < PHASE_NY; j++) {
    const v = V_MAX - ((j + 0.5) / PHASE_NY) * 2 * V_MAX;
    for (let i = 0; i < PHASE_NX; i++) {
      const x = X_MIN + ((i + 0.5) / PHASE_NX) * (X_MAX - X_MIN);
      agent.qValues(x, v, q);
      let b = 1;
      let m = q[1];
      if (q[0] > m) (m = q[0]), (b = 0);
      if (q[2] > m) (m = q[2]), (b = 2);
      const k = j * PHASE_NX + i;
      cost[k] = -m;
      // Égalité parfaite (zone jamais visitée) : on marque « indécis ».
      best[k] = Math.abs(q[0] - q[1]) < 1e-9 && Math.abs(q[1] - q[2]) < 1e-9 ? 3 : b;
      if (-m < min) min = -m;
      if (-m > max) max = -m;
    }
  }
  if (max - min < 1e-9) max = min + 1;
  for (let k = 0; k < cost.length; k++) {
    let c: [number, number, number];
    const alpha = 255;
    if (mode === 'value') {
      const u = (cost[k] - min) / (max - min);
      c = u < 0.5 ? mix(col.rgbGood, col.rgbMid, u * 2) : mix(col.rgbMid, col.rgbBad, (u - 0.5) * 2);
    } else {
      const b = best[k];
      c = b === 0 ? col.rgbLeft : b === 2 ? col.rgbRight : b === 1 ? col.rgbNone : col.rgbMid;
    }
    img.data[k * 4] = c[0];
    img.data[k * 4 + 1] = c[1];
    img.data[k * 4 + 2] = c[2];
    img.data[k * 4 + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, minCost: min, maxCost: max };
}

function mix(a: [number, number, number], b: [number, number, number], u: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

export interface PhaseLayout {
  l: number;
  r: number;
  t: number;
  b: number;
  w: number;
  h: number;
}

export function phaseLayout(w: number, h: number): PhaseLayout {
  return { l: 40, r: 10, t: 10, b: 30, w, h };
}

/** Coordonnées physiques → pixels du canvas. */
export function phaseToPx(L: PhaseLayout, x: number, v: number): [number, number] {
  const pw = L.w - L.l - L.r;
  const ph = L.h - L.t - L.b;
  return [L.l + ((x - X_MIN) / (X_MAX - X_MIN)) * pw, L.t + ((V_MAX - v) / (2 * V_MAX)) * ph];
}

/** Pixels → coordonnées physiques (null hors de la carte). */
export function pxToPhase(L: PhaseLayout, px: number, py: number): { x: number; v: number } | null {
  const pw = L.w - L.l - L.r;
  const ph = L.h - L.t - L.b;
  const u = (px - L.l) / pw;
  const t = (py - L.t) / ph;
  if (u < 0 || u > 1 || t < 0 || t > 1) return null;
  return { x: X_MIN + u * (X_MAX - X_MIN), v: V_MAX - t * 2 * V_MAX };
}

export function drawPhase(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  image: PhaseImage | null,
  traj: ArrayLike<number>,
  col: Colors,
  testing: boolean,
): void {
  const t = col.theme;
  const L = phaseLayout(w, h);
  ctx.clearRect(0, 0, w, h);
  const [x0, y0] = phaseToPx(L, X_MIN, V_MAX);
  const [x1, y1] = phaseToPx(L, X_MAX, -V_MAX);
  if (image) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image.canvas, x0, y0, x1 - x0, y1 - y0);
  }
  ctx.strokeStyle = t.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);

  // Axes : vitesse nulle et fond de la vallée
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = rgba(toRgb(t.text), 0.35);
  const [, yz] = phaseToPx(L, 0, 0);
  ctx.beginPath();
  ctx.moveTo(x0, yz);
  ctx.lineTo(x1, yz);
  const [xb] = phaseToPx(L, -Math.PI / 6, 0);
  ctx.moveTo(xb, y0);
  ctx.lineTo(xb, y1);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ligne d’arrivée
  ctx.strokeStyle = t.goal;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1 - 1.5, y0);
  ctx.lineTo(x1 - 1.5, y1);
  ctx.stroke();

  // Trajectoire (spirale)
  const n = traj.length / 2;
  if (n > 1) {
    const lineCol = testing ? t.accent : t.agent;
    ctx.strokeStyle = t.panel;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const [px, py] = phaseToPx(L, traj[2 * i], traj[2 * i + 1]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
    };
    path();
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.globalAlpha = 1;
    path();
    ctx.strokeStyle = lineCol;
    ctx.lineWidth = 2;
    ctx.stroke();
    const [sx0, sy0] = phaseToPx(L, traj[0], traj[1]);
    ctx.fillStyle = t.text;
    ctx.beginPath();
    ctx.arc(sx0, sy0, 3, 0, Math.PI * 2);
    ctx.fill();
    const [ex, ey] = phaseToPx(L, traj[2 * n - 2], traj[2 * n - 1]);
    ctx.fillStyle = lineCol;
    ctx.strokeStyle = t.panel;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ex, ey, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Graduations
  ctx.fillStyle = t.muted;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  for (const x of [-1.2, -0.5, 0, 0.5]) {
    const [px] = phaseToPx(L, x, 0);
    ctx.fillText(x.toFixed(1).replace('.', ',').replace('-', '−'), Math.min(Math.max(px, x0 + 10), x1 - 10), y1 + 4);
  }
  ctx.fillText('position →', (x0 + x1) / 2, y1 + 16);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('+0,07', x0 - 4, y0 + 6);
  ctx.fillText('0', x0 - 4, yz);
  ctx.fillText('−0,07', x0 - 4, y1 - 6);
  ctx.save();
  ctx.translate(10, (y0 + y1) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('vitesse →', 0, 0);
  ctx.restore();
}
