import './style.css';
import { Cell, GridWorld, Trainer } from './rl';
import {
  DEFAULT_MAP,
  DEFAULT_SETTINGS,
  PRESETS,
  SCENARIOS,
  SLIDERS,
  Settings,
  scenarioSettings,
  speedToTiming,
} from './config';
import { TRAITS, detectLevel } from './personality';
import { BoardColors, BoardOptions, drawBoard, readBoardColors } from './draw';
import { drawChart, movingAverage } from '../../shared/chart';
import { onThemeChange, onResize } from '../../shared/ui';
import { TEMPLATE } from './template';

export function mount(root: HTMLElement): () => void {
  root.innerHTML = TEMPLATE;
  const disposers: Array<() => void> = [];

  // ---------- État ----------
  const settings: Settings = structuredClone(DEFAULT_SETTINGS);
  const world = GridWorld.fromStrings(DEFAULT_MAP);
  const trainer = new Trainer(world, settings);
  trainer.params = settings; // l'agent lit les réglages en direct

  // Comparaison : deux agents sur la même carte, mêmes réglages, algorithme imposé.
  const cmpParams = (algorithm: Settings['algorithm']): Settings => ({ ...settings, rewards: settings.rewards, algorithm });
  const cmpQ = new Trainer(world, cmpParams('qlearning'));
  const cmpS = new Trainer(world, cmpParams('sarsa'));
  const syncCmpParams = () => {
    cmpQ.params = cmpParams('qlearning');
    cmpS.params = cmpParams('sarsa');
  };

  let running = false;
  let cmpRunning = false;
  let lastStepTime = 0;
  let lastCmpStepTime = 0;
  let boardDirty = true;
  let chartDirty = true;
  let cmpDirty = true;

  // ---------- Éléments (toujours cherchés dans root) ----------
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector(`#grid-${id}`) as T;
  const board = $<HTMLCanvasElement>('board');
  const chart = $<HTMLCanvasElement>('chart');
  const btnRun = $<HTMLButtonElement>('btn-run');
  const statusEl = $('status');
  const showArrows = $<HTMLInputElement>('show-arrows');
  const showValues = $<HTMLInputElement>('show-values');
  const showGreedy = $<HTMLInputElement>('show-greedy');
  const cmpBoardQ = $<HTMLCanvasElement>('cmp-q');
  const cmpBoardS = $<HTMLCanvasElement>('cmp-s');
  const cmpChart = $<HTMLCanvasElement>('cmp-chart');
  const cmpRunBtn = $<HTMLButtonElement>('cmp-run');

  // ---------- Couleurs (relues si le thème change) ----------
  let colors: BoardColors = readBoardColors();
  disposers.push(
    onThemeChange(() => {
      colors = readBoardColors();
      boardDirty = chartDirty = cmpDirty = true;
    }),
  );

  // ---------- Paramètres experts (curseurs) ----------
  const sliderEls = new Map<string, { input: HTMLInputElement; output: HTMLOutputElement }>();

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
      const inputId = `grid-sl-${def.id}`;
      wrap.innerHTML = `
        <div class="slider-head"><label for="${inputId}"></label><output for="${inputId}"></output></div>
        <input type="range" id="${inputId}" min="${def.min}" max="${def.max}" step="${def.step}" aria-describedby="${inputId}-help" />
        <p class="help" id="${inputId}-help"></p>`;
      wrap.querySelector('label')!.textContent = def.label;
      wrap.querySelector('.help')!.textContent = def.help;
      const input = wrap.querySelector('input')!;
      const output = wrap.querySelector('output')!;
      input.addEventListener('input', () => {
        const v = Number(input.value);
        def.set(settings, v);
        output.textContent = def.format ? def.format(v) : v.toFixed(2);
        if (def.id === 'epsilon') setEpsilonNow(v); // effet immédiat
        if (def.id === 'episodes') updateStatus();
        if (def.id.startsWith('r')) boardDirty = cmpDirty = true;
        onSettingsChanged();
      });
      sliderEls.set(def.id, { input, output });
      container.appendChild(wrap);
    }
  }

  function syncSliders() {
    for (const def of SLIDERS) {
      const el = sliderEls.get(def.id)!;
      const v = def.get(settings);
      el.input.value = String(v);
      el.output.textContent = def.format ? def.format(v) : v.toFixed(2);
    }
    root.querySelectorAll<HTMLInputElement>('input[name="grid-algo"]').forEach((r) => (r.checked = r.value === settings.algorithm));
    updateAlgoHelp();
  }

  function setEpsilonNow(v: number) {
    trainer.epsilon = v;
    cmpQ.epsilon = v;
    cmpS.epsilon = v;
  }

  /** À appeler après tout changement de réglage. */
  function onSettingsChanged() {
    syncCmpParams();
    refreshTraits();
    updateStats();
  }

  // ---------- Algorithme ----------
  function updateAlgoHelp() {
    $('algo-help').textContent =
      settings.algorithm === 'qlearning'
        ? 'Q-learning apprend en supposant qu’il jouera toujours au mieux ensuite : il trouve le chemin optimal, quitte à frôler les pièges.'
        : 'SARSA apprend à partir de ce qu’il fait vraiment, exploration comprise : il préfère souvent un chemin plus sûr, à distance des pièges.';
  }
  root.querySelectorAll<HTMLInputElement>('input[name="grid-algo"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      settings.algorithm = radio.value as Settings['algorithm'];
      updateAlgoHelp();
      onSettingsChanged();
    }),
  );

  // ---------- Personnalité (traits haut niveau) ----------
  interface TraitUI {
    output: HTMLOutputElement;
    mapping: HTMLElement;
    buttons?: HTMLButtonElement[];
    range?: HTMLInputElement;
  }
  const traitUIs = new Map<string, TraitUI>();

  function buildTraits() {
    const container = $('traits');
    for (const trait of TRAITS) {
      const id = `grid-trait-${trait.id}`;
      const wrap = document.createElement('div');
      wrap.className = 'grid-trait';
      wrap.innerHTML = `
        <div class="slider-head"><span class="grid-trait-name" id="${id}-label"></span><output id="${id}-out" aria-live="polite"></output></div>
        <div class="grid-trait-control"></div>
        <p class="help" id="${id}-help"></p>
        <p class="grid-mapping" id="${id}-map"></p>`;
      wrap.querySelector('.grid-trait-name')!.textContent = trait.label;
      wrap.querySelector('.help')!.textContent = trait.help;
      const ctrl = wrap.querySelector('.grid-trait-control')!;
      const ui: TraitUI = { output: wrap.querySelector('output')!, mapping: wrap.querySelector('.grid-mapping')! };

      if (trait.kind === 'segmented') {
        const seg = document.createElement('div');
        seg.className = 'segmented grid-seg';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-labelledby', `${id}-label`);
        ui.buttons = trait.levels.map((level, i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = level.label;
          b.addEventListener('click', () => applyTrait(trait.id, i));
          seg.appendChild(b);
          return b;
        });
        ctrl.appendChild(seg);
      } else {
        const range = document.createElement('input');
        range.type = 'range';
        range.min = '0';
        range.max = String(trait.levels.length - 1);
        range.step = '1';
        range.id = `${id}-range`;
        range.setAttribute('aria-labelledby', `${id}-label`);
        range.setAttribute('aria-describedby', `${id}-help ${id}-map`);
        range.addEventListener('input', () => applyTrait(trait.id, Number(range.value)));
        const ends = document.createElement('div');
        ends.className = 'grid-ends';
        ends.innerHTML = '<span></span><span></span>';
        ends.children[0].textContent = trait.ends?.[0] ?? '';
        ends.children[1].textContent = trait.ends?.[1] ?? '';
        ctrl.append(range, ends);
        ui.range = range;
      }
      traitUIs.set(trait.id, ui);
      container.appendChild(wrap);
    }
  }

  function applyTrait(id: string, level: number) {
    const trait = TRAITS.find((t) => t.id === id)!;
    trait.levels[level].apply(settings);
    if (id === 'curiosity') setEpsilonNow(settings.epsilon); // la curiosité repart de son niveau de départ
    if (id === 'prudence' || id === 'impatience') boardDirty = cmpDirty = true;
    syncSliders();
    onSettingsChanged();
    markPresetsCustom();
  }

  function refreshTraits() {
    for (const trait of TRAITS) {
      const ui = traitUIs.get(trait.id)!;
      const lvl = detectLevel(trait, settings);
      ui.output.textContent = lvl >= 0 ? trait.levels[lvl].label : 'personnalisé';
      ui.output.classList.toggle('grid-custom', lvl < 0);
      ui.mapping.textContent = `→ ce que ça change : ${trait.describe(settings)}${lvl < 0 ? ' (réglé à la main dans les paramètres experts)' : ''}`;
      ui.buttons?.forEach((b, i) => {
        b.classList.toggle('active', i === lvl);
        b.setAttribute('aria-pressed', String(i === lvl));
      });
      if (ui.range && lvl >= 0) ui.range.value = String(lvl);
      ui.range?.classList.toggle('grid-range-custom', lvl < 0);
    }
  }

  // ---------- Scénarios et expériences ----------
  function markPresetsCustom() {
    // Les boutons restent indicatifs : un réglage modifié à la main n'est plus « le » préréglage.
    root.querySelectorAll('#grid-presets button').forEach((b) => b.classList.remove('active'));
  }

  function buildScenarioButtons() {
    const box = $('scenarios');
    for (const [key, sc] of Object.entries(SCENARIOS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = sc.label;
      b.dataset.scenario = key;
      b.addEventListener('click', () => {
        Object.assign(settings, scenarioSettings(sc, settings));
        world.cells = GridWorld.fromStrings(sc.map).cells;
        box.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        markPresetsCustom();
        const info = $('scenario-info');
        info.replaceChildren();
        const strong = document.createElement('strong');
        strong.textContent = `${sc.label}. `;
        info.append(strong, sc.description);
        syncSliders();
        setEpsilonNow(settings.epsilon);
        onSettingsChanged();
        resetLearning();
        resetCompare();
      });
      box.appendChild(b);
    }
  }

  function buildPresetButtons() {
    const box = $('presets');
    for (const [key, preset] of Object.entries(PRESETS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = preset.label;
      b.dataset.preset = key;
      b.addEventListener('click', () => {
        const { rewards, ...rest } = preset.settings;
        Object.assign(settings, rest);
        Object.assign(settings.rewards, DEFAULT_SETTINGS.rewards, rewards);
        box.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        const info = $('preset-info');
        info.replaceChildren();
        const strong = document.createElement('strong');
        strong.textContent = `${preset.label}. `;
        info.append(strong, preset.description);
        syncSliders();
        onSettingsChanged();
        resetLearning();
        resetCompare();
        b.classList.add('active');
      });
      box.appendChild(b);
    }
  }

  // ---------- Contrôles ----------
  function isFinished() {
    return trainer.episode >= settings.episodes;
  }
  function setRunning(on: boolean) {
    running = on && trainer.canRun() && !isFinished();
    btnRun.textContent = running ? 'Pause' : 'Démarrer';
    updateStatus();
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
    clearScenarioHighlight();
    resetLearning();
    resetCompare();
  });
  $('btn-map-clear').addEventListener('click', () => {
    world.cells = new Array<Cell>(world.nStates).fill('empty');
    world.setCell(0, 'start');
    world.setCell(world.nStates - 1, 'goal');
    clearScenarioHighlight();
    resetLearning();
    resetCompare();
  });
  [showArrows, showValues, showGreedy].forEach((c) => c.addEventListener('change', () => (boardDirty = true)));

  function clearScenarioHighlight() {
    root.querySelectorAll('#grid-scenarios button').forEach((b) => b.classList.remove('active'));
  }

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
    else if (!world.hasGoal()) msg = 'Placez au moins un trésor (grand ou petit).';
    else if (isFinished())
      msg = `Entraînement terminé (${trainer.episode} épisodes). Augmentez le nombre d’épisodes (paramètres experts) pour continuer, ou réinitialisez.`;
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

  // ---------- Comparaison ----------
  function cmpFinished() {
    return cmpQ.episode >= settings.episodes && cmpS.episode >= settings.episodes;
  }
  function setCmpRunning(on: boolean) {
    cmpRunning = on && cmpQ.canRun() && !cmpFinished();
    cmpRunBtn.textContent = cmpRunning ? 'Pause' : cmpQ.episode > 0 ? 'Reprendre' : 'Comparer';
    updateCmpStatus();
  }
  cmpRunBtn.addEventListener('click', () => setCmpRunning(!cmpRunning));
  $('cmp-reset').addEventListener('click', resetCompare);

  function resetCompare() {
    syncCmpParams();
    cmpQ.reset();
    cmpS.reset();
    setCmpRunning(false);
    cmpDirty = true;
    updateCmpInfo();
  }

  function cmpStep() {
    let ended = false;
    for (const t of [cmpQ, cmpS]) {
      if (t.episode >= settings.episodes) continue;
      const info = t.step();
      if (info?.episodeEnded) ended = true;
    }
    cmpDirty = true;
    if (ended) {
      updateCmpInfo();
      if (cmpFinished()) setCmpRunning(false);
    }
  }

  function describeGreedy(t: Trainer): string {
    if (t.episode === 0) return 'Pas encore d’épisode.';
    const path = t.greedyPath();
    const end = world.cells[path[path.length - 1]];
    const last = t.history.slice(-20);
    const avg = last.reduce((a, b) => a + b, 0) / Math.max(1, last.length);
    const avgTxt = `moyenne récente ${avg.toFixed(1).replace('.', ',').replace('-', '−')}`;
    const target =
      end === 'goal' ? `meilleur chemin : ${path.length - 1} pas jusqu’au ★` :
      end === 'bonus' ? `meilleur chemin : ${path.length - 1} pas jusqu’au petit trésor` :
      end === 'trap' ? 'meilleur chemin : finit dans un piège' : 'meilleur chemin : pas encore trouvé';
    return `${t.episode} épisodes · ${target} · ${avgTxt}`;
  }
  function updateCmpInfo() {
    $('cmp-q-info').textContent = describeGreedy(cmpQ);
    $('cmp-s-info').textContent = describeGreedy(cmpS);
  }
  function updateCmpStatus() {
    let msg: string;
    if (!cmpQ.canRun()) msg = 'La carte doit avoir un départ et au moins un trésor.';
    else if (cmpFinished()) msg = `Comparaison terminée (${settings.episodes} épisodes chacun). Comparez les pointillés : par où passe chaque agent ?`;
    else if (cmpRunning) msg = 'Les deux agents apprennent en parallèle…';
    else if (cmpQ.episode === 0) msg = 'Cliquez sur « Comparer » pour lancer les deux agents en même temps.';
    else msg = 'Comparaison en pause.';
    $('cmp-status').textContent = msg;
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
    const checked = root.querySelector('input[name="grid-tool"]:checked') as HTMLInputElement | null;
    const tool = (checked?.value ?? 'wall') as Cell;
    world.setCell(s, tool);
    // La grille a changé : on garde ce qui a été appris, mais on relance l'épisode en cours.
    trainer.startEpisode();
    cmpQ.startEpisode();
    cmpS.startEpisode();
    clearScenarioHighlight();
    boardDirty = cmpDirty = true;
    updateStatus();
    updateCmpStatus();
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

  // ---------- Boucle d'animation ----------
  const mainOpts = (): BoardOptions => ({
    arrows: showArrows.checked,
    values: showValues.checked,
    greedy: showGreedy.checked,
    agent: true,
  });
  const cmpOpts: BoardOptions = { arrows: true, values: false, greedy: true, agent: true };

  let rafId = 0;
  let alive = true;
  function frame(now: number) {
    if (!alive) return;
    const { delay, stepsPerFrame } = speedToTiming(settings.speed);
    if (running && (delay === 0 || now - lastStepTime >= delay)) {
      lastStepTime = now;
      for (let i = 0; i < stepsPerFrame && running; i++) doStep();
    }
    if (cmpRunning && (delay === 0 || now - lastCmpStepTime >= delay)) {
      lastCmpStepTime = now;
      for (let i = 0; i < stepsPerFrame && cmpRunning; i++) cmpStep();
    }
    if (boardDirty) {
      drawBoard(board, world, trainer, colors, mainOpts());
      updateStats();
      boardDirty = false;
    }
    if (chartDirty) {
      drawChart(chart, trainer.history, { raw: colors.chartRaw, avg: colors.chartAvg, axis: colors.border, text: colors.muted });
      chartDirty = false;
    }
    if (cmpDirty) {
      drawBoard(cmpBoardQ, world, cmpQ, colors, cmpOpts);
      drawBoard(cmpBoardS, world, cmpS, colors, cmpOpts);
      drawChart(cmpChart, [], { raw: colors.chartRaw, avg: colors.chartAvg, axis: colors.border, text: colors.muted }, {
        showRaw: false,
        emptyText: 'Lancez la comparaison pour voir les deux courbes',
        extra: [
          { values: movingAverage(cmpQ.history, 20), color: colors.series[0], label: 'Q-learning' },
          { values: movingAverage(cmpS.history, 20), color: colors.series[1], label: 'SARSA' },
        ],
      });
      cmpDirty = false;
    }
    rafId = requestAnimationFrame(frame);
  }

  disposers.push(onResize(root, () => (boardDirty = chartDirty = cmpDirty = true)));

  buildTraits();
  buildScenarioButtons();
  buildPresetButtons();
  buildSliders();
  syncSliders();
  onSettingsChanged();
  updateStatus();
  updateCmpInfo();
  updateCmpStatus();
  rafId = requestAnimationFrame(frame);
  disposers.push(() => cancelAnimationFrame(rafId));

  return () => {
    alive = false;
    running = false;
    cmpRunning = false;
    disposers.forEach((d) => d());
  };
}
