import './style.css';
import { Trainer, greedyRollout } from './agent';
import { MountainCar } from './env';
import {
  EXPERT_SLIDERS,
  SCENARIOS,
  SPEEDS,
  STEPS_PER_FRAME,
  Settings,
  Speed,
  TRAITS,
  defaultSettings,
  describeEngine,
  detectLevel,
  formatNumber as fr,
} from './config';
import { Colors, PhaseImage, PhaseMode, drawPhase, drawScene, phaseLayout, pxToPhase, readColors, renderPhaseImage } from './draw';
import { TEMPLATE } from './template';
import { TurboReply, TurboRequest, runTurboBatch } from './worker';
import { drawChart } from '../../shared/chart';
import { mulberry32 } from '../../shared/rng';
import { onResize, onThemeChange, prepareCanvas, rafLoop } from '../../shared/ui';

const SPEED_HELP: Record<Speed, string> = {
  slow: 'Un pas par image : suivez chaque décision de la voiture.',
  normal: 'Cinq pas par image : un premier épisode dure quelques secondes.',
  fast: 'Quarante pas par image : les épisodes s’enchaînent.',
  turbo: 'Des dizaines d’épisodes par seconde, calculés en arrière-plan (Web Worker). La vallée rejoue le dernier épisode terminé.',
};

const ALGO_HELP = {
  sarsa: 'Sarsa(λ) apprend la valeur de ce qu’il fait vraiment, actions au hasard comprises.',
  qlearning:
    'Q(λ) de Watkins apprend la valeur de la meilleure action ; ses traces sont effacées après chaque action au hasard. Avec ε = 0, les deux algorithmes se comportent exactement pareil.',
};

/** Épisodes par lot turbo (un lot au plus par image) : quelques centaines d’épisodes par seconde. */
const TURBO_EPISODES_PER_BATCH = 5;

interface Playback {
  /** x, v alternés */
  traj: ArrayLike<number>;
  actions: number[] | null;
  idx: number;
  kind: 'test' | 'replay';
  goal: boolean;
  steps: number;
}

