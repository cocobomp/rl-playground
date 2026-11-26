import './style.css';
import { TEMPLATE } from './template';
import {
  EXPERT_SLIDERS,
  INTERVENTIONS,
  SCENARIOS,
  SIGMA_LEVELS,
  Scenario,
  Settings,
  TRAITS,
  Trait,
  defaultSettings,
  rewardOf,
} from './config';
import { DEFAULT_WORLD, DT, EPISODE_SECONDS, EPISODE_STEPS, NUM_JOINTS, OBS_SIZE, QuadrupedEnv, initPhysics } from './env';
import { evaluate, makePolicy, randomBrain } from './agent';
import type { Policy } from './env';
import type { FromWorker, ToWorker } from './protocol';
import { PRETRAINED_BROKEN, PRETRAINED_HEALTHY } from './pretrained';
import { drawBrainPanel } from './draw';
import { RobotView, webglAvailable } from './view3d';
import { drawChart } from '../../shared/chart';
import { createSlider, onResize, onThemeChange, rafLoop, readTheme } from '../../shared/ui';

/** Durée du rejeu quand on n'entraîne pas (s) : on laisse le robot marcher plus longtemps que l'essai noté. */
const LONG_REPLAY_SECONDS = 20;
/** Pause après une chute avant de recommencer (s). */
const FALL_PAUSE = 1.2;

const fr = (v: number, d = 2) => v.toFixed(d).replace('.', ',').replace('-', '−');
const fmtM = (v: number) => `${fr(v)} m`;

