import './style.css';
import { TEMPLATE } from './template';
import {
  CURIOSITY_LEVELS,
  FALL_LEVELS,
  INTERVENTIONS,
  Level,
  PRIORITY_LEVELS,
  SCENARIOS,
  Settings,
  UPRIGHT_LEVELS,
  BrainSource,
  defaultSettings,
  fmt,
  isHealthy,
  worldLabel,
} from './config';
import { DT, EPISODE_SECONDS, HEALTHY, OBS_SIZE, Walker, WorldConfig } from './env';
import { BrainJSON, policyFromParams, randomParams } from './agent';
import { TrainerPool, GenerationSummary } from './pool';
import { RobotView, drawStage } from './draw';
import { drawChart } from '../../shared/chart';
import { createSlider, onResize, onThemeChange, prepareCanvas, rafLoop, readTheme } from '../../shared/ui';
import healthyJSON from './pretrained/healthy.json';
import injuredJSON from './pretrained/injured.json';

const PRETRAINED: Record<'healthy' | 'injured', BrainJSON> = {
  healthy: healthyJSON as BrainJSON,
  injured: injuredJSON as BrainJSON,
};
/** Arrêt automatique (évite de faire chauffer la machine indéfiniment). */
const MAX_GENERATIONS = 1500;
/** Pause entre deux essais rediffusés (ms). */
const HOLD_MS = 1600;

interface Champion {
  params: Float64Array;
  source: BrainSource | 'learned';
  /** Génération d'où vient ce cerveau (cerveaux appris ici). */
  gen: number;
}

interface Measure {
  key: string;
  label: string;
  distance: number;
  time: number;
  energy: number;
  fell: boolean;
  at: number;
}

