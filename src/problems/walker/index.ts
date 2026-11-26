import './style.css';
import { TEMPLATE } from './template';
import { SCENARIOS, Settings, BrainSource, defaultSettings, fmt, isHealthy, worldLabel } from './config';
import { DT, EPISODE_SECONDS, HEALTHY, OBS_SIZE, Walker, WorldConfig, runEpisode } from './env';
import { BrainJSON, policyFromParams, randomParams } from './agent';
import { TrainerPool, GenerationSummary } from './pool';
import { RobotView, drawStage } from './draw';
import { drawChart } from '../../shared/chart';
import { onResize, onThemeChange, prepareCanvas, rafLoop, readTheme } from '../../shared/ui';
import { Moment, Timeline } from './timeline';
import { TimelineView } from './timeline-view';
import { STORIES, Story, finalGen, storyEnd } from './story';
import { SPEED_MODES, SpeedMode, poolSize, workersFor } from './speed';
import { mountSettings } from './settings-ui';
import healthyJSON from './pretrained/healthy.json';
import injuredJSON from './pretrained/injured.json';

const PRETRAINED: Record<'healthy' | 'injured', BrainJSON> = {
  healthy: healthyJSON as BrainJSON,
  injured: injuredJSON as BrainJSON,
};
/** Arrêt automatique de chaque apprentissage (évite de faire chauffer la machine indéfiniment). */
const MAX_GENERATIONS = 1500;
/** Pause entre deux essais rediffusés (ms). */
const HOLD_MS = 1600;
/** Sans nouveau record depuis ce nombre de générations, on signale que l'apprentissage plafonne. */
const PLATEAU_GENS = 80;
/** En mode Turbo : une image fixe du meilleur cerveau toutes les TURBO_REFRESH_MS. */
const TURBO_REFRESH_MS = 3000;

interface Champion {
  params: Float64Array;
  source: BrainSource | 'learned';
  /** Génération d'où vient ce cerveau. */
  gen: number;
}

interface Measure {
  key: string;
  label: string;
  distance: number;
  time: number;
  energy: number;
  fell: boolean;
}

const sameWorld = (a: WorldConfig, b: WorldConfig) => worldLabel(a) === worldLabel(b);
const sameParams = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a.length === b.length && Array.from(a).every((v, i) => Math.abs(v - b[i]) < 1e-9);

