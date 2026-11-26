import './style.css';
import { TEMPLATE } from './template';
import { AGENT_KNOBS, EXPERT_SLIDERS, Knob, SCENARIOS, Settings, WORLD_KNOBS, defaultSettings } from './config';
import { CartPole, DT, MAX_STEPS, hashSeed, observe } from './env';
import { Controller, PolicySpec, makeController } from './agent';
import { drawNetwork, drawStage, parseColor } from './draw';
import type { FromWorker, ToWorker } from './protocol';
import { drawChart } from '../../shared/chart';
import { createSlider, onResize, onThemeChange, rafLoop, readTheme } from '../../shared/ui';
import { mulberry32 } from '../../shared/rng';

/** Arrêt automatique de l'entraînement (évite des courbes interminables). */
const MAX_GENERATIONS = 300;
const MAX_RF_EPISODES = 6000;
/** Seuil « maîtrisé » : moyenne ≥ 475 pas. */
const SOLVED = 475;

const fmtSec = (steps: number) => `${(steps * DT).toFixed(1).replace('.', ',')} s`;
const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(0));

export function mount(root: HTMLElement): () => void {
  root.innerHTML = TEMPLATE;
  const disposers: Array<() => void> = [];
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector(`#cartpole-${id}`) as T;

  const settings: Settings = defaultSettings();
  let theme = readTheme();
  disposers.push(
    onThemeChange(() => {
      theme = readTheme();
      chartDirty = true;
    }),
  );

  // ---------------------------------------------------------------------------
  // Worker d'entraînement
  // ---------------------------------------------------------------------------
  let worker: Worker | null = null;
  let workerFailed = false;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    workerFailed = true;
  }
  const send = (m: ToWorker) => worker?.postMessage(m);
  disposers.push(() => worker?.terminate());

  let runId = 0;
  let training = false;
  const esMean: number[] = [];
  const esBest: number[] = [];
  const rfSteps: number[] = [];
  let markers: { i: number; label: string }[] = [];
  let totalEpisodes = 0;
  let record = 0;
  let generation = 0;
  /** Politique rejouée à l'écran (meilleur individu de la dernière génération, ou politique REINFORCE actuelle). */
  let champion: PolicySpec | null = null;
  let championGen = 0;
  let chartDirty = true;
  let scenarioKey: string | null = null;
  /** Histoire « Tempête » : calme → vent. */
  let stormPhase: 'off' | 'calm' | 'windy' = 'off';

  if (worker) {
    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.runId !== runId) return; // message d'un ancien apprentissage
      if (m.type === 'ready') {
        champion = m.policy;
        championGen = 0;
        newReplay();
      } else if (m.type === 'gen') {
        esMean.push(m.mean);
        esBest.push(m.best);
        generation = m.generation;
        totalEpisodes = m.episodes;
        record = Math.max(record, m.best);
        champion = m.champion;
        championGen = m.generation;
        afterProgress();
      } else if (m.type === 'episodes') {
        rfSteps.push(...m.steps);
        generation = m.episode;
        totalEpisodes = m.episode;
        for (const s of m.steps) record = Math.max(record, s);
        champion = m.policy;
        championGen = m.episode;
        afterProgress();
      }
    };
    worker.onerror = (e) => {
      e.preventDefault();
      workerFailed = true;
      setTraining(false);
      updateStatus();
    };
  }

  function recentMean(): number {
    if (settings.algo === 'es') return esMean.length ? esMean[esMean.length - 1] : NaN;
    const last = rfSteps.slice(-20);
    return last.length ? last.reduce((a, b) => a + b, 0) / last.length : NaN;
  }

  function afterProgress() {
    chartDirty = true;
    // Histoire « Tempête » : quand le calme est maîtrisé, le vent se lève.
    if (stormPhase === 'calm') {
      const ok = settings.algo === 'es' ? esMean.length >= 3 && esMean.slice(-3).every((v) => v >= SOLVED) : rfSteps.length >= 20 && recentMean() >= SOLVED;
      if (ok || generation >= 80) {
        stormPhase = 'windy';
        settings.world.windForce = 0.35;
        worldChanged('le vent se lève');
        refreshKnobs();
        flashUntil = generation + (settings.algo === 'es' ? 40 : 400);
        flashStatus = 'Le vent se lève ! L’agent n’a jamais connu de rafales : regardez la courbe chuter, puis remonter pendant qu’il apprend à y résister.';
      }
    }
    if (flashStatus && flashUntil > 0 && generation >= flashUntil) flashStatus = '';
    const finished = settings.algo === 'es' ? generation >= MAX_GENERATIONS : totalEpisodes >= MAX_RF_EPISODES;
    if (finished && training) setTraining(false);
    updateStats();
    updateStatus();
  }

  function resetLearning() {
    runId++;
    setTraining(false);
    esMean.length = 0;
    esBest.length = 0;
    rfSteps.length = 0;
    markers = [];
    totalEpisodes = 0;
    record = 0;
    generation = 0;
    championGen = 0;
    flashStatus = '';
    stormPhase = scenarioKey && SCENARIOS[scenarioKey].storm ? 'calm' : 'off';
    flashUntil = 0;
    if (stormPhase === 'calm' && settings.world.windForce !== 0) {
      // « Réinitialiser » pendant la Tempête : l'histoire recommence par temps calme.
      settings.world.windForce = 0;
      refreshKnobs();
    }
    const limit = settings.algo === 'es' ? MAX_GENERATIONS : MAX_RF_EPISODES;
    send({ type: 'reset', runId, algo: settings.algo, es: { ...settings.es }, rf: { ...settings.rf }, world: { ...settings.world }, limit });
    send({ type: 'pace', pace: settings.pace });
    chartDirty = true;
    updateLabels();
    updateStats();
    updateStatus();
  }

  function setTraining(on: boolean) {
    const finished = settings.algo === 'es' ? generation >= MAX_GENERATIONS : totalEpisodes >= MAX_RF_EPISODES;
    training = on && !!worker && !workerFailed && !finished;
    send({ type: 'run', on: training });
    btnRun.textContent = training ? 'Pause' : finished ? 'Recommencer' : generation > 0 ? 'Reprendre' : 'Apprendre';
    updateStatus();
  }

  /** Le monde a changé : on prévient le worker et on marque la courbe. */
  function worldChanged(label: string) {
    send({ type: 'world', world: { ...settings.world } });
    const n = settings.algo === 'es' ? esMean.length : rfSteps.length;
    if (n > 0) {
      markers = markers.filter((m) => m.i !== n);
      markers.push({ i: n, label });
      chartDirty = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Contrôles d'apprentissage
  // ---------------------------------------------------------------------------
  const btnRun = $<HTMLButtonElement>('btn-run');
  const btnUnit = $<HTMLButtonElement>('btn-unit');
  btnRun.addEventListener('click', () => {
    const finished = settings.algo === 'es' ? generation >= MAX_GENERATIONS : totalEpisodes >= MAX_RF_EPISODES;
    if (finished && !training) resetLearning();
    setTraining(!training);
  });
  btnUnit.addEventListener('click', () => {
    setTraining(false);
    send({ type: 'unit', episodes: 10 });
  });
  $('btn-reset').addEventListener('click', () => resetLearning());

  let flashStatus = '';
  /** Le message ponctuel disparaît après cette génération / cet épisode. */
  let flashUntil = 0;
  function updateStatus() {
    const el = $('status');
    let msg: string;
    if (workerFailed) msg = 'Le calcul en arrière-plan (Web Worker) n’a pas pu démarrer dans ce navigateur : l’apprentissage est indisponible.';
    else if (settings.algo === 'es' && generation >= MAX_GENERATIONS) msg = `Arrêt automatique après ${MAX_GENERATIONS} générations. Cliquez sur « Recommencer » pour repartir de zéro.`;
    else if (settings.algo === 'reinforce' && totalEpisodes >= MAX_RF_EPISODES) msg = `Arrêt automatique après ${MAX_RF_EPISODES} épisodes. Cliquez sur « Recommencer » pour repartir de zéro.`;
    else if (generation === 0)
      msg = training
        ? 'Première génération en cours…'
        : 'Prêt. Au départ, les poids du réseau sont tirés au hasard : le bâton tombe vite. Cliquez sur « Apprendre ».';
    else {
      const m = recentMean();
      const unit = settings.algo === 'es' ? `génération ${generation}` : `épisode ${generation}`;
      const head = training ? `Apprentissage en cours (${unit})` : `En pause (${unit})`;
      const verdict =
        m >= SOLVED
          ? training && scenarioKey !== 'storm' && settings.world.windForce === 0
            ? 'C’est appris : l’agent tient presque toujours les 10 s. Vous pouvez mettre en pause, ou essayer le scénario « Tempête ».'
            : 'C’est appris : l’agent tient presque toujours les 10 s.'
          : stormPhase === 'windy'
            ? 'Avec les rafales, c’est plus dur : l’agent apprend à y résister, mais le score reste irrégulier selon le vent tiré.'
          : m >= 195
            ? 'Il tient plus de 195 pas (près de 4 s) : c’était le seuil « résolu » de la version historique à 200 pas. Pas encore parfait…'
            : 'Il progresse…';
      msg = `${head} — score moyen récent : ${fmtNum(m)} pas sur 500 (${fmtSec(m)}). ${verdict}`;
    }
    el.textContent = flashStatus ? `${flashStatus} ${msg}` : msg;
    el.classList.toggle('cartpole-status-done', !workerFailed && generation > 0 && recentMean() >= SOLVED);
  }

  function updateLabels() {
    const es = settings.algo === 'es';
    $('st-iter-label').textContent = es ? 'Génération (ronde d’essais)' : 'Épisode (partie)';
    $('st-last-label').textContent = es ? 'Score moyen (pas tenus)' : 'Score moyen (20 dernières)';
    btnUnit.textContent = es ? 'Une génération' : '10 épisodes';
    $('chart-title').textContent = es ? 'Pas tenus par génération' : 'Pas tenus par épisode';
    $('chart-help').textContent = es
      ? 'Points et ligne pleine : nombre moyen de pas tenus par les variantes de chaque génération (ligne lissée sur 5 générations). Pointillés : la meilleure variante. Quand la ligne plafonne à 500 (10 s), c’est appris. Traits verticaux : le monde a changé.'
      : 'Points : pas tenus à chaque partie. Ligne : moyenne glissante sur 20 parties. Maximum : 500 pas (10 s). Remarquez les dents de scie et les rechutes, typiques de REINFORCE. Traits verticaux : le monde a changé.';
  }

  function updateStats() {
    $('st-iter').textContent = String(generation);
    const m = recentMean();
    $('st-last').textContent = Number.isNaN(m) ? '–' : fmtNum(m);
    $('st-best').textContent = record > 0 ? fmtNum(record) : '–';
    $('st-eps').textContent = totalEpisodes.toLocaleString('fr-FR');
  }

  // ---------------------------------------------------------------------------
  // Boutons haut niveau
  // ---------------------------------------------------------------------------
  const knobUIs: { knob: Knob; buttons: HTMLButtonElement[]; mapping: HTMLElement; output: HTMLElement; wrap: HTMLElement }[] = [];

  function buildKnobs(container: HTMLElement, knobs: Knob[]) {
    for (const knob of knobs) {
      const id = `cartpole-knob-${knob.id}`;
      const wrap = document.createElement('div');
      wrap.className = 'cartpole-knob';
      wrap.innerHTML = `
        <div class="slider-head"><span class="cartpole-knob-name" id="${id}-label"></span><output id="${id}-out"></output></div>
        <div class="segmented cartpole-seg" role="group" aria-labelledby="${id}-label"></div>
        <p class="help" id="${id}-help"></p>
        <p class="cartpole-mapping" id="${id}-map"></p>`;
      wrap.querySelector('.cartpole-knob-name')!.textContent = knob.label;
      wrap.querySelector('.help')!.textContent = knob.help;
      const seg = wrap.querySelector('.segmented')!;
      const buttons = knob.levels.map((level) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = level.label;
        b.setAttribute('aria-describedby', `${id}-help`);
        b.addEventListener('click', () => {
          if (level.is(settings)) return;
          level.apply(settings);
          onKnob(knob, level.label);
        });
        seg.appendChild(b);
        return b;
      });
      knobUIs.push({ knob, buttons, mapping: wrap.querySelector('.cartpole-mapping')!, output: wrap.querySelector('output')!, wrap });
      container.appendChild(wrap);
    }
  }

  function onKnob(knob: Knob, levelLabel: string) {
    // Le rythme ne change pas ce qui est appris : le scénario en cours continue.
    if (knob.id !== 'pace') clearScenario(true);
    if (knob.effect === 'world') {
      if (knob.id === 'wind' && stormPhase !== 'off') stormPhase = 'off';
      worldChanged(`${knob.label.toLowerCase()} : ${levelLabel.toLowerCase()}`);
    } else if (knob.effect === 'live') {
      sendHyper();
    } else {
      resetLearning();
    }
    refreshKnobs();
    syncSliders();
  }

  function sendHyper() {
    send({ type: 'pace', pace: settings.pace });
    send({
      type: 'hyper',
      es: { popSize: settings.es.popSize, sigma: settings.es.sigma, lr: settings.es.lr, episodesPerEval: settings.es.episodesPerEval },
      rf: { lr: settings.rf.lr, gamma: settings.rf.gamma },
    });
  }

  function refreshKnobs() {
    for (const ui of knobUIs) {
      const idx = ui.knob.levels.findIndex((l) => l.is(settings));
      ui.buttons.forEach((b, i) => {
        b.classList.toggle('active', i === idx);
        b.setAttribute('aria-pressed', String(i === idx));
      });
      ui.output.textContent = idx >= 0 ? ui.knob.levels[idx].label : 'personnalisé';
      ui.output.classList.toggle('cartpole-custom', idx < 0);
      ui.mapping.textContent = `→ ${ui.knob.describe(settings)}`;
      // Le cerveau et l'audace ne concernent que l'évolution.
      const disabled = settings.algo === 'reinforce' && (ui.knob.id === 'brain' || ui.knob.id === 'boldness');
      ui.wrap.classList.toggle('cartpole-disabled', disabled);
      ui.buttons.forEach((b) => (b.disabled = disabled));
    }
  }

  // ---------------------------------------------------------------------------
  // Paramètres experts
  // ---------------------------------------------------------------------------
  const sliderSetters: { id: string; set: (v: number) => void }[] = [];
  function buildSliders() {
    const box = $('sliders');
    for (const def of EXPERT_SLIDERS) {
      if (def.group) {
        const g = document.createElement('div');
        g.className = 'group-title';
        g.textContent = def.group;
        box.appendChild(g);
      }
      const help = def.effect === 'reset' ? def.help : `${def.help} S’applique tout de suite.`;
      const s = createSlider({
        label: def.label,
        help,
        min: def.min,
        max: def.max,
        step: def.step,
        value: def.get(settings),
        format: def.format,
        onInput: (v) => {
          def.set(settings, v);
          clearScenario(true);
          if (def.effect === 'reset') resetLearning();
          else sendHyper();
          refreshKnobs();
        },
      });
      sliderSetters.push({ id: def.id, set: s.set });
      box.appendChild(s.el);
    }
  }
  function syncSliders() {
    for (const s of sliderSetters) s.set(EXPERT_SLIDERS.find((d) => d.id === s.id)!.get(settings));
    $<HTMLInputElement>('continuous').checked = settings.es.continuous;
  }
  $<HTMLInputElement>('continuous').addEventListener('change', (e) => {
    settings.es.continuous = (e.target as HTMLInputElement).checked;
    clearScenario(true);
    resetLearning();
  });

  // ---------------------------------------------------------------------------
  // Scénarios
  // ---------------------------------------------------------------------------
  function clearScenario(clearInfo: boolean) {
    if (!scenarioKey) return;
    scenarioKey = null;
    // L'histoire scriptée de la Tempête s'arrête dès qu'on sort du scénario.
    if (stormPhase === 'calm') stormPhase = 'off';
    root.querySelectorAll('#cartpole-scenarios button').forEach((b) => b.classList.remove('active'));
    if (clearInfo) $('scenario-info').textContent = 'Réglages personnalisés : vous avez modifié le scénario. Choisissez-en un pour repartir d’une histoire.';
  }
  function buildScenarios() {
    const box = $('scenarios');
    for (const [key, sc] of Object.entries(SCENARIOS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = sc.label;
      b.addEventListener('click', () => {
        const fresh = defaultSettings();
        fresh.pace = settings.pace;
        sc.apply(fresh);
        Object.assign(settings.world, fresh.world);
        settings.algo = fresh.algo;
        Object.assign(settings.es, fresh.es);
        Object.assign(settings.rf, fresh.rf);
        scenarioKey = key;
        box.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        const info = $('scenario-info');
        info.replaceChildren();
        const strong = document.createElement('strong');
        strong.textContent = `${sc.label}. `;
        info.append(strong, sc.description);
        refreshKnobs();
        syncSliders();
        resetLearning();
      });
      box.appendChild(b);
    }
  }

  // ---------------------------------------------------------------------------
  // Scène : replay de l'agent, jeu humain, comparaison
  // ---------------------------------------------------------------------------
  const stage = $<HTMLCanvasElement>('stage');
  const net = $<HTMLCanvasElement>('net');
  const chart = $<HTMLCanvasElement>('chart');
  let mode: 'agent' | 'human' = 'agent';
  let replaySpeed = 1;
  let replaySeed = 1;

  // Replay de l'agent
  const replayEnv = new CartPole(settings.world, mulberry32(1));
  let replayCtrl: Controller | null = null;
  let replayPolicy: PolicySpec | null = null;
  let replayLabel = '';
  let replayPauseUntil = 0;
  let replayAcc = 0;
  /** Génération du replay en cours (peut être plus ancienne que la dernière reçue). */
  let replayGen = 0;
  const obsBuf = [0, 0, 0, 0];

  function newReplay() {
    if (!champion) return;
    replaySeed++;
    replayEnv.reset(mulberry32(hashSeed(replaySeed, 31337)));
    replayPolicy = champion;
    replayGen = championGen;
    replayCtrl = makeController(champion, mulberry32(hashSeed(replaySeed, 7)));
    replayLabel =
      championGen === 0
        ? 'Agent débutant (poids au hasard)'
        : settings.algo === 'es'
          ? `Meilleure variante de la génération ${championGen}`
          : `Politique après ${championGen} épisodes`;
    replayAcc = 0;
  }

  function stepReplay(now: number, dt: number) {
    if (!replayCtrl) return;
    if (replayEnv.done) {
      if (now >= replayPauseUntil) newReplay();
      return;
    }
    // Pendant un apprentissage rapide, un long replay devient vite périmé : on passe à une version récente.
    if (training && championGen - replayGen >= 10 && replayEnv.steps >= 250) {
      newReplay();
      return;
    }
    replayAcc += dt * (1 / DT) * replaySpeed;
    while (replayAcc >= 1 && !replayEnv.done) {
      replayAcc -= 1;
      replayEnv.step(replayCtrl.act(observe(replayEnv.state, obsBuf)) * settings.world.forceMag);
    }
    if (replayEnv.done) {
      replayPauseUntil = now + 900;
      replayAcc = 0;
    }
  }

  $('speed').querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
    b.addEventListener('click', () => {
      replaySpeed = Number(b.dataset.speed);
      $('speed').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    }),
  );

  // Jeu humain
  const humanEnv = new CartPole(settings.world, mulberry32(1));
  humanEnv.reset();
  let humanState: 'idle' | 'playing' | 'done' | 'compare' = 'idle';
  let humanSeed = 1;
  let humanBest = 0;
  let humanLast = 0;
  let humanAcc = 0;
  /** true quand la scène doit montrer la partie de l'agent (comparaison en cours ou terminée). */
  let showCompare = false;
  const keys = { left: false, right: false };
  const compareEnv = new CartPole(settings.world, mulberry32(1));
  let compareCtrl: Controller | null = null;
  const btnPlay = $<HTMLButtonElement>('btn-play');
  const btnCompare = $<HTMLButtonElement>('btn-compare');
  const slowmo = $<HTMLInputElement>('slowmo');

  function startHuman() {
    humanSeed = (humanSeed + 1) >>> 0;
    humanEnv.reset(mulberry32(hashSeed(humanSeed, 4242)));
    humanState = 'playing';
    showCompare = false;
    humanAcc = 0;
    btnPlay.textContent = 'Recommencer';
    btnCompare.disabled = true;
    $('h-agent').textContent = '–';
    $('h-status').textContent = 'C’est parti ! Tenez 10 secondes.';
  }

  function endHuman() {
    humanState = 'done';
    humanLast = humanEnv.steps;
    humanBest = Math.max(humanBest, humanLast);
    $('h-time').textContent = fmtSec(humanLast);
    $('h-best').textContent = fmtSec(humanBest);
    btnCompare.disabled = !champion;
    const why = !humanEnv.failed
      ? 'Bravo, vous avez tenu les 10 secondes !'
      : Math.abs(humanEnv.state[0]) > 2.4
        ? 'Le chariot est sorti de la piste.'
        : 'Le bâton est tombé.';
    $('h-status').textContent = `${why} Vous avez tenu ${fmtSec(humanLast)}. Cliquez sur « Comparer avec l’agent » pour le voir jouer exactement le même départ, avec les mêmes rafales.`;
  }

  function startCompare() {
    if (!champion) return;
    compareEnv.reset(mulberry32(hashSeed(humanSeed, 4242)));
    compareCtrl = makeController(champion, mulberry32(hashSeed(humanSeed, 5)));
    humanState = 'compare';
    showCompare = true;
    humanAcc = 0;
    btnCompare.disabled = true;
    $('h-status').textContent = 'L’agent joue le même départ…';
  }

  function endCompare() {
    humanState = 'done';
    btnCompare.disabled = false;
    const a = compareEnv.steps;
    $('h-agent').textContent = fmtSec(a);
    const untrained = generation === 0 ? ' (il n’a encore rien appris : entraînez-le dans « Regarder l’agent »)' : '';
    const verdict = a > humanLast ? 'L’agent fait mieux que vous' : a < humanLast ? 'Vous battez l’agent' : 'Égalité';
    $('h-status').textContent = `${verdict}${untrained} : vous ${fmtSec(humanLast)}, l’agent ${fmtSec(a)} sur le même départ.`;
  }

  function stepHuman(dt: number) {
    const rate = (1 / DT) * (slowmo.checked ? 0.5 : 1);
    if (humanState === 'playing') {
      humanAcc += dt * rate;
      while (humanAcc >= 1 && !humanEnv.done) {
        humanAcc -= 1;
        const f = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        humanEnv.step(f * settings.world.forceMag);
      }
      $('h-time').textContent = fmtSec(humanEnv.steps);
      if (humanEnv.done) endHuman();
    } else if (humanState === 'compare' && compareCtrl) {
      humanAcc += dt * rate;
      while (humanAcc >= 1 && !compareEnv.done) {
        humanAcc -= 1;
        compareEnv.step(compareCtrl.act(observe(compareEnv.state, obsBuf)) * settings.world.forceMag);
      }
      if (compareEnv.done) endCompare();
    }
  }

  btnPlay.addEventListener('click', () => startHuman());
  btnCompare.addEventListener('click', () => startCompare());

  const press = (side: 'left' | 'right', on: boolean) => {
    keys[side] = on;
    $(`pad-${side}`).classList.toggle('cartpole-pressed', on);
    if (on && (humanState === 'idle' || humanState === 'done')) startHuman();
  };
  for (const side of ['left', 'right'] as const) {
    const pad = $(`pad-${side}`);
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pad.setPointerCapture?.(e.pointerId);
      press(side, true);
    });
    const up = () => press(side, false);
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    pad.addEventListener('lostpointercapture', up);
    pad.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  const isTyping = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  };
  const onKey = (e: KeyboardEvent) => {
    if (mode !== 'human' || isTyping(e.target)) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const down = e.type === 'keydown';
    if (down && e.repeat) return;
    press(e.key === 'ArrowLeft' ? 'left' : 'right', down);
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  const onBlur = () => {
    keys.left = keys.right = false;
  };
  window.addEventListener('blur', onBlur);
  disposers.push(() => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    window.removeEventListener('blur', onBlur);
  });

  // Choix du mode
  root.querySelectorAll<HTMLButtonElement>('.cartpole-mode button').forEach((b) =>
    b.addEventListener('click', () => {
      mode = b.dataset.mode as 'agent' | 'human';
      root.querySelectorAll<HTMLButtonElement>('.cartpole-mode button').forEach((x) => {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      $('agent-controls').hidden = mode !== 'agent';
      $('human-controls').hidden = mode !== 'human';
      $('speed-wrap').style.visibility = mode === 'agent' ? 'visible' : 'hidden';
      if (mode === 'human') {
        if (humanState === 'compare' || humanState === 'playing') humanState = 'idle';
        showCompare = false;
        if (humanState === 'idle') {
          humanEnv.reset(mulberry32(hashSeed(humanSeed, 4242)));
          $('h-status').textContent = 'Appuyez sur ← ou → (ou sur « Commencer ») pour lancer la partie.';
        }
      }
      keys.left = keys.right = false;
    }),
  );

  // ---------------------------------------------------------------------------
  // Graphique
  // ---------------------------------------------------------------------------
  function renderChart() {
    const es = settings.algo === 'es';
    const values = es ? esMean : rfSteps;
    const colors = { raw: theme.chartRaw, avg: theme.chartAvg, axis: theme.border, text: theme.muted };
    const extra: { values: number[]; color: string; dashed?: boolean }[] = [];
    if (values.length > 0) {
      if (es) {
        const c = parseColor(theme.series[1]);
        extra.push({ values: esBest, color: `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.55)`, dashed: true });
      }
      extra.push({ values: [MAX_STEPS], color: 'rgba(0, 0, 0, 0)' }); // fixe l'échelle à 0–500
    }
    drawChart(chart, values, colors, {
      window: es ? 5 : 20,
      xLabel: es ? 'génération' : 'épisode',
      emptyText: 'Cliquez sur « Apprendre » pour voir la courbe',
      extra,
    });
    // Traits verticaux : changements du monde (même géométrie que drawChart).
    if (values.length > 1 && markers.length) {
      const ctx = chart.getContext('2d')!;
      const w = chart.clientWidth;
      const h = chart.clientHeight;
      const pad = { l: 44, r: 10, t: 10, b: 24 };
      const n = values.length;
      const pw = w - pad.l - pad.r;
      ctx.save();
      ctx.strokeStyle = theme.trap;
      ctx.fillStyle = theme.trap;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      markers.forEach((m, k) => {
        const x = pad.l + (Math.min(m.i - 0.5, n - 1) / (n - 1)) * pw;
        ctx.beginPath();
        ctx.moveTo(x, pad.t);
        ctx.lineTo(x, h - pad.b);
        ctx.stroke();
        const right = x < w - 120;
        const tw = ctx.measureText(m.label).width;
        const tx = right ? x + 4 : x - 4 - tw;
        const ty = pad.t + 14 + (k % 3) * 16;
        ctx.fillStyle = theme.panel;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(tx - 3, ty - 1, tw + 6, 15);
        ctx.globalAlpha = 1;
        ctx.fillStyle = theme.trap;
        ctx.textAlign = 'left';
        ctx.fillText(m.label, tx, ty + 1);
      });
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------------
  // Boucle d'animation
  // ---------------------------------------------------------------------------
  let last = performance.now();
  const stopLoop = rafLoop((now) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (mode === 'agent') stepReplay(now, dt);
    else stepHuman(dt);

    const windMax = Math.max(1e-9, settings.world.windForce);
    if (mode === 'agent') {
      const env = replayEnv;
      drawStage(stage, {
        state: env.state,
        halfLength: settings.world.halfLength,
        force: env.lastForce / settings.world.forceMag,
        wind: env.wind / windMax,
        failed: env.failed,
        caption: `${fmtSec(env.steps)} · ${env.steps} pas`,
        badge: replayLabel,
        overlay: env.done ? (env.failed ? `Tombé après ${fmtSec(env.steps)}` : '10 s : réussi !') : undefined,
      }, theme);
      $('replay-info').textContent = replayLabel
        ? `Rejoué : ${replayLabel.charAt(0).toLowerCase()}${replayLabel.slice(1)}${championGen !== replayGen ? ' (une version plus récente sera rejouée ensuite)' : ''}.`
        : '';
      if (replayPolicy) drawNetwork(net, replayPolicy, observe(env.state, obsBuf), theme);
    } else {
      const agentShown = showCompare && humanState !== 'idle' && humanState !== 'playing';
      const env = agentShown ? compareEnv : humanEnv;
      const who = agentShown ? 'Agent' : 'Vous';
      const overlay =
        humanState === 'idle'
          ? 'Appuyez sur ← ou → pour commencer'
          : humanState === 'done'
            ? `${who} : ${fmtSec(env.steps)}${env.failed ? '' : ', réussi !'}`
            : undefined;
      drawStage(stage, {
        state: env.state,
        halfLength: settings.world.halfLength,
        force: env.lastForce / settings.world.forceMag,
        wind: env.wind / windMax,
        failed: env.failed,
        caption: `${who} · ${fmtSec(env.steps)}`,
        badge: slowmo.checked ? 'ralenti ×0,5' : undefined,
        overlay,
      }, theme);
      $('replay-info').textContent =
        agentShown ? 'L’agent joue votre départ (mêmes rafales).' : 'Réseau ci-dessous : ce que l’agent ferait à votre place, en ce moment.';
      if (champion) drawNetwork(net, champion, observe(env.state, obsBuf), theme);
    }
    if (chartDirty) {
      renderChart();
      chartDirty = false;
    }
  });
  disposers.push(stopLoop);
  disposers.push(onResize(root, () => (chartDirty = true)));

  // ---------------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------------
  buildScenarios();
  buildKnobs($('world-knobs'), WORLD_KNOBS);
  buildKnobs($('agent-knobs'), AGENT_KNOBS);
  buildSliders();
  refreshKnobs();
  syncSliders();
  resetLearning();

  return () => {
    training = false;
    disposers.forEach((d) => d());
  };
}