export function mount(root: HTMLElement): () => void {
  root.innerHTML = TEMPLATE;
  const disposers: Array<() => void> = [];
  let disposed = false;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector(`#quadruped3d-${id}`) as T;

  const settings: Settings = defaultSettings();
  let theme = readTheme();

  // ---------------------------------------------------------------------------
  // Cerveau affiché, historique
  // ---------------------------------------------------------------------------
  let brain: Float64Array = Float64Array.from(PRETRAINED_HEALTHY.params);
  let brainLabel = 'pré-entraîné (robot intact)';
  /** Cerveau reçu du worker, affiché au prochain recommencement du rejeu. */
  let pendingBrain: { params: Float64Array; label: string } | null = null;
  const distHistory: number[] = [];
  const fitHistory: number[] = [];
  let generation = 0;
  let record = -Infinity;
  let chartDirty = true;
  /** Distance du cerveau au début de la phase d'apprentissage actuelle (même cerveau de départ, même monde). */
  let baseline: number | null = null;
  /** Indice dans distHistory où commence cette phase. */
  let baselineIndex = 0;
  const markBaseline = () => {
    baseline = lastEval ? lastEval.distance : null;
    baselineIndex = distHistory.length;
    plateauSeen = false;
  };
  /** Une fois le plateau détecté, le message reste affiché (évite le clignotement dû au bruit). */
  let plateauSeen = false;
  /** Nombre de générations sans progrès net pour déclarer que la courbe plafonne. */
  const PLATEAU_WINDOW = 15;

  // ---------------------------------------------------------------------------
  // Worker d'entraînement
  // ---------------------------------------------------------------------------
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  disposers.push(() => worker?.terminate());
  const send = (m: ToWorker) => worker?.postMessage(m);
  let runId = 0;
  let seed = 1;
  let training = false;
  /** Le worker doit repartir du cerveau affiché (nouveau cerveau chargé). */
  let needReset = true;
  let genOffset = 0;

  if (worker) {
    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.type === 'error') {
        training = false;
        updateButtons();
        setStatus(`Erreur dans l’entraînement : ${m.message}`);
        return;
      }
      if (m.runId !== runId) return;
      if (m.type === 'gen') {
        const r = m.report;
        generation = genOffset + r.generation;
        distHistory.push(r.distance);
        fitHistory.push(r.fitness);
        chartDirty = true;
        record = Math.max(record, r.distance);
        lastEval = { distance: r.distance, energy: r.energy, fell: r.fell };
        pendingBrain = { params: Float64Array.from(m.brain), label: `génération ${generation}` };
        updateStats();
        if (training) {
          const from = baseline !== null ? ` (au départ : ${fmtM(baseline)})` : '';
          const fell = r.fell ? ' mais il tombe encore avant la fin' : ', sans chute';
          let msg = `Génération ${generation} : le cerveau actuel parcourt ${fmtM(r.distance)} en 8 s${from}${fell}.`;
          if (!plateauSeen && isPlateau()) plateauSeen = true;
          const plateau = plateauSeen;
          if (plateau)
            msg += ' La courbe ne monte presque plus depuis une quinzaine de générations : l’essentiel est appris, vous pouvez cliquer sur « Pause » (de petits progrès restent possibles).';
          else if (isStuck())
            msg += ' Après tant de générations, toujours pas de vraie démarche : ce cas est difficile pour cette méthode, les progrès sont très lents.';
          setStatus(msg, plateau);
        }
      }
    };
    worker.onerror = () => {
      training = false;
      worker = null;
      updateButtons();
      setStatus('Le Web Worker d’entraînement n’a pas pu démarrer : l’apprentissage est indisponible dans ce navigateur.');
    };
  }

  /** Distance au-delà de laquelle on parle d'une vraie démarche (le cerveau pré-entraîné fait environ 9 m). */
  const GAIT_DISTANCE = 4;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  /**
   * Vrai si le robot a une vraie démarche (moyenne récente ≥ GAIT_DISTANCE) et que la moyenne des
   * 15 dernières distances ne dépasse plus nettement celle des 15 précédentes.
   */
  function isPlateau(): boolean {
    const h = distHistory.slice(baselineIndex);
    if (h.length < 2 * PLATEAU_WINDOW + 10) return false;
    const recent = mean(h.slice(-PLATEAU_WINDOW));
    const before = mean(h.slice(-2 * PLATEAU_WINDOW, -PLATEAU_WINDOW));
    return recent >= GAIT_DISTANCE && recent - before < 0.15;
  }
  /** Vrai si, après beaucoup de générations, le robot n'a toujours pas de démarche. */
  function isStuck(): boolean {
    const h = distHistory.slice(baselineIndex);
    return h.length >= 150 && mean(h.slice(-PLATEAU_WINDOW)) < 2;
  }

  function resetWorker(): void {
    runId++;
    genOffset = generation;
    send({
      type: 'reset',
      runId,
      brain: Array.from(brain),
      world: { ...settings.world },
      reward: rewardOf(settings),
      hyper: { ...settings.hyper },
      seed: seed++,
    });
    needReset = false;
  }

  function setTraining(on: boolean): void {
    if (!worker) {
      setStatus('L’apprentissage nécessite les Web Workers, indisponibles ici.');
      return;
    }
    if (on && needReset) resetWorker();
    training = on;
    send({ type: 'run', on });
    updateButtons();
    if (on) {
      setStatus(
        `Apprentissage en cours : chaque génération essaie ${settings.hyper.popSize} variantes du cerveau pendant 8 s simulées, puis le cerveau avance vers les meilleures. ` +
          'Le robot à l’écran prend le nouveau cerveau à chaque nouvel essai.',
      );
      restartReplay();
    } else setStatus(`En pause à la génération ${generation}. « Reprendre » continue à partir du cerveau actuel.`);
  }

  /** Remplace le cerveau (pré-entraîné, aléatoire, scénario) : l'historique repart de zéro. */
  function loadBrain(params: ArrayLike<number>, label: string): void {
    if (training) {
      training = false;
      send({ type: 'run', on: false });
    }
    brain = Float64Array.from(params);
    brainLabel = label;
    pendingBrain = null;
    needReset = true;
    distHistory.length = 0;
    fitHistory.length = 0;
    generation = 0;
    record = -Infinity;
    chartDirty = true;
    evaluateCurrent();
    markBaseline();
    updateButtons();
    restartReplay();
  }

  // ---------------------------------------------------------------------------
  // Évaluation du cerveau affiché (8 s, identique à l'entraînement)
  // ---------------------------------------------------------------------------
  let physicsReady = false;
  let lastEval: { distance: number; energy: number; fell: boolean } | null = null;
  function evaluateCurrent(): void {
    if (!physicsReady) return;
    const r = evaluate(brain, settings.world, rewardOf(settings));
    lastEval = { distance: r.distance, energy: r.energy, fell: r.fell };
    record = Math.max(record, r.distance);
    updateStats();
  }

  // ---------------------------------------------------------------------------
  // Rejeu 3D
  // ---------------------------------------------------------------------------
  const stage = $('stage');
  const hud = $('hud');
  const loading = $('loading');
  let view: RobotView | null = null;
  if (webglAvailable()) {
    try {
      view = new RobotView(stage, theme);
    } catch {
      view = null;
    }
  }
  if (!view) {
    loading.hidden = false;
    loading.textContent =
      'Votre navigateur ne peut pas afficher la 3D (WebGL indisponible ou désactivé). L’apprentissage fonctionne quand même : suivez la courbe et les chiffres.';
  }
  disposers.push(() => view?.dispose());

  let env: QuadrupedEnv | null = null;
  let policy: Policy | null = null;
  const obs = new Float64Array(OBS_SIZE);
  const actions = new Float64Array(NUM_JOINTS);
  let actuated: boolean[] = new Array(NUM_JOINTS).fill(true);
  let fallTimer = 0;
  let acc = 0;
  let replayDist8: number | null = null;

  function restartReplay(): void {
    if (!physicsReady || disposed) return;
    if (pendingBrain) {
      brain = pendingBrain.params;
      brainLabel = pendingBrain.label;
      pendingBrain = null;
    }
    env?.free();
    env = new QuadrupedEnv(settings.world);
    policy = makePolicy(brain);
    actuated = Array.from({ length: NUM_JOINTS }, (_, j) => env!.isActuated(j));
    fallTimer = 0;
    acc = 0;
    replayDist8 = null;
    actions.fill(0);
    view?.setWorld(settings.world);
    view?.snapCamera(0);
  }
  disposers.push(() => {
    env?.free();
    env = null;
  });

  function stepReplay(): void {
    if (!env || !policy) return;
    if (env.fallen) {
      fallTimer += DT;
      if (fallTimer >= FALL_PAUSE) restartReplay();
      return;
    }
    env.observe(obs);
    const a = policy(obs);
    for (let j = 0; j < NUM_JOINTS; j++) actions[j] = env.isActuated(j) ? a[j] : 0;
    env.step(a);
    if (env.steps === EPISODE_STEPS || (env.fallen && replayDist8 === null)) replayDist8 = env.distance;
    const limit = training ? EPISODE_SECONDS : LONG_REPLAY_SECONDS;
    if (!env.fallen && env.time >= limit - 1e-9) restartReplay();
  }

  let lastNow = 0;
  let frame = 0;
  const brainCanvas = $<HTMLCanvasElement>('brain');
  const chartCanvas = $<HTMLCanvasElement>('chart');
  disposers.push(
    rafLoop((now) => {
      const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      lastNow = now;
      if (env) {
        acc += dt * settings.replaySpeed;
        let n = 0;
        while (acc >= DT && n < 8) {
          stepReplay();
          acc -= DT;
          n++;
        }
        if (n === 8) acc = 0;
        if (env) {
          view?.update(env.poses());
          updateHud();
        }
      }
      view?.render();
      if (frame++ % 2 === 0) drawBrainPanel(brainCanvas, env ? obs : null, env ? actions : null, actuated, theme);
      if (chartDirty) drawChartNow();
    }),
  );

  function updateHud(): void {
    if (!env) return;
    const parts = [
      `<span>t = ${fr(env.time, 1)} s</span>`,
      `<span>distance ${fmtM(env.distance)}</span>`,
      `<span>cerveau : ${brainLabel}</span>`,
    ];
    if (replayDist8 !== null && env.time > EPISODE_SECONDS) parts.push(`<span>à 8 s : ${fmtM(replayDist8)}</span>`);
    if (env.fallen) parts.push('<span class="quadruped3d-hud-bad">Chute ! Nouvel essai…</span>');
    const html = parts.join('');
    if (hud.innerHTML !== html) hud.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // Statistiques, état, graphique
  // ---------------------------------------------------------------------------
  const statusEl = $('status');
  const setStatus = (t: string, done = false) => {
    statusEl.textContent = t;
    statusEl.classList.toggle('quadruped3d-status-done', done);
  };

  function updateStats(): void {
    $('st-gen').textContent = String(generation);
    $('st-dist').textContent = lastEval ? `${fmtM(lastEval.distance)}${lastEval.fell ? ' (chute)' : ''}` : '–';
    $('st-best').textContent = Number.isFinite(record) ? fmtM(record) : '–';
    $('st-energy').textContent = lastEval ? `${Math.round(lastEval.energy)} J` : '–';
  }

  function drawChartNow(): void {
    chartDirty = false;
    drawChart(
      chartCanvas,
      distHistory,
      { raw: theme.chartRaw, avg: theme.chartAvg, axis: theme.border, text: theme.muted },
      {
        window: 10,
        xLabel: 'génération',
        emptyText: 'Cliquez sur « Réapprendre » pour voir la courbe',
        extra: [{ values: fitHistory, color: theme.series[1], dashed: true, label: 'note' }],
      },
    );
  }

  const btnTrain = $<HTMLButtonElement>('btn-train');
  function updateButtons(): void {
    btnTrain.textContent = training ? 'Pause' : needReset ? 'Réapprendre' : 'Reprendre';
    btnTrain.classList.toggle('active', training);
    btnTrain.disabled = !worker || !physicsReady;
  }

  btnTrain.addEventListener('click', () => setTraining(!training));
  $('btn-replay').addEventListener('click', () => restartReplay());
  $('btn-pretrained').addEventListener('click', () => {
    if (settings.world.brokenFrontLeft) {
      loadBrain(PRETRAINED_BROKEN.params, 'pré-entraîné (3 pattes)');
      setStatus(
        `Cerveau pré-entraîné pour la patte avant gauche cassée : ${PRETRAINED_BROKEN.history}.`,
      );
    } else {
      loadBrain(PRETRAINED_HEALTHY.params, 'pré-entraîné (robot intact)');
      setStatus(`Cerveau pré-entraîné hors ligne pour le robot intact : ${PRETRAINED_HEALTHY.history}.`);
    }
  });
  $('btn-scratch').addEventListener('click', () => {
    loadBrain(randomBrain(1000 + seed), 'aléatoire');
    setStatus('Nouveau cerveau aléatoire : il ne sait rien faire. Cliquez sur « Réapprendre » et soyez patient : il faut souvent plus d’une centaine de générations (plusieurs minutes).');
  });

  // ---------------------------------------------------------------------------
  // Interventions
  // ---------------------------------------------------------------------------
  const interventionInputs = new Map<string, HTMLInputElement>();
  {
    const box = $('interventions');
    for (const iv of INTERVENTIONS) {
      const id = `quadruped3d-iv-${iv.id}`;
      const wrap = document.createElement('div');
      wrap.className = 'quadruped3d-intervention';
      wrap.innerHTML = `<label class="check" for="${id}"><input type="checkbox" id="${id}" aria-describedby="${id}-help" /> <span></span></label><p class="help" id="${id}-help"></p>`;
      wrap.querySelector('span')!.textContent = iv.label;
      wrap.querySelector('.help')!.textContent = iv.help;
      const input = wrap.querySelector('input')!;
      input.addEventListener('change', () => {
        iv.set(settings.world, input.checked);
        onWorldChanged(`${input.checked ? 'Intervention' : 'Retour à la normale'} : « ${iv.label} ».`);
      });
      interventionInputs.set(iv.id, input);
      box.appendChild(wrap);
    }
  }
  function syncInterventions(): void {
    for (const iv of INTERVENTIONS) interventionInputs.get(iv.id)!.checked = iv.get(settings.world);
  }
  function onWorldChanged(what: string): void {
    send({ type: 'world', world: { ...settings.world } });
    // Le record n'a de sens que dans un même monde : il repart de la performance actuelle.
    record = -Infinity;
    clearScenarioButtons();
    evaluateCurrent();
    markBaseline();
    restartReplay();
    const d = lastEval ? ` Avec le cerveau actuel, il parcourt maintenant ${fmtM(lastEval.distance)} en 8 s${lastEval.fell ? ' et tombe' : ''}.` : '';
    setStatus(
      `${what}${d} ${training ? 'L’apprentissage continue dans ce nouveau monde.' : 'Cliquez sur « ' + (needReset ? 'Réapprendre' : 'Reprendre') + ' » pour qu’il s’adapte.'}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Traits de personnalité
  // ---------------------------------------------------------------------------
  const traitUI = new Map<Trait['id'], { range: HTMLInputElement; out: HTMLOutputElement; map: HTMLElement }>();
  {
    const box = $('traits');
    for (const t of TRAITS) {
      const id = `quadruped3d-trait-${t.id}`;
      const wrap = document.createElement('div');
      wrap.className = 'quadruped3d-trait';
      wrap.innerHTML = `
        <div class="slider-head"><label for="${id}"></label><output for="${id}" aria-live="polite"></output></div>
        <input type="range" id="${id}" min="0" max="${t.levels.length - 1}" step="1" aria-describedby="${id}-help ${id}-map" />
        <div class="quadruped3d-ends"><span></span><span></span></div>
        <p class="help" id="${id}-help"></p>
        <p class="quadruped3d-mapping" id="${id}-map"></p>`;
      wrap.querySelector('label')!.textContent = t.label;
      const ends = wrap.querySelectorAll('.quadruped3d-ends span');
      ends[0].textContent = t.ends[0];
      ends[1].textContent = t.ends[1];
      wrap.querySelector('.help')!.textContent = t.help;
      const range = wrap.querySelector('input')!;
      range.addEventListener('input', () => {
        settings[t.id] = Number(range.value);
        if (t.id === 'curiosity') {
          settings.hyper.sigma = SIGMA_LEVELS[settings.curiosity];
          send({ type: 'hyper', hyper: { sigma: settings.hyper.sigma } });
          syncExpert();
        } else {
          send({ type: 'reward', reward: rewardOf(settings) });
        }
        refreshTraits();
      });
      traitUI.set(t.id, { range, out: wrap.querySelector('output')!, map: wrap.querySelector('.quadruped3d-mapping')! });
      box.appendChild(wrap);
    }
  }
  function refreshTraits(): void {
    for (const t of TRAITS) {
      const ui = traitUI.get(t.id)!;
      const lvl = settings[t.id];
      const custom = t.id === 'curiosity' && Math.abs(SIGMA_LEVELS[lvl] - settings.hyper.sigma) > 1e-9;
      ui.range.value = String(lvl);
      ui.out.textContent = custom ? 'personnalisé' : t.levels[lvl];
      ui.map.textContent = custom
        ? `σ = ${String(+settings.hyper.sigma.toFixed(3)).replace('.', ',')} (réglé dans les paramètres experts)`
        : `→ ${t.describe(settings)}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Paramètres experts
  // ---------------------------------------------------------------------------
  const expertSet = new Map<string, (v: number) => void>();
  {
    const box = $('sliders');
    for (const def of EXPERT_SLIDERS) {
      const get = () => (def.id === 'replaySpeed' ? settings.replaySpeed : settings.hyper[def.id]);
      const s = createSlider({
        label: def.label,
        help: def.help,
        min: def.min,
        max: def.max,
        step: def.step,
        value: get(),
        format: def.format,
        onInput: (v) => {
          if (def.id === 'replaySpeed') settings.replaySpeed = v;
          else {
            settings.hyper[def.id] = v;
            send({ type: 'hyper', hyper: { [def.id]: v } });
            if (def.id === 'sigma') refreshTraits();
          }
        },
      });
      expertSet.set(def.id, () => s.set(get()));
      box.appendChild(s.el);
    }
  }
  function syncExpert(): void {
    for (const f of expertSet.values()) f(0);
  }

  // ---------------------------------------------------------------------------
  // Scénarios
  // ---------------------------------------------------------------------------
  const scenarioBox = $('scenarios');
  function clearScenarioButtons(): void {
    scenarioBox.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
  }
  function applyScenario(sc: Scenario, btn: HTMLButtonElement): void {
    settings.world = { ...DEFAULT_WORLD, ...sc.world };
    syncInterventions();
    send({ type: 'world', world: { ...settings.world } });
    if (sc.brain === 'random') loadBrain(randomBrain(2000 + seed), 'aléatoire');
    else if (sc.brain === 'broken') loadBrain(PRETRAINED_BROKEN.params, 'pré-entraîné (3 pattes)');
    else loadBrain(PRETRAINED_HEALTHY.params, 'pré-entraîné (robot intact)');
    scenarioBox.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    const info = $('scenario-info');
    info.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = `${sc.label}. `;
    info.append(strong, sc.description);
    if (sc.autoTrain) setTraining(true);
    else {
      const d = lastEval ? ` Cerveau actuel : ${fmtM(lastEval.distance)} en 8 s${lastEval.fell ? ', avec chute' : ''}.` : '';
      setStatus(`Scénario « ${sc.label} » prêt.${d}${sc.id === 'demo' ? '' : ' Cliquez sur « Réapprendre » pour qu’il s’adapte.'}`);
    }
  }
  for (const sc of SCENARIOS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = sc.label;
    b.addEventListener('click', () => applyScenario(sc, b));
    scenarioBox.appendChild(b);
  }
  // Raccourci du bloc « Commencez ici » : scénario de la blessure, puis on montre le robot.
  $('start-injury').addEventListener('click', () => {
    const i = SCENARIOS.findIndex((sc) => sc.id === 'injury');
    if (i < 0 || !physicsReady) return;
    applyScenario(SCENARIOS[i], scenarioBox.querySelectorAll('button')[i] as HTMLButtonElement);
    stage.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ---------------------------------------------------------------------------
  // Thème, redimensionnement, démarrage
  // ---------------------------------------------------------------------------
  disposers.push(
    onThemeChange(() => {
      theme = readTheme();
      view?.applyTheme(theme);
      chartDirty = true;
    }),
  );
  disposers.push(onResize(chartCanvas, () => (chartDirty = true)));

  refreshTraits();
  updateStats();
  updateButtons();
  setStatus('Chargement du moteur physique…');

  initPhysics()
    .then(() => {
      if (disposed) return;
      physicsReady = true;
      loading.hidden = !!view;
      evaluateCurrent();
      markBaseline();
      restartReplay();
      updateButtons();
      setStatus(
        `Le robot utilise un cerveau pré-entraîné (${PRETRAINED_HEALTHY.generation} générations hors ligne). Pour le voir apprendre, cassez-lui une patte (bloc « Commencez ici ») puis cliquez sur « Réapprendre ».`,
      );
    })
    .catch((e) => {
      if (disposed) return;
      loading.hidden = false;
      loading.textContent = `Le moteur physique n’a pas pu démarrer : ${String(e)}`;
      setStatus('Le moteur physique n’a pas pu démarrer.');
    });

  return () => {
    disposed = true;
    training = false;
    for (const d of disposers.splice(0).reverse()) {
      try {
        d();
      } catch {
        /* nettoyage au mieux */
      }
    }
    root.innerHTML = '';
  };
}
