// Dessin du robot et du terrain (canvas 2D). Les couleurs viennent toutes du thème.
import type { ThemeColors } from '../../shared/ui';
import { FOOT_R, HULL_H, HULL_W, Pose, SHIN_W, SLOPE_ANGLE, THIGH_LEN, THIGH_W, WorldConfig } from './env';

export interface RobotView {
  pose: Pose;
  config: WorldConfig;
  shinLens: [number, number];
}

export interface Camera {
  x: number;
}

export interface Hud {
  lines: string[];
  right?: string[];
  banner?: { text: string; bad: boolean } | null;
}

function groundY(c: WorldConfig, x: number): number {
  return c.slope ? x * Math.tan(SLOPE_ANGLE) : 0;
}

export function drawStage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  theme: ThemeColors,
  cam: Camera,
  main: RobotView,
  ghost: RobotView | null,
  hud: Hud,
): void {
  ctx.clearRect(0, 0, w, h);
  const s = Math.min(h / 2.1, w / 2.2); // pixels par mètre
  const c = main.config;
  const camY = groundY(c, cam.x);
  const ox = w * 0.42;
  const oy = h * 0.8;
  const X = (x: number) => ox + (x - cam.x) * s;
  const Y = (y: number) => oy - (y - camY) * s;

  // Sol
  const xl = cam.x - ox / s - 1;
  const xr = cam.x + (w - ox) / s + 1;
  ctx.fillStyle = theme.border;
  ctx.beginPath();
  ctx.moveTo(X(xl), Y(groundY(c, xl)));
  ctx.lineTo(X(xr), Y(groundY(c, xr)));
  ctx.lineTo(X(xr), h + 10);
  ctx.lineTo(X(xl), h + 10);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = c.slippery ? theme.accent : theme.muted;
  ctx.lineWidth = c.slippery ? 3 : 2;
  ctx.beginPath();
  ctx.moveTo(X(xl), Y(groundY(c, xl)));
  ctx.lineTo(X(xr), Y(groundY(c, xr)));
  ctx.stroke();

  // Repères tous les mètres
  ctx.font = `${Math.max(10, Math.round(s * 0.085))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const every = s < 90 ? 2 : 1;
  for (let k = Math.ceil(xl); k <= xr; k++) {
    const gy = Y(groundY(c, k));
    const major = k % every === 0;
    ctx.strokeStyle = k === 0 ? theme.accent : theme.muted;
    ctx.lineWidth = k === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(X(k), gy);
    ctx.lineTo(X(k), gy + (major ? 10 : 5));
    ctx.stroke();
    if (major) {
      ctx.fillStyle = theme.muted;
      ctx.fillText(k === 0 ? 'départ' : `${k} m`, X(k), gy + 12);
    }
  }
  if (xl < 0 && xr > 0) {
    ctx.strokeStyle = theme.accent;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    ctx.lineTo(X(0), Y(1.6));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (ghost) drawRobot(ctx, X, Y, s, theme, ghost, true);
  drawRobot(ctx, X, Y, s, theme, main, false);

  // Texte d'information
  ctx.textBaseline = 'top';
  const fs = w < 420 ? 12 : 13;
  ctx.font = `${fs}px system-ui, sans-serif`;
  const pad = 8;
  const lh = fs + 4;
  const box = (lines: string[], right: boolean) => {
    if (!lines.length) return;
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const bx = right ? w - tw - pad * 2 - 6 : 6;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = theme.panel;
    roundRect(ctx, bx, 6, tw + pad * 2, lines.length * lh + pad, 6);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    lines.forEach((l, i) => ctx.fillText(l, bx + pad, 6 + pad / 2 + i * lh + 1));
  };
  box(hud.lines, false);
  if (hud.right && w >= 520) box(hud.right, true);
  if (hud.banner) {
    ctx.font = `600 ${fs + 2}px system-ui, sans-serif`;
    const tw = ctx.measureText(hud.banner.text).width;
    const bw = Math.min(w - 12, tw + 24);
    const bx = (w - bw) / 2;
    const by = h * 0.32;
    ctx.fillStyle = hud.banner.bad ? `rgba(${theme.bad}, 0.9)` : `rgba(${theme.good}, 0.9)`;
    roundRect(ctx, bx, by, bw, fs + 16, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(hud.banner.text, w / 2, by + 7, w - 24);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawRobot(
  ctx: CanvasRenderingContext2D,
  X: (x: number) => number,
  Y: (y: number) => number,
  s: number,
  theme: ThemeColors,
  view: RobotView,
  ghost: boolean,
) {
  const { pose, config } = view;
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.28;
  const leftColor = ghost ? theme.muted : theme.series[1];
  const rightColor = ghost ? theme.muted : theme.series[0];
  const hullColor = ghost ? theme.muted : theme.wall;

  // Rectangle orienté centré sur (x, y), dans le repère du corps.
  const piece = (bx: number, by: number, a: number, w: number, h: number, fill: string, dashed = false) => {
    ctx.save();
    ctx.translate(X(bx), Y(by));
    ctx.rotate(-a);
    ctx.fillStyle = fill;
    roundRect(ctx, (-w / 2) * s, (-h / 2) * s, w * s, h * s, Math.min(w, h) * s * 0.4);
    ctx.fill();
    if (dashed) {
      ctx.strokeStyle = theme.text;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  };
  const local = (bx: number, by: number, a: number, lx: number, ly: number): [number, number] => [
    bx + lx * Math.cos(a) - ly * Math.sin(a),
    by + lx * Math.sin(a) + ly * Math.cos(a),
  ];

  const drawLeg = (side: 0 | 1) => {
    const thigh = pose.legs[side * 2];
    const shin = pose.legs[side * 2 + 1];
    const len = view.shinLens[side];
    const color = side === 0 ? leftColor : rightColor;
    const weak = !ghost && side === 1 && config.weakRightLeg;
    piece(thigh.x, thigh.y, thigh.a, THIGH_W, THIGH_LEN, color, weak);
    piece(shin.x, shin.y, shin.a, SHIN_W, len, color, weak);
    // pied
    const [fx, fy] = local(shin.x, shin.y, shin.a, 0, -len / 2);
    ctx.beginPath();
    ctx.arc(X(fx), Y(fy), FOOT_R * s, 0, Math.PI * 2);
    ctx.fillStyle = !ghost && pose.contacts[side] ? theme.goal : color;
    ctx.fill();
    // genou
    const [kx, ky] = local(thigh.x, thigh.y, thigh.a, 0, -THIGH_LEN / 2);
    if (!ghost && side === 0 && config.lockLeftKnee) {
      const r = Math.max(5, 0.07 * s);
      ctx.fillStyle = theme.trap;
      roundRect(ctx, X(kx) - r, Y(ky) - r * 0.6, r * 2, r * 1.5, 2);
      ctx.fill();
      ctx.strokeStyle = theme.trap;
      ctx.lineWidth = Math.max(1.5, r * 0.3);
      ctx.beginPath();
      ctx.arc(X(kx), Y(ky) - r * 0.6, r * 0.6, Math.PI, 0);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(X(kx), Y(ky), Math.max(2.5, 0.035 * s), 0, Math.PI * 2);
      ctx.fillStyle = ghost ? theme.muted : theme.panel;
      ctx.fill();
    }
  };

  drawLeg(0);
  const hl = pose.hull;
  if (!ghost && config.heavyBackpack) {
    const [bx, by] = local(hl.x, hl.y, hl.a, -0.08, HULL_H / 2 + 0.09);
    piece(bx, by, hl.a, 0.34, 0.2, theme.series[3]);
  }
  piece(hl.x, hl.y, hl.a, HULL_W, HULL_H, hullColor);
  // « œil » à l'avant pour savoir dans quel sens il marche
  const [ex, ey] = local(hl.x, hl.y, hl.a, HULL_W * 0.32, HULL_H * 0.15);
  ctx.beginPath();
  ctx.arc(X(ex), Y(ey), Math.max(2, 0.03 * s), 0, Math.PI * 2);
  ctx.fillStyle = ghost ? theme.panel : theme.agent;
  ctx.fill();
  drawLeg(1);
  // hanche
  const [hx, hy] = local(hl.x, hl.y, hl.a, 0, -HULL_H / 2);
  ctx.beginPath();
  ctx.arc(X(hx), Y(hy), Math.max(2.5, 0.04 * s), 0, Math.PI * 2);
  ctx.fillStyle = ghost ? theme.muted : theme.panel;
  ctx.fill();
  ctx.restore();
}
