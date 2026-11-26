import './style.css';
import { ACTIONS, Cell, GridWorld, Trainer } from './rl';
import { DEFAULT_MAP, DEFAULT_SETTINGS, PRESETS, SLIDERS, Settings, speedToTiming } from './config';
import { drawChart } from './chart';

// ---------- État ----------
const settings: Settings = structuredClone(DEFAULT_SETTINGS);
const world = GridWorld.fromStrings(DEFAULT_MAP);
const trainer = new Trainer(world, settings);
trainer.params = settings; // l'agent lit les réglages en direct

let running = false;
let lastStepTime = 0;
let boardDirty = true;
let chartDirty = true;

if (new URLSearchParams(location.search).has('embed')) document.documentElement.classList.add('embed');

// ---------- Éléments ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const board = $<HTMLCanvasElement>('board');
const chart = $<HTMLCanvasElement>('chart');
const btnRun = $<HTMLButtonElement>('btn-run');
const statusEl = $('status');
const showArrows = $<HTMLInputElement>('show-arrows');
const showValues = $<HTMLInputElement>('show-values');
const showGreedy = $<HTMLInputElement>('show-greedy');

// ---------- Couleurs (relues si le thème change) ----------
let colors = readColors();
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    cell: v('--cell'), wall: v('--wall'), trap: v('--trap'), goal: v('--goal'), start: v('--start'),
    agent: v('--agent'), good: v('--good'), bad: v('--bad'), gridLine: v('--grid-line'),
    text: v('--text'), muted: v('--muted'), border: v('--border'),
    chartRaw: v('--chart-raw'), chartAvg: v('--chart-avg'),
  };
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  colors = readColors();
  boardDirty = chartDirty = true;
});

// ---------- Curseurs ----------
const sliderOutputs = new Map<string, { input: HTMLInputElement; output: HTMLOutputElement }>();

function buildSliders() {
  const container = $('sliders');
  for (const def of SLIDERS) {
    if (def.group) {
      const g = document.createElement('div');
      g.className = 'group-title';
      g.textContent = def.group;
      container.appendChild(g);
    }
    const wrap = document.createElement('div');
    wrap.className = 'slider';
    const inputId = `sl-${def.id}`;
    wrap.innerHTML = `
      <div class="slider-head"><label for="${inputId}">${def.label}</label><output for="${inputId}"></output></div>
      <input type="range" id="${inputId}" min="${def.min}" max="${def.max}" step="${def.step}" aria-describedby="${inputId}-help" />
      <p class="help" id="${inputId}-help">${def.help}</p>`;
    const input = wrap.querySelector('input')!;
    const output = wrap.querySelector('output')!;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      def.set(settings, v);
      output.textContent = def.format ? def.format(v) : v.toFixed(2);
      if (def.id === 'epsilon') trainer.epsilon = v; // effet immédiat
      if (def.id === 'episodes') updateStatus();
      if (def.id.startsWith('r')) boardDirty = true;
    });
    sliderOutputs.set(def.id, { input, output });
    container.appendChild(wrap);
  }
}

function syncSliders() {
  for (const def of SLIDERS) {
    const el = sliderOutputs.get(def.id)!;
    const v = def.get(settings);
    el.input.value = String(v);
    el.output.textContent = def.format ? def.format(v) : v.toFixed(2);
  }
  document.querySelectorAll<HTMLInputElement>('input[name="algo"]').forEach((r) => (r.checked = r.value === settings.algorithm));
  updateAlgoHelp();
}

// ---------- Algorithme ----------
function updateAlgoHelp() {
  $('algo-help').textContent =
    settings.algorithm === 'qlearning'
      ? 'Q-learning apprend en supposant qu’il jouera toujours au mieux ensuite : il trouve le chemin optimal, quitte à frôler les pièges.'
      : 'SARSA apprend à partir de ce qu’il fait vraiment, exploration comprise : il préfère souvent un chemin plus sûr, à distance des pièges.';
}
document.querySelectorAll<HTMLInputElement>('input[name="algo"]').forEach((radio) =>
  radio.addEventListener('change', () => {
    settings.algorithm = radio.value as Settings['algorithm'];
    updateAlgoHelp();
  }),
);

// ---------- Préréglages ----------
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((btn) =>
  btn.addEventListener('click', () => {
    const preset = PRESETS[btn.dataset.preset!];
    const { rewards, ...rest } = preset.settings;
    Object.assign(settings, rest);
    Object.assign(settings.rewards, DEFAULT_SETTINGS.rewards, rewards);
    document.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('active', b === btn));
    $('preset-info').innerHTML = `<strong>${preset.label}.</strong> ${preset.description}`;
    syncSliders();
    resetLearning();
  }),
);

