// Tableau de bord 2D : les 4 métronomes (un par patte), ce que le robot perçoit (entrées du réseau
// correcteur) et ce qu'il commande (consigne = rythme + correction).
import { prepareCanvas, type ThemeColors } from '../../shared/ui';
import { NUM_JOINTS, NUM_LEGS, OBS_SIZE } from './env';
import type { BrainOutput, LegGait } from './agent';

const GROUPS: Array<{ label: string; n: number }> = [
  { label: 'Rythme', n: 2 },
  { label: 'Gravité', n: 3 },
  { label: 'Vitesse', n: 3 },
  { label: 'Rotation', n: 3 },
  { label: 'Hauteur', n: 1 },
  { label: 'Angles', n: 8 },
];

export const LEG_SHORT = ['AvG', 'AvD', 'ArG', 'ArD'];

export interface BrainView {
  obs: ArrayLike<number>;
  out: BrainOutput;
  legs: LegGait[];
  hz: number;
  /** Phase commune du rythme (rad). */
  phase: number;
}

/** Dessine les métronomes (haut), les entrées (milieu) et les consignes (bas). */
export function drawBrainPanel(canvas: HTMLCanvasElement, v: BrainView | null, actuated: boolean[], t: ThemeColors): void {
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px system-ui, sans-serif';
  const pad = 8;
  const rhythmColor = t.series[0] || t.accent;
  const corrColor = t.series[2] || t.trap;
  const inColor = t.muted;

  // --- Métronomes ---------------------------------------------------------------------------
  const topH = Math.min(78, h * 0.36);
  const cw = (w - 2 * pad) / NUM_LEGS;
  const r = Math.max(10, Math.min(cw * 0.22, topH * 0.34));
  for (let i = 0; i < NUM_LEGS; i++) {
    const cx = pad + cw * i + r + 4;
    const cy = pad + r + 2;
    ctx.strokeStyle = t.border;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();
    const leg = v?.legs[i];
    const dead = !actuated[2 * i];
    if (leg && v) {
      const a = v.phase + leg.phase;
      // L'aiguille tourne au tempo du rythme ; sa longueur montre l'amplitude de la hanche.
      const len = r * (0.25 + 0.75 * Math.min(1, Math.abs(leg.hipAmp) / 0.7));
      ctx.strokeStyle = dead ? t.trap : rhythmColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len);
      ctx.stroke();
      ctx.fillStyle = rhythmColor;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.fillStyle = t.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tx = cx + r + 6;
    const room = pad + cw * (i + 1) - tx - 2;
    if (room > 22) {
      ctx.fillText(LEG_SHORT[i], tx, cy - 7);
      if (leg) {
        ctx.fillStyle = t.muted;
        const txt = room > 60 ? `ampl. ${Math.round(Math.abs(leg.hipAmp) * 100)} %` : `${Math.round(Math.abs(leg.hipAmp) * 100)} %`;
        ctx.fillText(txt, tx, cy + 7);
      }
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(LEG_SHORT[i], cx, cy + r + 9);
    }
  }
  if (v) {
    ctx.fillStyle = t.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`tempo ${v.hz.toFixed(1).replace('.', ',')} cycles/s`, w - pad, topH);
  }

  // --- Barres -------------------------------------------------------------------------------
  const rest = h - topH - pad;
  const half = rest / 2;
  const row = (
    y0: number,
    rh: number,
    n: number,
    draw: (i: number, x: number, bw: number, mid: number, amp: number) => void,
    labels: (i: number) => string | null,
  ) => {
    const bw = (w - 2 * pad) / n;
    const mid = y0 + (rh - 16) / 2;
    const amp = (rh - 16) / 2 - 2;
    ctx.strokeStyle = t.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, mid);
    ctx.lineTo(w - pad, mid);
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      draw(i, pad + i * bw, bw, mid, amp);
      const lab = labels(i);
      if (lab) {
        ctx.fillStyle = t.muted;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(lab, pad + i * bw + 1, y0 + rh - 3);
      }
    }
  };
  const bar = (x: number, mid: number, bwi: number, val: number, amp: number) => {
    const c = Math.max(-1, Math.min(1, val));
    ctx.fillRect(x, c >= 0 ? mid - c * amp : mid, bwi, Math.max(1, Math.abs(c) * amp));
  };

  const starts = new Map<number, string>();
  let k = 0;
  for (const g of GROUPS) {
    starts.set(k, g.label);
    k += g.n;
  }
  const obsBw = (w - 2 * pad) / OBS_SIZE;
  row(
    topH + pad,
    half,
    OBS_SIZE,
    (i, x, bw, mid, amp) => {
      ctx.fillStyle = inColor;
      bar(x + bw * 0.18, mid, bw * 0.64, v ? v.obs[i] : 0, amp);
    },
    (i) => {
      const l = starts.get(i);
      if (!l) return null;
      const n = GROUPS.find((g) => g.label === l)!.n;
      return n * obsBw < ctx.measureText(l).width + 4 ? l.slice(0, Math.max(1, Math.floor((n * obsBw) / 7))) : l;
    },
  );
  row(
    topH + pad + half,
    half,
    NUM_JOINTS,
    (i, x, bw, mid, amp) => {
      if (!actuated[i]) {
        ctx.fillStyle = t.trap;
        ctx.fillRect(x + bw * 0.12, mid - 1, bw * 0.76, 2);
        return;
      }
      if (!v) return;
      // Part du rythme (large) puis correction du réseau (fine, à côté) ; trait : consigne finale.
      ctx.fillStyle = rhythmColor;
      bar(x + bw * 0.12, mid, bw * 0.42, v.out.rhythm[i], amp);
      ctx.fillStyle = corrColor;
      bar(x + bw * 0.58, mid, bw * 0.3, v.out.correction[i], amp);
      ctx.fillStyle = t.text;
      const c = Math.max(-1, Math.min(1, v.out.action[i]));
      ctx.fillRect(x + bw * 0.08, mid - c * amp - 1, bw * 0.84, 2);
    },
    (i) => `${LEG_SHORT[i >> 1]} ${i % 2 === 0 ? 'h' : 'g'}`,
  );
}