export function mount(root: HTMLElement): () => void {
  root.innerHTML = TEMPLATE;
  const disposers: Array<() => void> = [];
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector(`#mountaincar-${id}`) as T;

  // ---------- État ----------
  const settings: Settings = defaultSettings();
  let seedCounter = 1;
  let trainer = new Trainer(settings.agent, settings.physics, mulberry32(seedCounter));
  const masterRng = mulberry32(12345);
  let running = false;
  let speed: Speed = 'normal';
  let phaseMode: PhaseMode = 'value';
  let playback: Playback | null = null;
  let lastAction = -1;
  let message = '';
  let chartDirty = true;
  let phaseDirty = true;
  let lastPhaseRender = 0;
  let lastChartRender = 0;
  let phaseImage: PhaseImage | null = null;

  // Turbo (Web Worker)
  let worker: Worker | null = null;
  let workerFailed = false;
  let gen = 0;
  let inFlight = false;
  /** Dernier épisode reçu du worker, rejoué quand la rediffusion en cours se termine. */
  let latestReplay: Playback | null = null;

  const scene = $<HTMLCanvasElement>('scene');
  const phase = $<HTMLCanvasElement>('phase');
  const chart = $<HTMLCanvasElement>('chart');
  const btnRun = $<HTMLButtonElement>('run');
  const statusEl = $('status');

  let colors: Colors = readColors();
  disposers.push(
    onThemeChange(() => {
      colors = readColors();
      phaseDirty = chartDirty = true;
    }),
  );
  disposers.push(onResize(chart, () => (chartDirty = true)));

  // ---------- Curseurs (ids préfixés) ----------
  interface SliderHandle {
    input: HTMLInputElement;
    output: HTMLOutputElement;
    format: (v: number) => string;
  }
  function makeSlider(
    container: HTMLElement,
    id: string,
    o: { label: string; help: string; min: number; max: number; step: number; format: (v: number) => string; onInput: (v: number) => void },
  ): SliderHandle {
    const inputId = `mountaincar-sl-${id}`;
    const wrap = document.createElement('div');
    wrap.className = 'slider';
    wrap.innerHTML = `
      <div class="slider-head"><label for="${inputId}"></label><output for="${inputId}"></output></div>
      <input type="range" id="${inputId}" min="${o.min}" max="${o.max}" step="${o.step}" aria-describedby="${inputId}-help" />
      <p class="help" id="${inputId}-help"></p>`;
    wrap.querySelector('label')!.textContent = o.label;
    wrap.querySelector('.help')!.textContent = o.help;
    const input = wrap.querySelector('input')!;
    const output = wrap.querySelector('output')!;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      output.textContent = o.format(v);
      o.onInput(v);
    });
    container.appendChild(wrap);
    return { input, output, format: o.format };
  }
  const setSlider = (s: SliderHandle, v: number) => {
    s.input.value = String(v);
    s.output.textContent = s.format(Number(s.input.value));
  };

  // ---------- Le monde ----------
  const world = $('world');
  const forceSlider = makeSlider(world, 'force', {
    label: 'Moteur plus puissant',
    help: 'Multiplie la poussée du moteur. Au-delà de ×2,5 (à gravité normale), plus besoin d’élan : la spirale disparaît de la carte des phases.',
    min: 0.5, max: 4, step: 0.25,
    format: (v) => `×${fr(v, 2)}`,
    onInput: (v) => {
      settings.physics.force = v;
      afterChange();
    },
  });
  const gravitySlider = makeSlider(world, 'gravity', {
    label: 'Gravité',
    help: 'Plus faible : la pente retient moins la voiture, moins d’allers-retours. Plus forte : il faut davantage d’élan.',
    min: 0.4, max: 1.6, step: 0.1,
    format: (v) => `×${fr(v, 1)}`,
    onInput: (v) => {
      settings.physics.gravity = v;
      afterChange();
    },
  });

  // ---------- Traits ----------
  const traitUIs = new Map<string, { buttons: HTMLButtonElement[]; output: HTMLOutputElement; mapping: HTMLElement }>();
  {
    const box = $('traits');
    for (const trait of TRAITS) {
      const id = `mountaincar-trait-${trait.id}`;
      const wrap = document.createElement('div');
      wrap.className = 'mountaincar-trait';
      wrap.innerHTML = `
        <div class="slider-head"><span class="mountaincar-trait-name" id="${id}-label"></span><output id="${id}-out"></output></div>
        <div class="segmented mountaincar-seg mountaincar-trait-seg" role="group" aria-labelledby="${id}-label"></div>
        <p class="help"></p>
        <p class="mountaincar-mapping" id="${id}-map"></p>`;
      wrap.querySelector('.mountaincar-trait-name')!.textContent = trait.label;
      wrap.querySelector('.help')!.textContent = trait.help;
      const seg = wrap.querySelector('.segmented')!;
      const buttons = trait.levels.map((lvl, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = lvl.label;
        b.addEventListener('click', () => {
          const oldQ = settings.agent.qInit;
          trait.levels[i].apply(settings);
          clearScenario();
          if (settings.agent.qInit !== oldQ) {
            resetLearning();
            message = 'Nouvelle estimation de départ Q₀ : l’apprentissage recommence de zéro.';
          }
          afterChange();
        });
        seg.appendChild(b);
        return b;
      });
      traitUIs.set(trait.id, { buttons, output: wrap.querySelector('output')!, mapping: wrap.querySelector('.mountaincar-mapping')! });
      box.appendChild(wrap);
    }
  }

  // ---------- Experts ----------
  const expertHandles = new Map<string, SliderHandle>();
  {
    const box = $('sliders');
    for (const def of EXPERT_SLIDERS) {
      if (def.group) {
        const g = document.createElement('div');
        g.className = 'group-title';
        g.textContent = def.group;
        box.appendChild(g);
      }
      expertHandles.set(
        def.id,
        makeSlider(box, def.id, {
          label: def.label,
          help: def.help,
          min: def.min,
          max: def.max,
          step: def.step,
          format: def.format ?? ((v) => fr(v, 2)),
          onInput: (v) => {
            def.set(settings, v);
            clearScenario();
            if (def.needsReset) {
              resetLearning();
              message = 'Réglage structurel modifié : l’apprentissage recommence de zéro.';
            }
            afterChange();
          },
        }),
      );
    }
  }
  root.querySelectorAll<HTMLInputElement>('input[name="mountaincar-algo"]').forEach((r) =>
    r.addEventListener('change', () => {
      if (r.checked) settings.agent.algorithm = r.value as Settings['agent']['algorithm'];
      afterChange();
    }),
  );

  function syncControls() {
    setSlider(forceSlider, settings.physics.force);
    setSlider(gravitySlider, settings.physics.gravity);
    for (const def of EXPERT_SLIDERS) setSlider(expertHandles.get(def.id)!, def.get(settings));
    root.querySelectorAll<HTMLInputElement>('input[name="mountaincar-algo"]').forEach((r) => (r.checked = r.value === settings.agent.algorithm));
    $('algo-help').textContent = ALGO_HELP[settings.agent.algorithm];
    $('engine-info').textContent = `→ ${describeEngine(settings.physics)}`;
    for (const trait of TRAITS) {
      const ui = traitUIs.get(trait.id)!;
      const lvl = detectLevel(trait, settings);
      ui.output.textContent = lvl >= 0 ? trait.levels[lvl].label : 'personnalisé';
      ui.output.classList.toggle('mountaincar-custom', lvl < 0);
      ui.buttons.forEach((b, i) => {
        b.classList.toggle('active', i === lvl);
        b.setAttribute('aria-pressed', String(i === lvl));
      });
      ui.mapping.textContent = `→ ${trait.describe(settings)}${lvl < 0 ? ' (réglé dans les paramètres experts)' : ''}`;
    }
  }

  function afterChange() {
    syncControls();
    phaseDirty = true;
    updateStatus();
  }

  // ---------- Vitesse ----------
  const speedBox = $('speed');
  const speedButtons = SPEEDS.map((sp) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = sp.label;
    b.addEventListener('click', () => setSpeed(sp.id));
    speedBox.appendChild(b);
    return b;
  });
  function setSpeed(sp: Speed) {
    const wasTurbo = speed === 'turbo';
    speed = sp;
    speedButtons.forEach((b, i) => {
      b.classList.toggle('active', SPEEDS[i].id === sp);
      b.setAttribute('aria-pressed', String(SPEEDS[i].id === sp));
    });
    $('speed-help').textContent = SPEED_HELP[sp];
    if (wasTurbo && sp !== 'turbo') {
      if (playback?.kind === 'replay') playback = null;
      latestReplay = null;
      trainer.restartEpisode();
    }
    if (sp === 'turbo') trainer.restartEpisode();
    updateStatus();
  }

  // ---------- Carte des phases ----------
  const modeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('#mountaincar-phase-mode button'));
  modeButtons.forEach((b) =>
    b.addEventListener('click', () => {
      phaseMode = b.dataset.mode as PhaseMode;
      modeButtons.forEach((x) => {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      phaseDirty = true;
      updateLegend();
    }),
  );
  phase.addEventListener('click', (e) => {
    const rect = phase.getBoundingClientRect();
    const s = pxToPhase(phaseLayout(rect.width, rect.height), e.clientX - rect.left, e.clientY - rect.top);
    if (!s) return;
    startTest(s.x, s.v);
  });

  function updateLegend() {
    const L = $('legend');
    const t = colors.theme;
    if (phaseMode === 'value') {
      const lo = phaseImage ? fr(phaseImage.minCost, 0) : '0';
      const hi = phaseImage ? fr(phaseImage.maxCost, 0) : '–';
      L.innerHTML = `<span class="mountaincar-grad" style="background: linear-gradient(90deg, rgb(${t.good}), ${t.cell}, rgb(${t.bad}))"></span>
        <span>Coût restant estimé (−max Q) : vert = drapeau proche ou zone encore inconnue (${lo}), rouge = encore loin (${hi}).</span>`;
    } else {
      L.innerHTML = `<span class="mountaincar-key"><i style="background:${colors.left}"></i>gauche</span>
        <span class="mountaincar-key"><i style="background:${t.muted}"></i>rien</span>
        <span class="mountaincar-key"><i style="background:${colors.right}"></i>droite</span>
        <span class="mountaincar-key"><i style="background:${t.cell}"></i>indécis (jamais visité)</span>`;
    }
  }

  // ---------- Scénarios ----------
  const scenarioBox = $('scenarios');
  for (const sc of SCENARIOS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = sc.label;
    b.dataset.scenario = sc.id;
    b.addEventListener('click', () => {
      const fresh = defaultSettings();
      sc.apply(fresh);
      Object.assign(settings.agent, fresh.agent);
      Object.assign(settings.physics, fresh.physics);
      scenarioBox.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      const info = $('scenario-info');
      info.replaceChildren();
      const strong = document.createElement('strong');
      strong.textContent = `${sc.label}. `;
      info.append(strong, sc.description);
      resetLearning();
      message = `Scénario « ${sc.label} » chargé. Cliquez sur « Démarrer ».`;
      afterChange();
    });
    scenarioBox.appendChild(b);
  }
  function clearScenario() {
    scenarioBox.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
  }

  // ---------- Contrôles ----------
  function setRunning(on: boolean) {
    running = on;
    if (on && (playback?.kind === 'test' || speed !== 'turbo')) playback = null;
    btnRun.textContent = running ? 'Pause' : trainer.episode > 0 || trainer.stepInEpisode > 0 ? 'Reprendre' : 'Démarrer';
    if (on) message = '';
    updateStatus();
  }
  btnRun.addEventListener('click', () => setRunning(!running));
  $('step').addEventListener('click', () => {
    setRunning(false);
    if (playback) {
      playback = null;
      trainer.restartEpisode();
    }
    learnStep();
    updateStats();
  });
  $('test').addEventListener('click', () => startTest(-0.5, 0));
  $('reset').addEventListener('click', () => {
    resetLearning();
    message = '';
    updateStatus();
  });

  function resetLearning() {
    gen++;
    inFlight = false;
    latestReplay = null;
    seedCounter++;
    trainer = new Trainer(settings.agent, settings.physics, mulberry32(seedCounter));
    playback = null;
    lastAction = -1;
    setRunning(false);
    chartDirty = phaseDirty = true;
    updateStats();
  }

  function startTest(x: number, v: number) {
    setRunning(false);
    const r = greedyRollout(trainer.agent, settings.physics, x, v);
    playback = { traj: r.traj, actions: r.actions, idx: 0, kind: 'test', goal: r.goal, steps: r.steps };
    trainer.restartEpisode();
    message = `Test depuis x = ${fr(x)}, v = ${fr(v, 3)} : la stratégie actuelle est rejouée, sans hasard ni apprentissage…`;
    updateStatus();
  }

  function learnStep() {
    const info = trainer.step();
    lastAction = info.action;
    if (info.episodeEnded) chartDirty = true;
    phaseDirty = true;
  }

  // ---------- Turbo ----------
  function getWorker(): Worker | null {
    if (worker || workerFailed) return worker;
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<TurboReply>) => onTurboReply(e.data);
      worker.onerror = (e) => {
        e.preventDefault();
        workerFailed = true;
        worker?.terminate();
        worker = null;
        inFlight = false;
      };
    } catch {
      workerFailed = true;
      worker = null;
    }
    return worker;
  }

  function turboRequest(budgetMs: number): TurboRequest {
    return {
      gen,
      cfg: { ...settings.agent },
      physics: { ...settings.physics },
      weights: trainer.agent.w.slice(),
      seed: Math.floor(masterRng() * 4294967296),
      maxEpisodes: TURBO_EPISODES_PER_BATCH,
      budgetMs,
    };
  }

  function onTurboReply(r: TurboReply) {
    if (r.gen !== gen) return;
    inFlight = false;
    trainer.agent.setWeights(r.weights);
    trainer.restartEpisode();
    for (const res of r.results) trainer.history.push(res);
    trainer.episode += r.results.length;
    if (r.traj.length > 2) {
      const last = r.results[r.results.length - 1];
      latestReplay = { traj: r.traj, actions: null, idx: 0, kind: 'replay', goal: last?.goal ?? false, steps: last?.steps ?? 0 };
      if (!playback) {
        playback = latestReplay;
        latestReplay = null;
      }
    }
    chartDirty = phaseDirty = true;
    updateStats();
  }

  function turboTick() {
    if (inFlight) return;
    const w = getWorker();
    if (w) {
      inFlight = true;
      const req = turboRequest(120);
      w.postMessage(req, [req.weights.buffer]);
    } else {
      // Repli sans worker : petits lots dans le fil principal.
      onTurboReply(runTurboBatch(turboRequest(12)));
    }
  }

  // ---------- Statut et statistiques ----------
  function recentSteps(n = 20): number[] {
    return trainer.history.slice(-n).map((r) => r.steps);
  }
  function updateStats() {
    $('st-episode').textContent = String(trainer.episode);
    $('st-step').textContent = String(playback ? Math.min(playback.idx, playback.steps) : trainer.stepInEpisode);
    const rec = recentSteps();
    $('st-avg').textContent = rec.length ? (rec.reduce((a, b) => a + b, 0) / rec.length).toFixed(0) : '–';
    const last = trainer.history[trainer.history.length - 1];
    $('st-ret').textContent = last ? fr(last.ret, 0) : '–';
  }

  function updateStatus() {
    let msg = message;
    if (!msg) {
      const rec = trainer.history.slice(-10);
      const timeouts = rec.filter((r) => !r.goal).length;
      if (running) {
        msg = speed === 'turbo' ? 'Turbo : l’agent enchaîne les épisodes en arrière-plan…' : 'L’agent apprend…';
        if (trainer.episode >= 10 && settings.physics.shaping === 'speed' && timeouts >= 8 && rec[rec.length - 1].ret > 0)
          msg = 'Score perçu positif, mais la voiture n’arrive plus : elle se balance pour encaisser le bonus de vitesse.';
        else if (trainer.episode >= 20 && timeouts >= 10)
          msg = 'Aucune arrivée depuis 10 épisodes : l’agent ne trouve pas le drapeau. Regardez sa curiosité.';
      } else if (trainer.episode === 0 && trainer.stepInEpisode === 0)
        msg = 'Prêt. Cliquez sur « Démarrer » : au début, la voiture tâtonne longtemps, la récompense ne lui dit rien avant le drapeau.';
      else msg = 'En pause.';
    }
    statusEl.textContent = msg;
  }

  // ---------- Boucle d’animation ----------
  const display = new MountainCar(settings.physics);
  function frame(now: number) {
    // 1) Faire avancer la simulation
    if (playback) {
      const perFrame = playback.kind === 'replay' ? 10 : speed === 'turbo' ? 10 : STEPS_PER_FRAME[speed === 'slow' ? 'slow' : 'normal'];
      const total = playback.traj.length / 2 - 1;
      if (playback.idx < total) {
        playback.idx = Math.min(total, playback.idx + perFrame);
        if (playback.kind === 'test' && playback.idx >= total) {
          message = playback.goal
            ? `Test : drapeau atteint en ${playback.steps} pas, sans aucune action au hasard.`
            : `Test : pas d’arrivée en ${playback.steps} pas. La stratégie n’est pas encore au point depuis cet état.`;
          updateStatus();
        }
        updateStats();
      } else if (playback.kind === 'replay' && latestReplay) {
        playback = latestReplay;
        latestReplay = null;
      }
    }
    if (running) {
      if (speed === 'turbo') turboTick();
      else {
        const n = STEPS_PER_FRAME[speed];
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          learnStep();
          if (performance.now() - t0 > 12) break;
        }
        updateStats();
        if (chartDirty) updateStatus();
      }
    }

    // 2) Dessiner la vallée
    let x: number, v: number, action: number, traj: ArrayLike<number>, upto: number;
    if (playback) {
      traj = playback.traj;
      upto = playback.idx;
      x = traj[2 * upto];
      v = traj[2 * upto + 1];
      action = playback.actions ? (playback.actions[upto] ?? -1) : -1;
    } else {
      traj = trainer.traj;
      upto = traj.length / 2 - 1;
      x = upto >= 0 ? traj[2 * upto] : display.x;
      v = upto >= 0 ? traj[2 * upto + 1] : 0;
      action = upto > 0 ? lastAction : -1;
    }
    const trail: number[] = [];
    for (let i = Math.max(0, upto - 40); i < upto; i++) trail.push(traj[2 * i]);
    const reached = x >= 0.5;
    {
      const { ctx, w, h } = prepareCanvas(scene);
      drawScene(ctx, w, h, { x, v, action, trail, testing: playback?.kind === 'test', reached }, colors);
    }

    // 3) Carte des phases (image recalculée au plus ~7 fois par seconde)
    if (phaseDirty && now - lastPhaseRender > 140) {
      phaseImage = renderPhaseImage(trainer.agent, phaseMode, colors, phaseImage ?? undefined);
      lastPhaseRender = now;
      phaseDirty = false;
      updateLegend();
    }
    {
      const { ctx, w, h } = prepareCanvas(phase);
      const shown = playback ? Array.prototype.slice.call(traj, 0, 2 * upto + 2) : traj;
      drawPhase(ctx, w, h, phaseImage, shown, colors, playback?.kind === 'test');
    }

    // 4) Courbe
    if (chartDirty && now - lastChartRender > (speed === 'turbo' ? 250 : 100)) {
      const t = colors.theme;
      drawChart(
        chart,
        trainer.history.map((r) => r.steps),
        { raw: t.chartRaw, avg: t.chartAvg, axis: t.border, text: t.muted },
        { window: 20, xLabel: 'épisode', emptyText: 'La courbe apparaît à la fin du premier épisode' },
      );
      chartDirty = false;
      lastChartRender = now;
    }
  }

  // ---------- Démarrage ----------
  setSpeed('normal');
  syncControls();
  updateLegend();
  updateStats();
  updateStatus();
  disposers.push(rafLoop(frame));

  return () => {
    for (const d of disposers) d();
    gen++;
    worker?.terminate();
    worker = null;
    running = false;
  };
}