// ---------- Contrôles ----------
function setRunning(on: boolean) {
  running = on && trainer.canRun() && !isFinished();
  btnRun.textContent = running ? 'Pause' : 'Démarrer';
  updateStatus();
}
function isFinished() {
  return trainer.episode >= settings.episodes;
}
btnRun.addEventListener('click', () => setRunning(!running));
$('btn-step').addEventListener('click', () => {
  setRunning(false);
  doStep();
});
$('btn-reset').addEventListener('click', () => {
  setRunning(false);
  resetLearning();
});
$('btn-map-default').addEventListener('click', () => {
  world.cells = GridWorld.fromStrings(DEFAULT_MAP).cells;
  resetLearning();
});
$('btn-map-clear').addEventListener('click', () => {
  world.cells = new Array<Cell>(world.nStates).fill('empty');
  world.setCell(0, 'start');
  world.setCell(world.nStates - 1, 'goal');
  resetLearning();
});
[showArrows, showValues, showGreedy].forEach((c) => c.addEventListener('change', () => (boardDirty = true)));

function resetLearning() {
  trainer.reset();
  setRunning(false);
  boardDirty = chartDirty = true;
  updateStats();
}

function doStep() {
  const info = trainer.step();
  if (!info) {
    updateStatus();
    return;
  }
  boardDirty = true;
  if (info.episodeEnded) {
    chartDirty = true;
    if (isFinished()) setRunning(false);
  }
}

function updateStatus() {
  let msg = '';
  if (world.startState() < 0) msg = 'Placez une case Départ pour commencer.';
  else if (!world.hasGoal()) msg = 'Placez au moins une case Arrivée.';
  else if (isFinished())
    msg = `Entraînement terminé (${trainer.episode} épisodes). Augmentez le nombre d’épisodes pour continuer, ou réinitialisez.`;
  else if (running) msg = 'L’agent apprend…';
  else if (trainer.episode === 0 && trainer.totalSteps === 0) msg = 'Prêt. Cliquez sur « Démarrer » ou « Pas à pas ».';
  else msg = 'En pause.';
  statusEl.textContent = msg;
}

function updateStats() {
  $('st-episode').textContent = `${trainer.episode} / ${settings.episodes}`;
  $('st-step').textContent = String(trainer.stepInEpisode);
  $('st-eps').textContent = trainer.epsilon.toFixed(2);
  const last = trainer.history[trainer.history.length - 1];
  $('st-last').textContent = last === undefined ? '–' : last.toFixed(1);
}

// ---------- Édition de la grille ----------
let painting = false;
let lastPainted = -1;

function cellFromEvent(e: PointerEvent): number {
  const rect = board.getBoundingClientRect();
  const col = Math.floor(((e.clientX - rect.left) / rect.width) * world.size);
  const row = Math.floor(((e.clientY - rect.top) / rect.height) * world.size);
  if (row < 0 || col < 0 || row >= world.size || col >= world.size) return -1;
  return world.index(row, col);
}

function paint(s: number) {
  if (s < 0 || s === lastPainted) return;
  lastPainted = s;
  const tool = (document.querySelector('input[name="tool"]:checked') as HTMLInputElement).value as Cell;
  world.setCell(s, tool);
  // La grille a changé : on garde ce qui a été appris, mais on relance l'épisode en cours.
  trainer.startEpisode();
  boardDirty = true;
  updateStatus();
}

board.addEventListener('pointerdown', (e) => {
  painting = true;
  lastPainted = -1;
  board.setPointerCapture(e.pointerId);
  paint(cellFromEvent(e));
});
board.addEventListener('pointermove', (e) => {
  if (painting) paint(cellFromEvent(e));
});
const stopPaint = () => {
  painting = false;
};
board.addEventListener('pointerup', stopPaint);
board.addEventListener('pointercancel', stopPaint);

// ---------- Rendu de la grille ----------
function resizeCanvas(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return dpr;
}

