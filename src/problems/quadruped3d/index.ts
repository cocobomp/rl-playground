import './style.css';
import { TEMPLATE } from './template';
import {
  EXPERT_SLIDERS,
  INTERVENTIONS,
  SCENARIOS,
  SIGMA_LEVELS,
  SPEED_MODES,
  Scenario,
  Settings,
  SpeedMode,
  TRAITS,
  Trait,
  defaultSettings,
  describeWorld,
  fillFigures,
  rewardOf,
  workersFor,
} from './config';
import { DEFAULT_WORLD, DT, EPISODE_SECONDS, EPISODE_STEPS, NUM_JOINTS, OBS_SIZE, QuadrupedEnv, WorldParams, initPhysics, newEnvFor } from './env';
import { BrainPolicy, evaluate, gaitOf, makePolicy, randomBrain } from './agent';
import { PRETRAINED_BROKEN, PRETRAINED_HEALTHY, PRETRAINED_STORY, storyLabel } from './pretrained';
import { drawBrainPanel } from './draw';
import { RobotView, webglAvailable } from './view3d';
import { EvalPool, defaultWorkerCount } from './pool';
import { TrainingLoop } from './trainloop';
import { Moment, MomentStore } from './moments';
import { Timeline } from './timeline';
import { WORLD_PRESETS } from './worlds';
import { drawChart } from '../../shared/chart';
import { createSlider, onResize, onThemeChange, rafLoop, readTheme } from '../../shared/ui';

/** Durée du rejeu quand on n'entraîne pas (s) : on laisse le robot marcher plus longtemps que l'essai noté. */
const LONG_REPLAY_SECONDS = 20;
/** Pause après une chute avant de recommencer (s). */
const FALL_PAUSE = 1.2;

const fr = (v: number, d = 2) => v.toFixed(d).replace('.', ',').replace('-', '−');
const fmtM = (v: number) => `${fr(v)} m`;
const fmt1 = (v: number) => `${fr(v, 1)} m`;