export function mount(root: HTMLElement): () => void {
  root.innerHTML = TEMPLATE;
  const disposers: Array<() => void> = [];
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector(`#walker-${id}`) as T;

  const settings: Settings = defaultSettings();
  let config: WorldConfig = { ...HEALTHY };
  let theme = readTheme();
  let chartDirty = true;
  let stageDirty = true;
  disposers.push(
    onThemeChange(() => {
      theme = readTheme();
      chartDirty = true;
      stageDirty = true;
    }),
  );

  const brainParams = (src: BrainSource): Float64Array =>
    src === 'random' ? randomParams((Date.now() & 0xffff) + 1) : Float64Array.from(PRETRAINED[src].params);

  let champion: Champion = { params: brainParams('healthy'), source: 'healthy', gen: 0 };
  /** Le cerveau sain, pour le fantôme. */
  const ghostParams = Float64Array.from(PRETRAINED.healthy.params);

  // ---------------------------------------------------------------------------
  // Moments clés
  // ---------------------------------------------------------------------------
  const timeline = new Timeline();
  /** Moment rejoué (null = le direct) et moment en fantôme pour comparer. */
  let viewing: Moment | null = null;
  let compare: Moment | null = null;
  /** Le monde de la dernière séquence d'apprentissage (pour les moments « avant / après »). */
  let lastWorld: WorldConfig = { ...HEALTHY };
  /** Que faire de la première génération du prochain apprentissage. */
  let pendingStart: 'start' | 'after' | null = null;

  // ---------------------------------------------------------------------------
  // Entraînement (workers)
  // ---------------------------------------------------------------------------
  const cores = navigator.hardwareConcurrency || 2;
  const nWorkers = poolSize(cores);
  let speedMode: SpeedMode = 'fast';
  let workerFailed = false;
  // Courbes cumulées depuis le début de l'histoire (indice k = génération k + 1).
  const meanFit: number[] = [];
  const bestFit: number[] = [];
  const meanDist: number[] = [];
  const bestDist: number[] = [];
  let record = -Infinity;
  let lastGenMs = 0;
  /** Génération cumulée (affichée) et numéro de génération où l'apprentissage en cours a démarré. */
  let generation = 0;
  let genBase = 0;
  let runGen = 0;
  let runStarted = false;
  let seedCounter = 1;
  const genTimes: number[] = [];

  const pool = new TrainerPool(nWorkers, onGeneration, () => {
    workerFailed = true;
    updateButtons();
    updateStatus();
  });
  pool.setActive(workersFor(speedMode, cores));
  disposers.push(() => pool.dispose());

  function gensPerSecond(): number {
    if (genTimes.length < 2) return 0;
    const span = genTimes[genTimes.length - 1] - genTimes[0];
    return span > 0 ? ((genTimes.length - 1) * 1000) / span : 0;
  }

  function onGeneration(s: GenerationSummary) {
    runGen = s.generation;
    generation = genBase + s.generation;
    lastGenMs = s.ms;
    genTimes.push(performance.now());
    if (genTimes.length > 12) genTimes.shift();
    meanFit.push(s.meanFitness);
    bestFit.push(Math.max(s.best.fitness, s.theta.fitness));
    meanDist.push(s.meanDistance);
    bestDist.push(Math.max(s.best.distance, s.theta.distance));
    // À la génération 1, θ est encore le cerveau de départ : c'est la « génération 0 » de la séquence.
    if (s.generation === 1 && pendingStart) {
      const r = s.theta;
      const base = { gen: genBase, params: s.thetaParams, config, distance: r.distance, fell: r.fell, fitness: r.fitness };
      if (pendingStart === 'start') timeline.observe(base, true);
      else {
        timeline.push({ ...base, kind: 'after', extra: `même cerveau, ${worldLabel(config)}` });
        timeline.prime(r);
      }
      pendingStart = null;
    }
    // Le cerveau de la génération : le meilleur entre θ et la meilleure variante.
    const cand = s.theta.fitness >= s.best.fitness ? { r: s.theta, p: s.thetaParams } : { r: s.best, p: s.bestParams };
    timeline.observe({ gen: generation, params: cand.p, config, distance: cand.r.distance, fell: cand.r.fell, fitness: cand.r.fitness });
    // Le cerveau affiché en direct = le meilleur jamais vu pendant cet apprentissage (l'évaluation est déterministe).
    if (cand.r.fitness > record) {
      record = cand.r.fitness;
      champion = { params: Float64Array.from(cand.p), source: 'learned', gen: generation };
    }
    if (runGen >= MAX_GENERATIONS) setTraining(false);
    chartDirty = true;
    if (speedMode !== 'turbo') refreshTexts();
  }

  /** Démarre (ou redémarre) l'évolution à partir d'un cerveau. `fresh` : nouvelle histoire (courbe et moments effacés). */
  function startRun(init: Float64Array, fresh = false) {
    if (fresh) {
      timeline.clear();
      meanFit.length = bestFit.length = meanDist.length = bestDist.length = 0;
      generation = 0;
      pendingStart = 'start';
    } else {
      // Moment « avant » : le cerveau actuel dans le monde où il a appris, s'il n'est pas déjà le dernier moment.
      const changed = !sameWorld(lastWorld, config);
      const last = timeline.moments[timeline.moments.length - 1];
      if (!last || !sameParams(last.params, champion.params) || !sameWorld(last.config, lastWorld)) {
        const r = runEpisode(policyFromParams(champion.params), lastWorld, settings.objectives);
        const hurt = changed && config.lockLeftKnee && !lastWorld.lockLeftKnee;
        timeline.push({
          gen: generation,
          kind: 'before',
          params: champion.params,
          config: lastWorld,
          distance: r.distance,
          fell: r.fell,
          fitness: r.fitness,
          extra: changed ? (hurt ? 'avant la blessure' : 'avant le changement') : 'avant « Réapprendre »',
        });
      }
      pendingStart = changed ? 'after' : null;
    }
    timeline.newSegment();
    // Point de départ de la séquence : le cerveau actuel dans le monde actuel (évite un faux « premier essai sans chute »).
    if (!fresh) timeline.prime(runEpisode(policyFromParams(init), config, settings.objectives));
    lastWorld = { ...config };
    genBase = generation;
    runGen = 0;
    record = -Infinity;
    runStarted = true;
    genTimes.length = 0;
    pool.start(init, config, settings.objectives, settings.es, 1000 + seedCounter++);
    chartDirty = true;
  }

  function setTraining(on: boolean) {
    if (on && !runStarted) startRun(champion.params, timeline.moments.length === 0);
    pool.setRunning(on && runGen < MAX_GENERATIONS);
    if (!pool.isRunning) genTimes.length = 0;
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
    startRun(champion.params, timeline.moments.length === 0);
    setTraining(true);
  });
  btnScratch.addEventListener('click', () => {
    clearScenario();
    champion = { params: brainParams('random'), source: 'random', gen: 0 };
    viewing = compare = null;
    startRun(champion.params, true);
    restartReplay();
    setTraining(true);
  });

  function updateButtons() {
    const running = pool.isRunning;
    btnRun.textContent = running ? 'Pause' : runStarted && runGen > 0 ? 'Reprendre' : 'Apprendre';
    btnRun.classList.toggle('active', running);
    [btnRun, btnAdapt, btnScratch].forEach((b) => (b.disabled = workerFailed));
  }

  // ---------------------------------------------------------------------------
  // Vitesse d'apprentissage
  // ---------------------------------------------------------------------------
  const lspeedBox = $('lspeed');
  const lspeedBtns = SPEED_MODES.map((sm) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = sm.label;
    b.addEventListener('click', () => setSpeedMode(sm.key));
    lspeedBox.appendChild(b);
    return { sm, b };
  });
  function setSpeedMode(m: SpeedMode) {
    speedMode = m;
    pool.setActive(workersFor(m, cores));
    genTimes.length = 0;
    turboNext = 0;
    stageDirty = true;
    lspeedBtns.forEach(({ sm, b }) => {
      b.classList.toggle('active', sm.key === m);
      b.setAttribute('aria-pressed', String(sm.key === m));
    });
    const sm = SPEED_MODES.find((x) => x.key === m)!;
    $('lspeed-help').textContent = `${sm.help(workersFor(m, cores))} Le résultat est exactement le même dans les trois modes : seule la vitesse change.`;
    refreshTexts();
  }

  // ---------------------------------------------------------------------------
  // Rediffusion animée du cerveau affiché (+ fantôme)
  // ---------------------------------------------------------------------------
  const stage = $<HTMLCanvasElement>('stage');
  type Replay = { walker: Walker; policy: ReturnType<typeof policyFromParams>; label: string; key: string };
  let replay: Replay | null = null;
  let ghost: { walker: Walker; policy: ReturnType<typeof policyFromParams>; label: string } | null = null;
  let holdUntil = 0;
  let acc = 0;
  let lastNow = 0;
  let camX = 0;
  let turboNext = 0;
  const obs = new Float64Array(OBS_SIZE);
  const ghostObs = new Float64Array(OBS_SIZE);
  const measures: Measure[] = [];
  let lastResult: { distance: number; time: number; energy: number; fell: boolean } | null = null;

  function ghostWanted(): boolean {
    return settings.ghost && !(isHealthy(config) && champion.source === 'healthy');
  }

  function brainLabel(c: Champion): string {
    if (c.source === 'healthy') return 'cerveau sain';
    if (c.source === 'injured') return 'cerveau adapté au genou';
    if (c.source === 'random') return 'cerveau au hasard';
    return `appris ici (gén. ${c.gen})`;
  }

  /** Turbo sans revue : pas d'animation, une image fixe de temps en temps. */
  const turboStill = () => speedMode === 'turbo' && !viewing && !compare;

  function restartReplay(skipEval = false) {
    if (viewing) {
      replay = {
        walker: new Walker(viewing.config),
        policy: policyFromParams(viewing.params),
        label: `génération ${viewing.gen} (moment clé)`,
        key: `gen${viewing.gen}`,
      };
    } else {
      replay = { walker: new Walker(config), policy: policyFromParams(champion.params), label: brainLabel(champion), key: champion.source };
    }
    // La simulation est déterministe : on calcule tout de suite le résultat de l'essai qui commence
    // (≈ 20 ms), pour que les tuiles ne restent pas vides pendant la rediffusion.
    if (!skipEval) {
      const r = runEpisode(replay.policy, replay.walker.config, settings.objectives);
      lastResult = { distance: r.distance, time: r.time, energy: r.energy, fell: r.fell };
    }
    if (compare) {
      ghost = { walker: new Walker(compare.config), policy: policyFromParams(compare.params), label: `fantôme : génération ${compare.gen}` };
    } else if (viewing && settings.ghost && !(sameParams(viewing.params, champion.params) && sameWorld(viewing.config, config))) {
      // (Pas de fantôme quand la génération regardée est déjà le cerveau du direct : les deux robots se superposeraient.)
      ghost = { walker: new Walker(config), policy: policyFromParams(champion.params), label: `fantôme : le direct (${brainLabel(champion)})` };
    } else if (!viewing && ghostWanted()) {
      ghost = { walker: new Walker(HEALTHY), policy: policyFromParams(ghostParams), label: 'fantôme : robot intact, cerveau sain' };
    } else ghost = null;
    $('ghost-legend').textContent = ghost ? ghost.label : '';
    $('ghost-legend-item').hidden = !ghost;
    holdUntil = 0;
    acc = 0;
    camX = 0;
    stageDirty = true;
    updateStats();
  }

  function recordMeasure(w: Walker, r: Replay) {
    const label = `${r.label} · ${worldLabel(w.config)}`;
    // Un seul cerveau « appris ici » par monde : le plus récent remplace les précédents.
    const key = `${r.key}|${worldLabel(w.config)}`;
    const m: Measure = { key, label, distance: w.distance, time: w.time, energy: w.energy, fell: w.fell };
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
        recordMeasure(w, replay);
        holdUntil = performance.now() + HOLD_MS;
        updateStats();
      }
    }
    if (ghost && !ghost.walker.done) ghost.walker.step(ghost.policy.act(ghost.walker.observe(ghostObs)));
  }

  function frame(now: number) {
    const dtReal = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
    lastNow = now;
    if (turboStill()) {
      // Turbo : on joue l'essai du meilleur cerveau d'un coup (≈ 20 ms) et on montre sa dernière image.
      if (now >= turboNext) {
        turboNext = now + TURBO_REFRESH_MS;
        restartReplay(true);
        while (!replay!.walker.done) stepReplay();
        camX = replay!.walker.x + 0.4;
        stageDirty = true;
        refreshTexts();
        chartDirty = true;
      }
      if (stageDirty) {
        stageDirty = false;
        draw();
      }
      return;
    }
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
    const lines = [`${fmt(wk.distance, 2)} m · ${fmt(t, 1)} s / ${EPISODE_SECONDS} s`, viewing ? `Vous regardez la génération ${viewing.gen}` : replay.label];
    if (turboStill()) lines.push('Turbo : une image toutes les 3 s');
    const right = [worldLabel(wk.config)];
    if (ghost) right.push(`${ghost.label.replace('fantôme : ', 'fantôme ')} : ${fmt(ghost.walker.distance, 2)} m`);
    let banner: { text: string; bad: boolean } | null = null;
    // En Turbo, l'image fixe montre la fin de l'essai : la distance est déjà dans l'encadré, le bandeau masquerait le robot.
    if (wk.done && !turboStill()) {
      banner = wk.fell
        ? { text: `Chute après ${fmt(wk.time, 1)} s, à ${fmt(wk.distance, 2)} m`, bad: true }
        : { text: `${fmt(wk.distance, 2)} m en ${EPISODE_SECONDS} s (${fmt(wk.distance / wk.time, 2)} m/s)`, bad: false };
    }
    drawStage(ctx, w, h, theme, { x: camX }, view, gv, { lines, right, banner });
  }

  disposers.push(rafLoop(frame));
  disposers.push(onResize(stage, () => (stageDirty = true)));
  $('btn-replay').addEventListener('click', () => {
    turboNext = 0;
    restartReplay();
  });

  const ghostBox = $<HTMLInputElement>('ghost');
  ghostBox.addEventListener('change', () => {
    settings.ghost = ghostBox.checked;
    turboNext = 0;
    restartReplay();
    refreshViewing();
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
  // Revue d'un moment clé
  // ---------------------------------------------------------------------------
  const viewingBar = $('viewing');
  function viewMoment(m: Moment | null) {
    viewing = m;
    if (!m) compare = null;
    turboNext = 0;
    restartReplay();
    refreshViewing();
  }
  function toggleCompare(m: Moment) {
    compare = compare === m ? null : m;
    turboNext = 0;
    restartReplay();
    refreshViewing();
  }
  function refreshViewing() {
    viewingBar.hidden = !viewing && !compare;
    $('viewing-title').textContent = viewing ? `Vous regardez la génération ${viewing.gen}.` : 'Comparaison avec le direct.';
    const parts: string[] = [];
    if (viewing) {
      const what = viewing.label.replace(/^Génération \d+ : /, '');
      parts.push(`${what.charAt(0).toUpperCase()}${what.slice(1)} · ${worldLabel(viewing.config)}.`);
    }
    if (compare) parts.push(`En fantôme : génération ${compare.gen} (${fmt(compare.distance, 1)} m).`);
    else if (viewing && ghost) parts.push('En fantôme : le direct.');
    if (pool.isRunning) parts.push('L’apprentissage continue en arrière-plan.');
    $('viewing-sub').textContent = parts.join(' ');
    $('btn-stop-compare').hidden = !compare;
    timelineView.render(tlState());
    chartDirty = true;
  }
  $('btn-live').addEventListener('click', () => viewMoment(null));
  $('btn-stop-compare').addEventListener('click', () => {
    compare = null;
    turboNext = 0;
    restartReplay();
    refreshViewing();
  });

  const chart = $<HTMLCanvasElement>('chart');
  const timelineView = new TimelineView(
    timeline,
    $<HTMLOListElement>('moments'),
    $<HTMLInputElement>('scrub'),
    $('scrub-out'),
    $<HTMLCanvasElement>('chart-marks'),
    chart,
    { onView: (m) => viewMoment(m), onCompare: (m) => toggleCompare(m) },
  );
  const tlState = () => ({ viewing, compare, chartLength: bestDist.length });

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

  /** Charge une histoire pré-enregistrée dans la frise et la courbe. */
  function loadStory(stories: Story[], extra: Moment[] = []) {
    timeline.clear();
    meanFit.length = bestFit.length = meanDist.length = bestDist.length = 0;
    let end = 0;
    for (const st of stories) {
      for (const m of st.moments) timeline.moments.push({ ...m, params: m.params.slice() });
      meanFit.push(...st.curve.meanFit);
      bestFit.push(...st.curve.bestFit);
      meanDist.push(...st.curve.meanDist);
      bestDist.push(...st.curve.bestDist);
      end = Math.max(end, storyEnd(st));
    }
    for (const m of extra) timeline.moments.push({ ...m, params: m.params.slice() });
    generation = genBase = end;
    timeline.newSegment();
    timelineView.scrollToStart();
  }

  function applyScenario(key: string) {
    const sc = SCENARIOS[key];
    scenarioKey = key;
    pool.stop();
    config = { ...sc.config };
    viewing = compare = null;
    runStarted = false;
    runGen = 0;
    if (key === 'healthy') loadStory([STORIES.healthy]);
    else if (key === 'injuredBefore') loadStory([STORIES.healthy], STORIES.injured.moments.filter((m) => m.kind === 'after'));
    else if (key === 'injuredAfter') loadStory([STORIES.healthy, STORIES.injured]);
    else loadStory([]);
    lastWorld = { ...config };
    const fg = sc.brain === 'healthy' ? finalGen(STORIES.healthy) : sc.brain === 'injured' ? finalGen(STORIES.injured) : 0;
    champion = { params: brainParams(sc.brain), source: sc.brain, gen: fg };
    chartDirty = true;
    if (sc.autoTrain) {
      startRun(champion.params, true);
      setTraining(true);
    }
    refreshScenario();
    settingsUI.refreshInterventions();
    restartReplay();
    refreshViewing();
    updateButtons();
    refreshTexts();
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
      scenarioInfo.textContent = 'Situation personnalisée. Choisissez un scénario pour revenir à une histoire guidée.';
    }
  }

  function clearScenario() {
    if (scenarioKey === null) return;
    scenarioKey = null;
    refreshScenario();
  }

  // ---------------------------------------------------------------------------
  // Interventions, objectifs, paramètres experts (settings-ui.ts)
  // ---------------------------------------------------------------------------
  let worldChangedMsg = '';
  const settingsUI = mountSettings(root, settings, {
    getConfig: () => config,
    setConfig: (c) => {
      config = c;
      worldChanged();
    },
    objectivesChanged: () => {
      pool.setObjectives(settings.objectives);
      pool.setHyper(settings.es);
      // Le score du record n'est plus comparable : le prochain cerveau évalué devient la référence.
      record = -Infinity;
    },
    workerInfo: `Calcul réparti sur ${nWorkers} Web Worker${nWorkers > 1 ? 's' : ''} au plus (selon le nombre de cœurs de votre appareil et la vitesse d’apprentissage choisie). Le résultat est le même quel que soit leur nombre : chaque variante est évaluée d’après son numéro, peu importe qui la calcule.`,
  });

  /** Le monde a changé : on garde le cerveau, on met l'apprentissage en pause et on rejoue. */
  function worldChanged() {
    clearScenario();
    const wasRunning = pool.isRunning;
    pool.stop();
    runStarted = false; // le prochain « Apprendre » repartira du cerveau affiché, dans ce nouveau monde
    worldChangedMsg = wasRunning
      ? 'Monde modifié : l’apprentissage est en pause. Regardez comment le cerveau actuel s’en sort, puis cliquez sur « Réapprendre ».'
      : 'Monde modifié : le cerveau n’a pas changé. Regardez comment il s’en sort, puis cliquez sur « Réapprendre » pour qu’il s’adapte.';
    settingsUI.refreshInterventions();
    viewing = compare = null;
    turboNext = 0;
    restartReplay();
    refreshViewing();
    updateButtons();
    updateStatus();
  }

  // ---------------------------------------------------------------------------
  // Graphique, statistiques, statut
  // ---------------------------------------------------------------------------
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
        ? 'Score (la récompense) de chaque génération, formule dans « Ce que le robot cherche ». La meilleure variante monte vite ; la moyenne suit : c’est tout le groupe qui progresse. Quand les courbes deviennent plates, l’apprentissage a atteint son plafond.'
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
    timelineView.drawMarks(theme, tlState());
  }
  let lastChartDraw = 0;
  const chartLoop = rafLoop((now) => {
    if (!chartDirty) return;
    // En Turbo, on redessine au plus une fois par seconde pour laisser le processeur à l'apprentissage.
    if (speedMode === 'turbo' && now - lastChartDraw < 1000) return;
    chartDirty = false;
    lastChartDraw = now;
    drawChartNow();
    timelineView.render(tlState());
  });
  disposers.push(chartLoop);
  disposers.push(onResize(chart, () => (chartDirty = true)));

  function updateStats() {
    $('st-gen').textContent = viewing && viewing.gen !== generation ? `${viewing.gen} (direct : ${generation})` : String(generation);
    if (lastResult) {
      $('st-dist').textContent = `${fmt(lastResult.distance, 2)} m${lastResult.fell ? ' (chute)' : ''}`;
      $('st-speed').textContent = `${fmt(lastResult.distance / Math.max(lastResult.time, DT), 2)} m/s`;
      $('st-energy').textContent = `${fmt(lastResult.energy, 0)} J`;
    }
  }

  function refreshTexts() {
    updateStats();
    updateStatus();
    const gps = gensPerSecond();
    $('gps').textContent = pool.isRunning ? (gps > 0 ? `≈ ${fmt(gps, 1)} génération${gps >= 2 ? 's' : ''} par seconde` : 'mesure…') : '';
  }

  function updateStatus() {
    let msg: string;
    let done = false;
    if (workerFailed) msg = 'Le calcul en arrière-plan (Web Worker) n’a pas pu démarrer dans ce navigateur : la rediffusion fonctionne, mais pas l’apprentissage.';
    else if (runGen >= MAX_GENERATIONS) {
      msg = `Arrêt automatique après ${MAX_GENERATIONS} générations.`;
      done = true;
    } else if (pool.isRunning) {
      msg =
        runGen === 0
          ? 'Première génération en cours…'
          : `Apprentissage en cours : génération ${generation} (${fmt(lastGenMs / 1000, 2)} s par génération, ${settings.es.popSize} essais de 10 s au plus). Le robot affiché en direct est le meilleur cerveau trouvé jusqu’ici.`;
      if (champion.source === 'learned' && runGen > PLATEAU_GENS && generation - champion.gen >= PLATEAU_GENS) {
        msg += ` Plus de progrès depuis ${generation - champion.gen} générations : l’apprentissage a sans doute atteint son plafond, vous pouvez cliquer sur « Pause ».`;
        done = true;
      }
      worldChangedMsg = '';
    } else if (worldChangedMsg) msg = worldChangedMsg;
    else if (runStarted && runGen > 0) msg = `En pause à la génération ${generation}.`;
    else if (champion.source === 'random') msg = 'Cerveau au hasard. Cliquez sur « Apprendre ».';
    else
      msg = `Le robot rejoue son meilleur essai (après ${generation} générations d’entraînement). Cliquez sur « Apprendre » pour continuer, sur un moment clé pour revoir le passé, ou essayez une intervention.`;
    const st = $('status');
    st.textContent = msg;
    st.classList.toggle('walker-status-done', done);
  }

  // En Turbo, les textes sont rafraîchis au rythme des images fixes ; sinon une fois par seconde suffit pour le débit.
  const gpsTimer = window.setInterval(() => {
    if (speedMode !== 'turbo') $('gps').textContent = pool.isRunning && gensPerSecond() > 0 ? `≈ ${fmt(gensPerSecond(), 1)} génération${gensPerSecond() >= 2 ? 's' : ''} par seconde` : pool.isRunning ? 'mesure…' : '';
  }, 1000);
  disposers.push(() => window.clearInterval(gpsTimer));

  // ---------------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------------
  setSpeedMode('fast');
  applyScenario('healthy');

  return () => {
    for (const d of disposers.splice(0)) d();
    replay = null;
    ghost = null;
  };
}