export function mount(root: HTMLElement): () => void {
  root.innerHTML = TEMPLATE;
  const disposers: Array<() => void> = [];
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector(`#walker-${id}`) as T;

  const settings: Settings = defaultSettings();
  let config: WorldConfig = { ...HEALTHY };
  let theme = readTheme();
  let chartDirty = true;
  disposers.push(
    onThemeChange(() => {
      theme = readTheme();
      chartDirty = true;
    }),
  );

  const brainParams = (src: BrainSource): Float64Array =>
    src === 'random' ? randomParams((Date.now() & 0xffff) + 1) : Float64Array.from(PRETRAINED[src].params);

  let champion: Champion = { params: brainParams('healthy'), source: 'healthy', gen: 0 };
  /** Le cerveau sain, pour le fantôme. */
  const ghostParams = Float64Array.from(PRETRAINED.healthy.params);

  // ---------------------------------------------------------------------------
  // Entraînement (workers)
  // ---------------------------------------------------------------------------
  const nWorkers = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  let workerFailed = false;
  const meanFit: number[] = [];
  const bestFit: number[] = [];
  const meanDist: number[] = [];
  const bestDist: number[] = [];
  let record = -Infinity;
  let lastGenMs = 0;
  let generation = 0;
  let runStarted = false;
  let seedCounter = 1;

  const pool = new TrainerPool(nWorkers, onGeneration, () => {
    workerFailed = true;
    updateButtons();
    updateStatus();
  });
  disposers.push(() => pool.dispose());

  function onGeneration(s: GenerationSummary) {
    generation = s.generation;
    lastGenMs = s.ms;
    meanFit.push(s.meanFitness);
    bestFit.push(Math.max(s.best.fitness, s.theta.fitness));
    meanDist.push(s.meanDistance);
    bestDist.push(Math.max(s.best.distance, s.theta.distance));
    // Le cerveau affiché = le meilleur jamais vu pendant cet apprentissage (l'évaluation est déterministe).
    const cand = s.theta.fitness >= s.best.fitness ? { r: s.theta, p: s.thetaParams } : { r: s.best, p: s.bestParams };
    if (cand.r.fitness > record) {
      record = cand.r.fitness;
      champion = { params: Float64Array.from(cand.p), source: 'learned', gen: s.generation };
    }
    if (generation >= MAX_GENERATIONS) setTraining(false);
    chartDirty = true;
    updateStats();
    updateStatus();
  }

  /** Démarre (ou redémarre) l'évolution à partir d'un cerveau. */
  function startRun(init: Float64Array) {
    meanFit.length = bestFit.length = meanDist.length = bestDist.length = 0;
    record = -Infinity;
    generation = 0;
    runStarted = true;
    pool.start(init, config, settings.objectives, settings.es, 1000 + seedCounter++);
    chartDirty = true;
  }

  function setTraining(on: boolean) {
    if (on && !runStarted) startRun(champion.params);
    pool.setRunning(on && generation < MAX_GENERATIONS);
    updateButtons();
    updateStatus();
  }

  const btnRun = $<HTMLButtonElement>('btn-run');
  const btnAdapt = $<HTMLButtonElement>('btn-adapt');
  const btnScratch = $<HTMLButtonElement>('btn-scratch');
  btnRun.addEventListener('click', () => {
    clearScenario();
    setTraining(!pool.isRunning);
  });
  btnAdapt.addEventListener('click', () => {
    clearScenario();
    startRun(champion.params);
    setTraining(true);
  });
  btnScratch.addEventListener('click', () => {
    clearScenario();
    champion = { params: brainParams('random'), source: 'random', gen: 0 };
    startRun(champion.params);
    restartReplay();
    setTraining(true);
  });

  function updateButtons() {
    const running = pool.isRunning;
    btnRun.textContent = running ? 'Pause' : runStarted && generation > 0 ? 'Reprendre' : 'Apprendre';
    btnRun.classList.toggle('active', running);
    [btnRun, btnAdapt, btnScratch].forEach((b) => (b.disabled = workerFailed));
  }

  // ---------------------------------------------------------------------------
  // Rediffusion animée du cerveau affiché (+ fantôme)
  // ---------------------------------------------------------------------------
  const stage = $<HTMLCanvasElement>('stage');
  let replay: { walker: Walker; policy: ReturnType<typeof policyFromParams>; champion: Champion } | null = null;
  let ghost: { walker: Walker; policy: ReturnType<typeof policyFromParams> } | null = null;
  let holdUntil = 0;
  let acc = 0;
  let lastNow = 0;
  let camX = 0;
  const obs = new Float64Array(OBS_SIZE);
  const ghostObs = new Float64Array(OBS_SIZE);
  const measures: Measure[] = [];
  let lastResult: { distance: number; time: number; energy: number; fell: boolean } | null = null;

  function ghostWanted(): boolean {
    return settings.ghost && !(isHealthy(config) && champion.source === 'healthy');
  }

  function restartReplay() {
    replay = { walker: new Walker(config), policy: policyFromParams(champion.params), champion };
    ghost = ghostWanted() ? { walker: new Walker(HEALTHY), policy: policyFromParams(ghostParams) } : null;
    holdUntil = 0;
    acc = 0;
    camX = 0;
  }

  function brainLabel(c: Champion): string {
    if (c.source === 'healthy') return 'cerveau sain';
    if (c.source === 'injured') return 'cerveau adapté au genou';
    if (c.source === 'random') return 'cerveau au hasard';
    return `appris ici (gén. ${c.gen})`;
  }

  function recordMeasure(w: Walker, c: Champion) {
    const label = `${brainLabel(c)} · ${worldLabel(w.config)}`;
    // Un seul cerveau « appris ici » par monde : le plus récent remplace les précédents.
    const key = `${c.source}|${worldLabel(w.config)}`;
    const m: Measure = { key, label, distance: w.distance, time: w.time, energy: w.energy, fell: w.fell, at: performance.now() };
    const i = measures.findIndex((x) => x.key === key);
    if (i >= 0) measures.splice(i, 1);
    measures.unshift(m);
    measures.length = Math.min(measures.length, 8);
    renderMeasures();
  }

  function renderMeasures() {
    const tb = $('measures');
    tb.replaceChildren();
    if (!measures.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="4" class="walker-empty">Aucun essai terminé pour l’instant.</td>';
      tb.appendChild(tr);
      return;
    }
    for (const m of measures) {
      const tr = document.createElement('tr');
      const cells = [
        m.label,
        `${fmt(m.distance, 2)} m${m.fell ? ' (chute)' : ''}`,
        `${fmt(m.distance / Math.max(m.time, DT), 2)} m/s`,
        `${fmt(m.energy, 0)} J`,
      ];
      cells.forEach((t, i) => {
        const td = document.createElement('td');
        td.textContent = t;
        if (i === 1 && m.fell) td.classList.add('walker-bad');
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    }
  }

  function stepReplay() {
    if (!replay) return;
    const w = replay.walker;
    if (!w.done) {
      w.step(replay.policy.act(w.observe(obs)));
      if (w.done) {
        lastResult = { distance: w.distance, time: w.time, energy: w.energy, fell: w.fell };
        recordMeasure(w, replay.champion);
        holdUntil = performance.now() + HOLD_MS;
        updateStats();
      }
    }
    if (ghost && !ghost.walker.done) ghost.walker.step(ghost.policy.act(ghost.walker.observe(ghostObs)));
  }

  function frame(now: number) {
    const dtReal = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
    lastNow = now;
    if (!replay) restartReplay();
    if (replay!.walker.done) {
      if (now >= holdUntil) restartReplay();
    } else {
      acc += dtReal * settings.replaySpeed;
      let n = 0;
      while (acc >= DT && n < 12) {
        stepReplay();
        acc -= DT;
        n++;
        if (replay!.walker.done) break;
      }
      if (n >= 12) acc = 0;
    }
    draw();
  }

  function draw() {
    const { ctx, w, h } = prepareCanvas(stage);
    if (w === 0 || h === 0 || !replay) return;
    const wk = replay.walker;
    const target = wk.x + 0.4;
    camX += (target - camX) * 0.12;
    const view: RobotView = { pose: wk.pose(), config: wk.config, shinLens: [wk.shinLength(0), wk.shinLength(1)] };
    const gv: RobotView | null = ghost
      ? { pose: ghost.walker.pose(), config: ghost.walker.config, shinLens: [ghost.walker.shinLength(0), ghost.walker.shinLength(1)] }
      : null;
    const t = wk.time;
    const lines = [`${fmt(wk.distance, 2)} m · ${fmt(t, 1)} s / ${EPISODE_SECONDS} s`, brainLabel(replay.champion)];
    const right = [worldLabel(wk.config)];
    if (ghost) right.push(`fantôme : ${fmt(ghost.walker.distance, 2)} m`);
    let banner: { text: string; bad: boolean } | null = null;
    if (wk.done) {
      banner = wk.fell
        ? { text: `Chute après ${fmt(wk.time, 1)} s, à ${fmt(wk.distance, 2)} m`, bad: true }
        : { text: `${fmt(wk.distance, 2)} m en ${EPISODE_SECONDS} s (${fmt(wk.distance / wk.time, 2)} m/s)`, bad: false };
    }
    drawStage(ctx, w, h, theme, { x: camX }, view, gv, { lines, right, banner });
  }

  disposers.push(rafLoop(frame));
  $('btn-replay').addEventListener('click', () => restartReplay());

  const ghostBox = $<HTMLInputElement>('ghost');
  ghostBox.addEventListener('change', () => {
    settings.ghost = ghostBox.checked;
    restartReplay();
  });

  const speedBox = $('speed');
  const speeds = [0.5, 1, 2, 4];
  const speedBtns = speeds.map((v) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `×${String(v).replace('.', ',')}`;
    b.setAttribute('aria-label', `Vitesse de lecture ${String(v).replace('.', ',')} fois`);
    b.addEventListener('click', () => {
      settings.replaySpeed = v;
      refreshSpeed();
    });
    speedBox.appendChild(b);
    return b;
  });
  function refreshSpeed() {
    speedBtns.forEach((b, i) => {
      const on = speeds[i] === settings.replaySpeed;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  refreshSpeed();

  // ---------------------------------------------------------------------------
  // Scénarios
  // ---------------------------------------------------------------------------
  let scenarioKey: string | null = null;
  const scenarioBox = $('scenarios');
  const scenarioInfo = $('scenario-info');
  const scenarioBtns = Object.entries(SCENARIOS).map(([key, sc]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = sc.label;
    b.addEventListener('click', () => applyScenario(key));
    scenarioBox.appendChild(b);
    return { key, b };
  });

  function applyScenario(key: string) {
    const sc = SCENARIOS[key];
    scenarioKey = key;
    pool.setRunning(false);
    config = { ...sc.config };
    champion = { params: brainParams(sc.brain), source: sc.brain, gen: 0 };
    runStarted = false;
    meanFit.length = bestFit.length = meanDist.length = bestDist.length = 0;
    generation = 0;
    chartDirty = true;
    if (sc.autoTrain) {
      startRun(champion.params);
      setTraining(true);
    }
    refreshScenario();
    refreshInterventions();
    restartReplay();
    updateButtons();
    updateStats();
    updateStatus();
  }

  function refreshScenario() {
    scenarioBtns.forEach(({ key, b }) => {
      b.classList.toggle('active', key === scenarioKey);
      b.setAttribute('aria-pressed', String(key === scenarioKey));
    });
    scenarioInfo.replaceChildren();
    if (scenarioKey) {
      const sc = SCENARIOS[scenarioKey];
      const strong = document.createElement('strong');
      strong.textContent = `${sc.label}. `;
      scenarioInfo.append(strong, sc.description);
    } else {
      scenarioInfo.textContent =
        'Situation personnalisée. Choisissez un scénario pour revenir à une histoire guidée.';
    }
  }

  function clearScenario() {
    if (scenarioKey === null) return;
    scenarioKey = null;
    refreshScenario();
  }

  // ---------------------------------------------------------------------------
  // Interventions
  // ---------------------------------------------------------------------------
  const interBox = $('interventions');
  const interInputs = INTERVENTIONS.map((it) => {
    const id = `walker-int-${it.key}`;
    const wrap = document.createElement('div');
    wrap.className = 'walker-intervention';
    wrap.innerHTML = `<label class="check walker-int-label"><input type="checkbox" id="${id}" aria-describedby="${id}-help" /> <span></span></label><p class="help" id="${id}-help"></p>`;
    wrap.querySelector('span')!.textContent = it.label;
    wrap.querySelector('.help')!.textContent = it.help;
    const input = wrap.querySelector('input')!;
    input.addEventListener('change', () => {
      config = { ...config, [it.key]: input.checked };
      worldChanged();
    });
    interBox.appendChild(wrap);
    return { it, input, wrap };
  });

  function refreshInterventions() {
    for (const { it, input, wrap } of interInputs) {
      input.checked = config[it.key];
      wrap.classList.toggle('walker-on', config[it.key]);
    }
  }

  $('btn-heal').addEventListener('click', () => {
    config = { ...HEALTHY };
    worldChanged();
  });

  /** Le monde a changé : on garde le cerveau, on met l'apprentissage en pause et on rejoue. */
  let worldChangedMsg = '';
  function worldChanged() {
    clearScenario();
    const wasRunning = pool.isRunning;
    pool.setRunning(false);
    runStarted = false; // le prochain « Apprendre » repartira du cerveau affiché, dans ce nouveau monde
    worldChangedMsg = wasRunning
      ? 'Monde modifié : l’apprentissage est en pause. Regardez comment le cerveau actuel s’en sort, puis cliquez sur « Réapprendre ».'
      : 'Monde modifié : le cerveau n’a pas changé. Regardez comment il s’en sort, puis cliquez sur « Réapprendre » pour qu’il s’adapte.';
    refreshInterventions();
    restartReplay();
    updateButtons();
    updateStatus();
  }

  // ---------------------------------------------------------------------------
  // Objectifs et personnalité (haut niveau)
  // ---------------------------------------------------------------------------
  interface KnobDef {
    id: string;
    label: string;
    help: string;
    levels: Level<number>[];
    get: () => number;
    set: (v: number) => void;
    kind: 'range' | 'segmented';
    ends?: [string, string];
  }
  const KNOBS: KnobDef[] = [
    {
      id: 'priority',
      label: 'Priorité',
      kind: 'range',
      ends: ['Aller vite', 'Économiser l’énergie'],
      help: 'Plus vous allez vers l’économie, plus chaque joule dépensé par les moteurs coûte de points. Observez : la démarche devient plus lente et plus souple, avec moins de gestes brusques.',
      levels: PRIORITY_LEVELS,
      get: () => settings.objectives.energy,
      set: (v) => (settings.objectives.energy = v),
    },
    {
      id: 'fall',
      label: 'Ne jamais tomber',
      kind: 'segmented',
      help: 'Pénalité retirée du score en cas de chute. Forte : le robot apprend une démarche plus prudente, quitte à aller moins loin. Nulle : il peut tenter un « plongeon » final pour gagner quelques centimètres.',
      levels: FALL_LEVELS,
      get: () => settings.objectives.fall,
      set: (v) => (settings.objectives.fall = v),
    },
    {
      id: 'upright',
      label: 'Se tenir droit',
      kind: 'segmented',
      help: 'Pénalité proportionnelle à l’inclinaison moyenne du torse. Forte : il garde le dos horizontal au lieu de se pencher pour « tomber vers l’avant ».',
      levels: UPRIGHT_LEVELS,
      get: () => settings.objectives.upright,
      set: (v) => (settings.objectives.upright = v),
    },
    {
      id: 'curiosity',
      label: 'Curiosité',
      kind: 'segmented',
      help: 'Taille des variations essayées autour du cerveau actuel. Prudente : progrès lents mais réguliers. Aventureuse : il essaie des démarches très différentes, ce qui peut débloquer une situation… ou rendre la courbe chaotique.',
      levels: CURIOSITY_LEVELS,
      get: () => settings.es.sigma,
      set: (v) => (settings.es.sigma = v),
    },
  ];

  const knobUIs: { def: KnobDef; out: HTMLElement; buttons?: HTMLButtonElement[]; range?: HTMLInputElement }[] = [];
  const knobBox = $('knobs');
  for (const def of KNOBS) {
    const id = `walker-knob-${def.id}`;
    const wrap = document.createElement('div');
    wrap.className = 'walker-knob';
    wrap.innerHTML = `
      <div class="slider-head"><span class="walker-knob-name" id="${id}-label"></span><output id="${id}-out" aria-live="polite"></output></div>
      <div class="walker-knob-control"></div>
      <p class="help" id="${id}-help"></p>`;
    wrap.querySelector('.walker-knob-name')!.textContent = def.label;
    wrap.querySelector('.help')!.textContent = def.help;
    const ctrl = wrap.querySelector('.walker-knob-control')!;
    const ui: (typeof knobUIs)[number] = { def, out: wrap.querySelector('output')! };
    if (def.kind === 'range') {
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = String(def.levels.length - 1);
      range.step = '1';
      range.id = `${id}-range`;
      range.setAttribute('aria-labelledby', `${id}-label`);
      range.setAttribute('aria-describedby', `${id}-help`);
      range.addEventListener('input', () => applyKnob(def, def.levels[Number(range.value)].value));
      const ends = document.createElement('div');
      ends.className = 'walker-ends';
      ends.innerHTML = '<span></span><span></span>';
      ends.children[0].textContent = def.ends![0];
      ends.children[1].textContent = def.ends![1];
      ctrl.append(range, ends);
      ui.range = range;
    } else {
      const seg = document.createElement('div');
      seg.className = 'segmented walker-seg';
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-labelledby', `${id}-label`);
      ui.buttons = def.levels.map((lv) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = lv.label;
        b.addEventListener('click', () => applyKnob(def, lv.value));
        seg.appendChild(b);
        return b;
      });
      ctrl.appendChild(seg);
    }
    knobUIs.push(ui);
    knobBox.appendChild(wrap);
  }

  function applyKnob(def: KnobDef, v: number) {
    def.set(v);
    objectivesChanged();
  }

  function objectivesChanged() {
    pool.setObjectives(settings.objectives);
    pool.setHyper(settings.es);
    // Le score du record n'est plus comparable : le prochain cerveau évalué devient la référence.
    record = -Infinity;
    refreshKnobs();
    syncSliders();
  }

  function refreshKnobs() {
    for (const ui of knobUIs) {
      const v = ui.def.get();
      const idx = ui.def.levels.findIndex((l) => Math.abs(l.value - v) < 1e-9);
      ui.out.textContent = idx >= 0 ? ui.def.levels[idx].label : 'personnalisé';
      ui.out.classList.toggle('walker-custom', idx < 0);
      ui.buttons?.forEach((b, i) => {
        b.classList.toggle('active', i === idx);
        b.setAttribute('aria-pressed', String(i === idx));
      });
      if (ui.range && idx >= 0) ui.range.value = String(idx);
    }
    const o = settings.objectives;
    $('formula').textContent =
      `score = ${fmt(o.speed, 1)} × distance − ${fmt(o.energy, 2)} × énergie ÷ 100 − ${fmt(o.fall, 0)} si chute − ${fmt(o.upright, 1)} × inclinaison`;
  }

  // Paramètres experts
  const sliderBox = $('sliders');
  const sliders: { set: (v: number) => void; get: () => number }[] = [];
  const addGroup = (t: string) => {
    const g = document.createElement('div');
    g.className = 'group-title';
    g.textContent = t;
    sliderBox.appendChild(g);
  };
  const addSlider = (
    label: string,
    help: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    set: (v: number) => void,
    format?: (v: number) => string,
  ) => {
    const s = createSlider({
      label,
      help,
      min,
      max,
      step,
      value: get(),
      format,
      onInput: (v) => {
        set(v);
        objectivesChanged();
      },
    });
    sliders.push({ set: s.set, get });
    sliderBox.appendChild(s.el);
  };
  addGroup('Score');
  addSlider('Poids de la distance', 'Points par mètre parcouru vers l’avant (à l’horizontale). En arrière, la distance est négative.', 0, 3, 0.1, () => settings.objectives.speed, (v) => (settings.objectives.speed = v), (v) => fmt(v, 1));
  addSlider('Poids de l’énergie', 'Points retirés pour 100 J de travail des moteurs. Un essai typique dépense quelques milliers de joules.', 0, 1, 0.01, () => settings.objectives.energy, (v) => (settings.objectives.energy = v), (v) => fmt(v, 2));
  addSlider('Pénalité de chute', 'Points retirés si le torse touche le sol ou bascule (l’essai s’arrête alors).', 0, 30, 1, () => settings.objectives.fall, (v) => (settings.objectives.fall = v), (v) => fmt(v, 0));
  addSlider('Poids de l’inclinaison', 'Points retirés par radian d’inclinaison moyenne du torse.', 0, 10, 0.5, () => settings.objectives.upright, (v) => (settings.objectives.upright = v), (v) => fmt(v, 1));
  addGroup('Stratégie d’évolution');
  addSlider('Taille de la population', 'Nombre de variantes essayées par génération (paire). Plus grand : estimation plus fiable de la bonne direction, mais chaque génération est plus longue.', 8, 96, 2, () => settings.es.popSize, (v) => (settings.es.popSize = v), (v) => String(v));
  addSlider('Bruit σ (curiosité)', 'Écart-type du bruit ajouté aux poids pour créer les variantes.', 0.01, 0.3, 0.01, () => settings.es.sigma, (v) => (settings.es.sigma = v), (v) => fmt(v, 2));
  addSlider('Taux d’apprentissage', 'Taille du pas de mise à jour des poids (optimiseur Adam). Trop grand : le cerveau oscille ; trop petit : progrès très lents.', 0.002, 0.1, 0.002, () => settings.es.lr, (v) => (settings.es.lr = v), (v) => fmt(v, 3));
  const wInfo = document.createElement('p');
  wInfo.className = 'help';
  wInfo.textContent = `Calcul réparti sur ${nWorkers} Web Worker${nWorkers > 1 ? 's' : ''} (selon le nombre de cœurs de votre appareil). Le résultat est le même quel que soit leur nombre.`;
  sliderBox.appendChild(wInfo);

  function syncSliders() {
    for (const s of sliders) s.set(s.get());
  }

  // ---------------------------------------------------------------------------
  // Graphique, statistiques, statut
  // ---------------------------------------------------------------------------
  const chart = $<HTMLCanvasElement>('chart');
  let chartMode: 'score' | 'distance' = 'score';
  const modeBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('#walker-chart-mode button'));
  modeBtns.forEach((b) =>
    b.addEventListener('click', () => {
      chartMode = b.dataset.mode as 'score' | 'distance';
      modeBtns.forEach((x) => {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      chartDirty = true;
      updateChartHelp();
    }),
  );
  function updateChartHelp() {
    $('chart-help').textContent =
      chartMode === 'score'
        ? 'Score de chaque génération (formule dans « Ce que le robot cherche »). La meilleure variante monte vite ; la moyenne suit : c’est tout le groupe qui progresse.'
        : 'Distance parcourue en 10 s (m). Le score inclut aussi l’énergie, les chutes et l’inclinaison : une distance qui baisse un peu peut aller avec un meilleur score.';
  }
  updateChartHelp();

  function drawChartNow() {
    const mean = chartMode === 'score' ? meanFit : meanDist;
    const best = chartMode === 'score' ? bestFit : bestDist;
    drawChart(
      chart,
      mean,
      { raw: theme.chartRaw, avg: theme.chartAvg, axis: theme.border, text: theme.muted },
      {
        window: 5,
        xLabel: 'génération',
        emptyText: 'Cliquez sur « Apprendre » ou « Réapprendre » pour voir la courbe',
        extra: [{ values: best, color: theme.series[1], dashed: true, label: 'meilleure' }],
      },
    );
  }
  const chartLoop = rafLoop(() => {
    if (!chartDirty) return;
    chartDirty = false;
    drawChartNow();
  });
  disposers.push(chartLoop);
  disposers.push(onResize(chart, () => (chartDirty = true)));

  function updateStats() {
    $('st-gen').textContent = String(generation);
    if (lastResult) {
      $('st-dist').textContent = `${fmt(lastResult.distance, 2)} m${lastResult.fell ? ' (chute)' : ''}`;
      $('st-speed').textContent = `${fmt(lastResult.distance / Math.max(lastResult.time, DT), 2)} m/s`;
      $('st-energy').textContent = `${fmt(lastResult.energy, 0)} J`;
    }
  }

  function updateStatus() {
    let msg: string;
    if (workerFailed) msg = 'Le calcul en arrière-plan (Web Worker) n’a pas pu démarrer dans ce navigateur : la rediffusion fonctionne, mais pas l’apprentissage.';
    else if (generation >= MAX_GENERATIONS) msg = `Arrêt automatique après ${MAX_GENERATIONS} générations.`;
    else if (pool.isRunning) {
      msg =
        generation === 0
          ? 'Première génération en cours…'
          : `Apprentissage en cours : génération ${generation} (${fmt(lastGenMs / 1000, 1)} s par génération, ${settings.es.popSize} variantes de 10 s chacune). Le robot affiché est le meilleur cerveau trouvé jusqu’ici.`;
      worldChangedMsg = '';
    } else if (worldChangedMsg) msg = worldChangedMsg;
    else if (runStarted && generation > 0) msg = `En pause à la génération ${generation}.`;
    else if (champion.source === 'random') msg = 'Cerveau au hasard. Cliquez sur « Apprendre ».';
    else msg = 'Le robot rejoue son meilleur essai. Cliquez sur « Apprendre » pour continuer l’entraînement, ou essayez une intervention.';
    $('status').textContent = msg;
  }

  // ---------------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------------
  refreshKnobs();
  applyScenario('healthy');

  return () => {
    for (const d of disposers.splice(0)) d();
    replay = null;
    ghost = null;
  };
}