function drawBoard() {
  const dpr = resizeCanvas(board);
  const ctx = board.getContext('2d')!;
  const size = board.clientWidth;
  const n = world.size;
  const cs = size / n;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  // Échelle des couleurs : plus grande valeur absolue parmi les cases non terminales
  let maxAbs = 1e-9;
  for (let s = 0; s < world.nStates; s++) {
    if (world.cells[s] === 'wall' || world.isTerminal(s) || !trainer.visited(s)) continue;
    maxAbs = Math.max(maxAbs, Math.abs(trainer.value(s)));
  }

  for (let s = 0; s < world.nStates; s++) {
    const [r, c] = world.rowCol(s);
    const x = c * cs;
    const y = r * cs;
    const cell = world.cells[s];
    ctx.fillStyle =
      cell === 'wall' ? colors.wall : cell === 'trap' ? colors.trap : cell === 'goal' ? colors.goal : colors.cell;
    ctx.fillRect(x, y, cs, cs);

    if ((cell === 'empty' || cell === 'start') && trainer.visited(s)) {
      const v = trainer.value(s);
      const t = Math.min(1, Math.abs(v) / maxAbs);
      ctx.fillStyle = `rgba(${v >= 0 ? colors.good : colors.bad}, ${0.12 + 0.6 * t})`;
      ctx.fillRect(x, y, cs, cs);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (cell === 'goal' || cell === 'trap') {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${cs * 0.5}px system-ui, sans-serif`;
      ctx.fillText(cell === 'goal' ? '★' : '✕', x + cs / 2, y + cs / 2 + cs * 0.02);
    } else if (cell === 'start') {
      ctx.strokeStyle = colors.start;
      ctx.lineWidth = Math.max(2, cs * 0.07);
      ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, cs - ctx.lineWidth, cs - ctx.lineWidth);
      ctx.fillStyle = colors.start;
      ctx.font = `bold ${cs * 0.22}px system-ui, sans-serif`;
      ctx.fillText('D', x + cs * 0.18, y + cs * 0.2);
    }

    if ((cell === 'empty' || cell === 'start') && trainer.visited(s)) {
      // Si les valeurs sont affichées en bas de case, on remonte la flèche
      if (showArrows.checked) drawArrow(ctx, x, showValues.checked ? y - cs * 0.1 : y, cs, trainer.greedyAction(s));
      if (showValues.checked) {
        ctx.fillStyle = colors.text;
        ctx.font = `${cs * 0.2}px system-ui, sans-serif`;
        ctx.fillText(trainer.value(s).toFixed(1), x + cs / 2, y + cs * 0.84);
      }
    }
  }

  // Lignes de grille
  ctx.strokeStyle = colors.gridLine;
  ctx.lineWidth = 1.5;
  for (let i = 1; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cs, 0);
    ctx.lineTo(i * cs, size);
    ctx.moveTo(0, i * cs);
    ctx.lineTo(size, i * cs);
    ctx.stroke();
  }

  const center = (s: number): [number, number] => {
    const [r, c] = world.rowCol(s);
    return [c * cs + cs / 2, r * cs + cs / 2];
  };

  // Meilleur chemin appris (pointillés)
  if (showGreedy.checked && trainer.episode > 0) {
    const path = trainer.greedyPath();
    if (path.length > 1) {
      ctx.strokeStyle = colors.start;
      ctx.lineWidth = Math.max(2, cs * 0.06);
      ctx.setLineDash([cs * 0.12, cs * 0.1]);
      ctx.beginPath();
      path.forEach((s, i) => (i === 0 ? ctx.moveTo(...center(s)) : ctx.lineTo(...center(s))));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

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
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ax, ay, cs * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, cs: number, a: number) {
  const { dr, dc } = ACTIONS[a];
  const cx = x + cs / 2;
  const cy = y + cs / 2;
  const len = cs * (showValues.checked ? 0.22 : 0.28);
  const tipX = cx + dc * len;
  const tipY = cy + dr * len;
  const backX = cx - dc * len * 0.6;
  const backY = cy - dr * len * 0.6;
  const head = cs * 0.13;
  ctx.strokeStyle = ctx.fillStyle = colors.text;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = Math.max(1.5, cs * 0.045);
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

// ---------- Boucle d'animation ----------
function frame(now: number) {
  if (running) {
    const { delay, stepsPerFrame } = speedToTiming(settings.speed);
    if (delay === 0 || now - lastStepTime >= delay) {
      lastStepTime = now;
      for (let i = 0; i < stepsPerFrame && running; i++) doStep();
    }
  }
  if (boardDirty) {
    drawBoard();
    updateStats();
    boardDirty = false;
  }
  if (chartDirty) {
    drawChart(chart, trainer.history, { raw: colors.chartRaw, avg: colors.chartAvg, axis: colors.border, text: colors.muted });
    chartDirty = false;
  }
  requestAnimationFrame(frame);
}

new ResizeObserver(() => (boardDirty = chartDirty = true)).observe(document.body);

buildSliders();
syncSliders();
updateStats();
updateStatus();
requestAnimationFrame(frame);
