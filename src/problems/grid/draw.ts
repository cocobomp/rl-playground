// Dessin d'une grille et de ce que l'agent a appris (utilisé par la grande grille et par la comparaison).
import { ACTIONS, DEFAULT_SMALL_REWARD, GridWorld, Trainer } from './rl';
import { prepareCanvas, readTheme, ThemeColors } from '../../shared/ui';

export interface BoardColors extends ThemeColors {
  /** Couleur du texte posé sur une case colorée (trésor, piège). */
  onColor: string;
}

export function readBoardColors(): BoardColors {
  const t = readTheme();
  const on = getComputedStyle(document.documentElement).getPropertyValue('--accent-text').trim();
  return { ...t, onColor: on || t.panel };
}

export interface BoardOptions {
  arrows: boolean;
  values: boolean;
  greedy: boolean;
  /** Afficher l'agent et son trajet en cours. */
  agent: boolean;
}

const fmtReward = (v: number) => (v > 0 ? `+${Math.round(v)}` : String(Math.round(v)).replace('-', '−'));

export function drawBoard(
  canvas: HTMLCanvasElement,
  world: GridWorld,
  trainer: Trainer,
  colors: BoardColors,
  opts: BoardOptions,
): void {
  const { ctx, w } = prepareCanvas(canvas);
  const size = w;
  if (size <= 0) return;
  const n = world.size;
  const cs = size / n;
  ctx.clearRect(0, 0, size, size);
  const rewards = trainer.params.rewards;

  // Échelle des couleurs : plus grande valeur absolue parmi les cases non terminales
  let maxAbs = 1e-9;
  for (let s = 0; s < world.nStates; s++) {
    if (world.cells[s] === 'wall' || world.isTerminal(s) || !trainer.visited(s)) continue;
    maxAbs = Math.max(maxAbs, Math.abs(trainer.value(s)));
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let s = 0; s < world.nStates; s++) {
    const [r, c] = world.rowCol(s);
    const x = c * cs;
    const y = r * cs;
    const cell = world.cells[s];
    ctx.fillStyle =
      cell === 'wall' ? colors.wall : cell === 'trap' ? colors.trap : cell === 'goal' ? colors.goal : colors.cell;
    ctx.fillRect(x, y, cs, cs);

    if (cell === 'bonus') {
      // Petit trésor : disque vert plus petit sur fond de case
      ctx.fillStyle = colors.goal;
      ctx.beginPath();
      ctx.arc(x + cs / 2, y + cs / 2, cs * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors.onColor;
      ctx.font = `bold ${cs * 0.26}px system-ui, sans-serif`;
      ctx.fillText(fmtReward(rewards.small ?? DEFAULT_SMALL_REWARD), x + cs / 2, y + cs / 2 + cs * 0.01);
      continue;
    }

    if ((cell === 'empty' || cell === 'start') && trainer.visited(s)) {
      const v = trainer.value(s);
      const t = Math.min(1, Math.abs(v) / maxAbs);
      ctx.fillStyle = `rgba(${v >= 0 ? colors.good : colors.bad}, ${0.12 + 0.6 * t})`;
      ctx.fillRect(x, y, cs, cs);
    }

    if (cell === 'goal' || cell === 'trap') {
      ctx.fillStyle = colors.onColor;
      const big = cs >= 34;
      ctx.font = `bold ${cs * (big ? 0.42 : 0.5)}px system-ui, sans-serif`;
      ctx.fillText(cell === 'goal' ? '★' : '✕', x + cs / 2, y + cs / 2 - (big ? cs * 0.08 : 0));
      if (big) {
        ctx.font = `600 ${cs * 0.2}px system-ui, sans-serif`;
        ctx.fillText(fmtReward(cell === 'goal' ? rewards.goal : rewards.trap), x + cs / 2, y + cs * 0.8);
      }
    } else if (cell === 'start') {
      ctx.strokeStyle = colors.start;
      ctx.lineWidth = Math.max(2, cs * 0.07);
      ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, cs - ctx.lineWidth, cs - ctx.lineWidth);
      ctx.fillStyle = colors.start;
      ctx.font = `bold ${cs * 0.22}px system-ui, sans-serif`;
      ctx.fillText('D', x + cs * 0.18, y + cs * 0.2);
    }

    if ((cell === 'empty' || cell === 'start') && trainer.visited(s)) {
      if (opts.arrows) drawArrow(ctx, x, opts.values ? y - cs * 0.1 : y, cs, trainer.greedyAction(s), opts.values, colors);
      if (opts.values) {
        ctx.fillStyle = colors.text;
        ctx.font = `${cs * 0.2}px system-ui, sans-serif`;
        ctx.fillText(trainer.value(s).toFixed(1), x + cs / 2, y + cs * 0.84);
      }
    }
  }

  // Lignes de grille
  ctx.strokeStyle = colors.gridLine;
  ctx.lineWidth = n * 2 > size / 10 ? 1 : 1.5;
  ctx.beginPath();
  for (let i = 1; i < n; i++) {
    ctx.moveTo(i * cs, 0);
    ctx.lineTo(i * cs, size);
    ctx.moveTo(0, i * cs);
    ctx.lineTo(size, i * cs);
  }
  ctx.stroke();

  const center = (s: number): [number, number] => {
    const [r, c] = world.rowCol(s);
    return [c * cs + cs / 2, r * cs + cs / 2];
  };

  // Meilleur chemin appris (pointillés)
  if (opts.greedy && trainer.episode > 0) {
    const path = trainer.greedyPath();
    if (path.length > 1) {
      ctx.strokeStyle = colors.start;
      ctx.lineWidth = Math.max(2, cs * 0.06);
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.setLineDash([cs * 0.12, cs * 0.1]);
      ctx.beginPath();
      path.forEach((s, i) => (i === 0 ? ctx.moveTo(...center(s)) : ctx.lineTo(...center(s))));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (!opts.agent) return;

  // Trajet de l'épisode en cours
  const path = trainer.path;
  if (path.length > 1) {
    ctx.strokeStyle = colors.agent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(2, cs * 0.08);
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.beginPath();
    const recent = path.slice(-60);
    recent.forEach((s, i) => (i === 0 ? ctx.moveTo(...center(s)) : ctx.lineTo(...center(s))));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Agent
  if (trainer.state >= 0) {
    const [ax, ay] = center(trainer.state);
    ctx.fillStyle = colors.agent;
    ctx.strokeStyle = colors.panel;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ax, ay, cs * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cs: number,
  a: number,
  small: boolean,
  colors: BoardColors,
) {
  const { dr, dc } = ACTIONS[a];
  const cx = x + cs / 2;
  const cy = y + cs / 2;
  const len = cs * (small ? 0.22 : 0.28);
  const tipX = cx + dc * len;
  const tipY = cy + dr * len;
  const backX = cx - dc * len * 0.6;
  const backY = cy - dr * len * 0.6;
  const head = cs * 0.13;
  ctx.strokeStyle = ctx.fillStyle = colors.text;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = Math.max(1.2, cs * 0.045);
  ctx.beginPath();
  ctx.moveTo(backX, backY);
  ctx.lineTo(tipX - dc * head * 0.6, tipY - dr * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - dc * head - dr * head * 0.7, tipY - dr * head - dc * head * 0.7);
  ctx.lineTo(tipX - dc * head + dr * head * 0.7, tipY - dr * head + dc * head * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}
