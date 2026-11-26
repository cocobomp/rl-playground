// Tableau de bord 2D : ce que le robot perçoit (entrées du réseau) et ce qu'il commande (sorties).
import { prepareCanvas, type ThemeColors } from '../../shared/ui';
import { NUM_JOINTS, OBS_SIZE } from './env';

const GROUPS: Array<{ label: string; n: number }> = [
  { label: 'Rythme', n: 2 },
  { label: 'Gravité', n: 3 },
  { label: 'Vitesse', n: 3 },
  { label: 'Rotation', n: 3 },
  { label: 'Hauteur', n: 1 },
  { label: 'Angles', n: 8 },
];

const JOINT_SHORT = ['AvG', 'AvD', 'ArG', 'ArD'];

/** Dessine des barres centrées : entrées (haut) et consignes moteurs (bas). */
export function drawBrainPanel(
  canvas: HTMLCanvasElement,
  obs: ArrayLike<number> | null,
  actions: ArrayLike<number> | null,
  actuated: boolean[],
  t: ThemeColors,
): void {
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px system-ui, sans-serif';
  const pad = 8;
  const half = (h - 2 * pad) / 2;
  const row = (y0: number, rh: number, values: ArrayLike<number> | null, n: number, color: string, labels: (i: number) => string | null, disabled?: (i: number) => boolean) => {
    const bw = (w - 2 * pad) / n;
    const mid = y0 + (rh - 16) / 2;
    const amp = (rh - 16) / 2 - 2;
    ctx.strokeStyle = t.border;
    ctx.beginPath();
    ctx.moveTo(pad, mid);
    ctx.lineTo(w - pad, mid);
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      const v = values ? Math.max(-1, Math.min(1, values[i] ?? 0)) : 0;
      const x = pad + i * bw + bw * 0.18;
      const bwi = bw * 0.64;
      ctx.fillStyle = disabled?.(i) ? t.trap : color;
      if (disabled?.(i)) {
        ctx.fillRect(x, mid - 1, bwi, 2);
      } else {
        ctx.fillRect(x, v >= 0 ? mid - v * amp : mid, bwi, Math.max(1, Math.abs(v) * amp));
      }
      const lab = labels(i);
      if (lab) {
        ctx.fillStyle = t.muted;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(lab, pad + i * bw + 1, y0 + rh - 3);
      }
    }
  };
  // Entrées : une étiquette par groupe.
  const starts = new Map<number, string>();
  let k = 0;
  for (const g of GROUPS) {
    starts.set(k, g.label);
    k += g.n;
  }
  row(pad, half, obs, OBS_SIZE, t.series[0] || t.accent, (i) => {
    const l = starts.get(i);
    if (!l) return null;
    // Les étiquettes trop serrées sont abrégées.
    const bw = (w - 2 * pad) / OBS_SIZE;
    const n = GROUPS.find((g) => g.label === l)!.n;
    return n * bw < ctx.measureText(l).width + 4 ? l.slice(0, Math.max(1, Math.floor((n * bw) / 7))) : l;
  });
  row(pad + half, half, actions, NUM_JOINTS, t.series[1] || t.accent, (i) => `${JOINT_SHORT[i >> 1]} ${i % 2 === 0 ? 'h' : 'g'}`, (i) => !actuated[i]);
}