export function mount(root: HTMLElement): () => void {
  root.innerHTML = fillFigures(TEMPLATE.replace('{{healthyGen}}', String(PRETRAINED_HEALTHY.generation)), '&nbsp;');
  const disposers: Array<() => void> = [];
  let disposed = false;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector(`#quadruped3d-${id}`) as T;

  const settings: Settings = defaultSettings();
  let theme = readTheme();

  // ---------------------------------------------------------------------------
  // Cerveau en direct, historique, moments clés
  // ---------------------------------------------------------------------------
  let brain: Float64Array = Float64Array.from(PRETRAINED_HEALTHY.params);
  let brainLabel = 'pré-entraîné (robot intact)';
  /** Cerveau reçu de l'entraînement, affiché au prochain recommencement du rejeu. */
  let pendingBrain: { params: Float64Array; label: string } | null = null;
  const distHistory: number[] = [];
  const fitHistory: number[] = [];
  let generation = 0;
  let record = -Infinity;
  let chartDirty = true;
  let lastGen: { generation: number; distance: number; fell: boolean; params: Float64Array; world: WorldParams } | null = null;
  const moments = new MomentStore();
  /** Ce que décrit la phase en cours (pour les étiquettes « après adaptation »). */
  let phaseWhat = '';
  let adaptedMarked = false;
  let baseline: number | null = null;
  let baselineIndex = 0;
  let plateauSeen = false;
  const PLATEAU_WINDOW = 15;
  const markBaseline = () => {
    baseline = lastEval ? lastEval.distance : null;
    baselineIndex = distHistory.length;
    plateauSeen = false;
    adaptedMarked = false;
  };

  // ---------------------------------------------------------------------------
  // Entraînement : stratégie d'évolution ici, essais dans plusieurs workers
  // ---------------------------------------------------------------------------
  const hwc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  const maxWorkers = defaultWorkerCount(hwc);
  let pool: EvalPool | null = null;
  try {
    pool = new EvalPool(() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }), workersFor(settings.speed, maxWorkers));
    pool.onError = (msg) => {
      loop?.stop();
      training = false;
      updateButtons();
      setStatus(`Erreur dans l’entraînement : ${msg}`);
    };
  } catch {
    pool = null;
  }
  const loop = pool ? new TrainingLoop(pool) : null;
  disposers.push(() => {
    loop?.stop();
    pool?.dispose();
  });
  let seed = 1;
  let training = false;
  let needReset = true;
  let genOffset = 0;

  if (loop) {
    loop.onGeneration = (r, params, world) => {
      if (disposed) return;
      generation = genOffset + r.generation;
      distHistory.push(r.distance);
      fitHistory.push(r.fitness);
      chartDirty = true;
      record = Math.max(record, r.distance);
      lastEval = { distance: r.distance, energy: r.energy, fell: r.fell };
      lastGen = { generation, distance: r.distance, fell: r.fell, params, world };
      pendingBrain = { params, label: `génération ${generation}` };
      const added = moments.observe({ generation, distance: r.distance, fell: r.fell }, params, world);
      if (!plateauSeen && isPlateau()) {
        plateauSeen = true;
        if (phaseWhat && !adaptedMarked) {
          adaptedMarked = true;
          moments.markAdapted({ generation, distance: r.distance, fell: r.fell }, params, world, phaseWhat);
          added.push(moments.moments[moments.moments.length - 1]);
        }
      }
      if (added.length) timeline.setMoments(moments.moments);
      updateStats();
      if (training) {
        const from = baseline !== null ? ` (au départ : ${fmtM(baseline)})` : '';
        const fell = r.fell ? ' mais il tombe encore avant la fin' : ', sans chute';
        let msg = `Génération ${generation} : le cerveau actuel parcourt ${fmtM(r.distance)} en 8 s${from}${fell}.`;
        if (plateauSeen)
          msg += ' La courbe ne monte presque plus depuis une quinzaine de générations : l’essentiel est appris, vous pouvez cliquer sur « Pause » (de petits progrès restent possibles).';
        else if (isStuck())
          msg += ' Toujours pas de vraie démarche après tant de générations : cet apprentissage est coincé (cela arrive), essayez « Repartir de zéro » pour retenter avec un autre hasard.';
        if (added.length) msg += ` Nouveau moment clé : « ${added[added.length - 1].label} ».`;
        setStatus(msg, plateauSeen);
      }
    };
  }

  const GAIT_DISTANCE = 4;
  /** Le cerveau en cours d'apprentissage est parti d'un tirage au hasard (pas d'un cerveau pré-entraîné). */
  let fromScratch = false;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  function isPlateau(): boolean {
    const h = distHistory.slice(baselineIndex);
    if (h.length < 2 * PLATEAU_WINDOW + 10) return false;
    const recent = mean(h.slice(-PLATEAU_WINDOW));
    const before = mean(h.slice(-2 * PLATEAU_WINDOW, -PLATEAU_WINDOW));
    return recent >= GAIT_DISTANCE && recent - before < 0.15 * Math.max(1, recent / 5);
  }
  /** Départ de zéro coincé : après 80 générations, toujours pas de vraie démarche (mesuré : ces départs-là restent sous 4 m). */
  function isStuck(): boolean {
    const h = distHistory.slice(baselineIndex);
    return fromScratch && h.length >= 80 && mean(h.slice(-PLATEAU_WINDOW)) < GAIT_DISTANCE;
  }

  /** Graine imposée par un scénario pour le prochain apprentissage (sinon : un nouveau hasard). */
  let fixedTrainerSeed: number | null = null;
  function resetTrainer(): void {
    if (!loop) return;
    genOffset = generation;
    loop.reset(brain, settings.world, rewardOf(settings), settings.hyper, fixedTrainerSeed ?? seed++);
    fixedTrainerSeed = null;
    needReset = false;
  }

  function setTraining(on: boolean): void {
    if (!loop) {
      setStatus('L’apprentissage nécessite les Web Workers, indisponibles ici.');
      return;
    }
    if (on && needReset) resetTrainer();
    training = on;
    if (on) loop.start();
    else loop.stop();
    updateButtons();
    if (on) {
      setStatus(
        `Apprentissage en cours : chaque génération essaie ${settings.hyper.popSize} variantes du cerveau pendant 8 s simulées, réparties sur ${pool!.size} fil${pool!.size > 1 ? 's' : ''} de calcul, puis le cerveau avance vers les meilleures. ` +
          'Le robot à l’écran prend le nouveau cerveau à chaque nouvel essai.',
      );
      if (!viewing) restartReplay();
    } else setStatus(`En pause à la génération ${generation}. « Reprendre » continue à partir du cerveau actuel.`);
    updateTurbo();
  }

  /** Remplace le cerveau (pré-entraîné, aléatoire, scénario) : l'historique et les moments repartent de zéro. */
  function loadBrain(params: ArrayLike<number>, label: string, story: 'healthy' | 'broken' | 'none'): void {
    if (training) {
      training = false;
      loop?.stop();
    }
    brain = Float64Array.from(params);
    brainLabel = label;
    fromScratch = story === 'none';
    pendingBrain = null;
    needReset = true;
    fixedTrainerSeed = null;
    distHistory.length = 0;
    fitHistory.length = 0;
    generation = 0;
    genOffset = 0;
    record = -Infinity;
    chartDirty = true;
    lastGen = null;
    phaseWhat = '';
    moments.clear();
    if (story === 'healthy') {
      moments.addOffline(
        PRETRAINED_STORY.map((m) => ({
          generation: m.generation,
          kind: 'offline' as const,
          label: storyLabel(m),
          distance: m.distance,
          fell: m.fell,
          params: Float64Array.from(m.params),
          world: { ...DEFAULT_WORLD },
        })),
      );
    } else if (story === 'broken') {
      const broken = { ...DEFAULT_WORLD, ...WORLD_PRESETS.broken };
      const h = evaluate(PRETRAINED_HEALTHY.params, broken, rewardOf(settings));
      moments.addOffline([
        { generation: PRETRAINED_HEALTHY.generation, kind: 'offline', label: `Avant la blessure : le cerveau du robot intact, ${fmt1(PRETRAINED_HEALTHY.distance)}`, distance: PRETRAINED_HEALTHY.distance, fell: false, params: Float64Array.from(PRETRAINED_HEALTHY.params), world: { ...DEFAULT_WORLD } },
        { generation: 0, kind: 'offline', label: `Juste après la blessure : même cerveau, ${fmt1(h.distance)}${h.fell ? ', il tombe' : ''}`, distance: h.distance, fell: h.fell, params: Float64Array.from(PRETRAINED_HEALTHY.params), world: broken },
        { generation: PRETRAINED_BROKEN.generation, kind: 'offline', label: `Après adaptation (${PRETRAINED_BROKEN.generation} générations) : ${fmt1(PRETRAINED_BROKEN.distance)} sur 3 pattes`, distance: PRETRAINED_BROKEN.distance, fell: false, params: Float64Array.from(PRETRAINED_BROKEN.params), world: broken },
      ]);
    }
    moments.newPhase();
    setViewing(null);
    setGhost(null);
    timeline.setMoments(moments.moments);
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
  // Rejeu 3D (robot principal + fantôme éventuel)
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

  /** Moment revu (null : le direct). */
  let viewing: Moment | null = null;
  /** Fantôme : un moment, le cerveau en direct, ou rien. */
  let ghostSel: Moment | 'live' | null = null;

  interface Runner {
    env: QuadrupedEnv;
    policy: BrainPolicy;
    world: WorldParams;
    fallTimer: number;
    dist8: number | null;
  }
  let main: Runner | null = null;
  let ghost: Runner | null = null;
  const obs = new Float64Array(OBS_SIZE);
  const gobs = new Float64Array(OBS_SIZE);
  let actuated: boolean[] = new Array(NUM_JOINTS).fill(true);
  let acc = 0;
  let mainGait = gaitOf(brain);

  const makeRunner = (params: ArrayLike<number>, world: WorldParams): Runner => {
    const policy = makePolicy(params);
    return { env: newEnvFor(policy, world), policy, world: { ...world }, fallTimer: 0, dist8: null };
  };

  function restartReplay(): void {
    if (!physicsReady || disposed) return;
    if (pendingBrain && !viewing) {
      brain = pendingBrain.params;
      brainLabel = pendingBrain.label;
      pendingBrain = null;
    }
    main?.env.free();
    const params = viewing ? viewing.params : brain;
    const world = viewing ? viewing.world : settings.world;
    main = makeRunner(params, world);
    mainGait = gaitOf(params);
    actuated = Array.from({ length: NUM_JOINTS }, (_, j) => main!.env.isActuated(j));
    ghost?.env.free();
    ghost = null;
    if (ghostSel) {
      const gp = ghostSel === 'live' ? (pendingBrain?.params ?? brain) : ghostSel.params;
      const gw = ghostSel === 'live' ? settings.world : ghostSel.world;
      ghost = makeRunner(gp, gw);
    }
    acc = 0;
    view?.setWorld(world);
    view?.setGhost(ghost ? ghost.world : null);
    view?.snapCamera(0);
    if (view && main) view.update(main.env.poses());
    if (view && ghost) view.updateGhost(ghost.env.poses());
  }
  disposers.push(() => {
    main?.env.free();
    ghost?.env.free();
    main = ghost = null;
  });

  function stepRunner(r: Runner, o: Float64Array): void {
    if (r.env.fallen) {
      r.fallTimer += DT;
      return;
    }
    r.env.observe(o);
    r.env.step(r.policy(o));
    if (r.env.steps === EPISODE_STEPS || (r.env.fallen && r.dist8 === null)) r.dist8 = r.env.distance;
  }

  function stepReplay(): void {
    if (!main) return;
    stepRunner(main, obs);
    if (ghost) stepRunner(ghost, gobs);
    const limit = training && !viewing ? EPISODE_SECONDS : LONG_REPLAY_SECONDS;
    const done = (r: Runner) => (r.env.fallen ? r.fallTimer >= FALL_PAUSE : r.env.time >= limit - 1e-9);
    // Avec un fantôme, on recommence quand les deux ont fini (chute ou fin de l'essai).
    if (done(main) && (!ghost || done(ghost))) restartReplay();
  }

  let lastNow = 0;
  let frame = 0;
  const brainCanvas = $<HTMLCanvasElement>('brain');
  const chartCanvas = $<HTMLCanvasElement>('chart');
  let lastSpeedUpdate = 0;
  disposers.push(
    rafLoop((now) => {
      const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      lastNow = now;
      const frozen = turboFrozen();
      if (main && !frozen) {
        acc += dt * settings.replaySpeed;
        let n = 0;
        while (acc >= DT && n < 8) {
          stepReplay();
          acc -= DT;
          n++;
        }
        if (n === 8) acc = 0;
        if (main) {
          view?.update(main.env.poses());
          if (ghost) view?.updateGhost(ghost.env.poses());
          updateHud();
        }
      }
      if (!frozen || frame % 15 === 0) view?.render();
      if (!frozen && frame % 2 === 0)
        drawBrainPanel(
          brainCanvas,
          main ? { obs, out: main.policy.last, legs: mainGait.legs, hz: mainGait.hz, phase: main.env.phase } : null,
          actuated,
          theme,
        );
      frame++;
      if (chartDirty) drawChartNow();
      if (now - lastSpeedUpdate > 500) {
        lastSpeedUpdate = now;
        updateSpeedStat();
      }
    }),
  );

  function updateHud(): void {
    if (!main) return;
    const e = main.env;
    const parts = [`<span>t = ${fr(e.time, 1)} s</span>`, `<span>distance ${fmtM(e.distance)}</span>`];
    parts.push(`<span>cerveau : ${viewing ? `génération ${viewing.generation}${viewing.offline ? ' (hors ligne)' : ''}` : brainLabel}</span>`);
    if (main.dist8 !== null && e.time > EPISODE_SECONDS) parts.push(`<span>à 8 s : ${fmtM(main.dist8)}</span>`);
    if (ghost) parts.push(`<span class="quadruped3d-hud-ghost">fantôme : ${fmtM(ghost.env.distance)}${ghost.env.fallen ? ' (chute)' : ''}</span>`);
    if (e.fallen) parts.push('<span class="quadruped3d-hud-bad">Chute ! Nouvel essai…</span>');
    const html = parts.join('');
    if (hud.innerHTML !== html) hud.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // Moments clés : revoir, comparer
  // ---------------------------------------------------------------------------
  const viewingBox = $('viewing');
  const viewingText = $('viewing-text');
  function setViewing(m: Moment | null): void {
    viewing = m;
    viewingBox.hidden = !m;
    if (m) {
      const w = describeWorld(m.world);
      viewingText.textContent = `Vous regardez la génération ${m.generation}${m.offline ? ' (entraînement hors ligne)' : ''} : ${fmt1(m.distance)} en 8 s${m.fell ? ', avec chute' : ''}${w ? ` · ${w}` : ''}.`;
    }
    timeline.setViewing(m);
    updateTurbo();
  }
  function setGhost(g: Moment | 'live' | null): void {
    ghostSel = g;
    timeline.setGhost(g);
  }
  const timeline = new Timeline(root, {
    onView: (m) => {
      setViewing(m);
      restartReplay();
      if (m)
        setStatus(
          `Rejeu de « ${m.label} ».${training ? ' L’apprentissage continue en arrière-plan.' : ''} Cliquez sur « Revenir au direct » pour retrouver le cerveau actuel.`,
        );
    },
    onGhost: (g) => {
      setGhost(g);
      restartReplay();
      if (g) setStatus(`Fantôme gris dans le couloir voisin : ${g === 'live' ? 'le cerveau en direct' : `« ${g.label} »`}. Les deux robots partent en même temps.`);
    },
  });
  $('live').addEventListener('click', () => {
    setViewing(null);
    restartReplay();
    setStatus(training ? `Retour au direct : génération ${generation}.` : 'Retour au cerveau actuel.');
  });
  $('compare-quick').addEventListener('click', () => {
    const ms = moments.moments;
    if (ms.length < 2) {
      setStatus('Il faut au moins deux moments clés pour comparer : lancez l’apprentissage quelques instants.');
      return;
    }
    // Fantôme : un moment du début où le robot avance déjà un peu (la génération 0 tombe souvent sur place).
    const first = ms.find((m) => m.distance >= 1 && m !== ms[ms.length - 1]) ?? ms[0];
    const best = ms.reduce((a, b) => (b.distance > a.distance ? b : a), ms[ms.length - 1]);
    setGhost(first);
    setViewing(best);
    restartReplay();
    setStatus(`Comparaison : en couleur « ${best.label} », en gris « ${first.label} ».`);
  });

  // ---------------------------------------------------------------------------
  // Vitesse d'apprentissage
  // ---------------------------------------------------------------------------
  const speedBox = $('speed');
  const speedHelp = $('speed-help');
  const speedInputs = new Map<SpeedMode, HTMLInputElement>();
  for (const sm of SPEED_MODES) {
    const id = `quadruped3d-speed-${sm.id}`;
    const lab = document.createElement('label');
    lab.className = 'quadruped3d-speed-opt';
    lab.htmlFor = id;
    lab.innerHTML = `<input type="radio" name="quadruped3d-speed" id="${id}" value="${sm.id}" /> <span></span>`;
    lab.querySelector('span')!.textContent = sm.label;
    const input = lab.querySelector('input')!;
    input.checked = sm.id === settings.speed;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      settings.speed = sm.id;
      pool?.setSize(workersFor(sm.id, maxWorkers));
      refreshSpeedHelp();
      updateTurbo();
      if (!turboFrozen() && !viewing) restartReplay();
    });
    speedInputs.set(sm.id, input);
    speedBox.appendChild(lab);
  }
  function refreshSpeedHelp(): void {
    const sm = SPEED_MODES.find((s) => s.id === settings.speed)!;
    const n = workersFor(sm.id, maxWorkers);
    speedHelp.textContent = `${sm.help} Ici : ${n} fil${n > 1 ? 's' : ''} de calcul pour les essais (votre appareil annonce ${hwc ?? '?'} cœurs).`;
    $('cores').textContent = `${n}`;
  }
  /** En turbo, pendant l'apprentissage, l'animation du direct est suspendue. */
  const turboFrozen = () => settings.speed === 'turbo' && training && !viewing;
  function updateTurbo(): void {
    $('turbo').hidden = !turboFrozen();
  }
  function updateSpeedStat(): void {
    const g = loop && training ? loop.gensPerSecond() : 0;
    $('st-speed').textContent = training && g > 0 ? `${fr(g, 1)} gén./s` : '–';
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
    btnTrain.disabled = !loop || !physicsReady;
  }

  btnTrain.addEventListener('click', () => {
    if (!training && needReset) {
      moments.markRestart();
      if (!phaseWhat) phaseWhat = 'Réapprendre';
    }
    setTraining(!training);
  });
  $('btn-replay').addEventListener('click', () => restartReplay());
  $('btn-pretrained').addEventListener('click', () => {
    if (settings.world.brokenFrontLeft) {
      loadBrain(PRETRAINED_BROKEN.params, 'pré-entraîné (3 pattes)', 'broken');
      setStatus(`Cerveau pré-entraîné pour la patte avant gauche cassée : ${PRETRAINED_BROKEN.history}.`);
    } else {
      loadBrain(PRETRAINED_HEALTHY.params, 'pré-entraîné (robot intact)', 'healthy');
      setStatus(`Cerveau pré-entraîné hors ligne pour le robot intact : ${PRETRAINED_HEALTHY.history}.`);
    }
  });
  $('btn-scratch').addEventListener('click', () => {
    loadBrain(randomBrain(1000 + seed), 'aléatoire', 'none');
    setStatus(
      'Nouveau cerveau aléatoire : les métronomes battent, mais leurs réglages sont pris au hasard. Cliquez sur « Réapprendre ». Une fois sur deux ou trois, une vraie démarche (plus de 8 m) apparaît en moins de 100 générations ; sinon l’apprentissage reste coincé sous 4 m (le robot piétine, rampe ou se jette en avant) : retentez, c’est un autre hasard.',
    );
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
        const prev = { ...settings.world };
        iv.set(settings.world, input.checked);
        const what = `${input.checked ? '' : 'fin : '}${iv.label.toLowerCase()}`;
        onWorldChanged(`${input.checked ? 'Intervention' : 'Retour à la normale'} : « ${iv.label} ».`, what, prev);
      });
      interventionInputs.set(iv.id, input);
      box.appendChild(wrap);
    }
  }
  function syncInterventions(): void {
    for (const iv of INTERVENTIONS) interventionInputs.get(iv.id)!.checked = iv.get(settings.world);
  }
  function onWorldChanged(msg: string, what: string, prev: WorldParams): void {
    loop?.setWorld(settings.world);
    // « Avant » : le dernier cerveau noté, ou à défaut le cerveau affiché noté dans l'ancien monde.
    const before =
      lastGen ?? (lastEval ? { generation, distance: lastEval.distance, fell: lastEval.fell, params: brain, world: prev } : null);
    moments.markChange(before, what);
    phaseWhat = what;
    timeline.setMoments(moments.moments);
    record = -Infinity;
    clearScenarioButtons();
    evaluateCurrent();
    markBaseline();
    if (!viewing) restartReplay();
    const d = lastEval ? ` Avec le cerveau actuel, il parcourt maintenant ${fmtM(lastEval.distance)} en 8 s${lastEval.fell ? ' et tombe' : ''}.` : '';
    setStatus(
      `${msg}${d} ${training ? 'L’apprentissage continue dans ce nouveau monde.' : 'Cliquez sur « ' + (needReset ? 'Réapprendre' : 'Reprendre') + ' » pour qu’il s’adapte.'}`,
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
          loop?.setHyper({ sigma: settings.hyper.sigma });
          syncExpert();
        } else {
          loop?.setReward(rewardOf(settings));
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
            loop?.setHyper({ [def.id]: v });
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
    loop?.setWorld(settings.world);
    if (sc.brain === 'random') loadBrain(randomBrain(sc.seeds?.brain ?? 2000 + seed), 'aléatoire', 'none');
    else if (sc.brain === 'broken') loadBrain(PRETRAINED_BROKEN.params, 'pré-entraîné (3 pattes)', 'broken');
    else loadBrain(PRETRAINED_HEALTHY.params, 'pré-entraîné (robot intact)', 'healthy');
    // Le cerveau sain posé dans un monde blessé : on garde la trace « avant / après » dans la frise.
    if (sc.brain === 'healthy' && sc.id !== 'demo') {
      moments.markChange(
        { generation: 0, distance: PRETRAINED_HEALTHY.distance, fell: false, params: PRETRAINED_HEALTHY.params, world: { ...DEFAULT_WORLD } },
        describeWorld(settings.world),
      );
      phaseWhat = describeWorld(settings.world);
      timeline.setMoments(moments.moments);
    }
    scenarioBox.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
    const info = $('scenario-info');
    info.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = `${sc.label}. `;
    info.append(strong, fillFigures(sc.description));
    fixedTrainerSeed = sc.seeds?.trainer ?? null;
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
  refreshSpeedHelp();
  updateStats();
  updateButtons();
  timeline.setMoments([]);
  setStatus('Chargement du moteur physique…');

  initPhysics()
    .then(() => {
      if (disposed) return;
      physicsReady = true;
      loading.hidden = !!view;
      loadBrain(PRETRAINED_HEALTHY.params, 'pré-entraîné (robot intact)', 'healthy');
      setStatus(
        `Le robot utilise un cerveau pré-entraîné (${PRETRAINED_HEALTHY.generation} générations hors ligne). Revoyez son apprentissage dans les « Moments clés », ou cassez-lui une patte (bloc « Commencez ici ») puis cliquez sur « Réapprendre ».`,
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
