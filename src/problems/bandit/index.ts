import './style.css';
import {
  BanditEnv,
  DEFAULT_PARAMS,
  Race,
  STRATEGIES,
  ScenarioKind,
  StrategyId,
  AgentParams,
  averageWins,
  betaMoments,
  deriveSeed,
  makeEnvSpec,
  referenceWins,
  scenarioProbs,
} from './bandit';
import { SCENARIOS, SPEEDS, STRATEGY_HELP, curiosityToParams, curiosityWord, fr, pct } from './config';
import { drawBeta, drawChangeMarker, BetaCurve } from './draw';
import { TEMPLATE } from './template';
import { drawChart } from '../../shared/chart';
import { createSlider, onResize, onThemeChange, rafLoop, readTheme } from '../../shared/ui';
import { mulberry32 } from '../../shared/rng';

type Mode = 'race' | 'human';
type Metric = 'regret' | 'best';

const STRAT_IDS: StrategyId[] = STRATEGIES.map((s) => s.id);
const HUMAN_SIM_RUNS = 300;

interface HumanGame {
  counts: number[];
  wins: number[];
  t: number;
  total: number;
  lastArm: number;
  lastReward: number;
  rng: () => number;
  done: boolean;
}

export function mount(root: HTMLElement): () => void {
  root.innerHTML = TEMPLATE;
  const disposers: Array<() => void> = [];
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector(`#${id}`) as T;

  // ---------- État ----------
  const params: AgentParams = { ...DEFAULT_PARAMS };
  let scenario: ScenarioKind = 'easy';
  let k = SCENARIOS.easy.k;
  let horizon = SCENARIOS.easy.plays;
  let budget = 30;
  let change = false;
  let machineSeed = 20240607;
  let luck = 1;
  let curiosity = 5;
  let speedLevel = 6;
  let mode: Mode = 'race';
  let metric: Metric = 'regret';
  let view = 3; // Thompson par défaut : ses courbes de croyance sont le plus parlant
  let reveal = false;
  let running = false;
  const hidden = new Set<number>();

  let probs: number[] = [];
  let raceEnv!: BanditEnv;
  let humanEnv!: BanditEnv;
  let race!: Race;
  let human!: HumanGame;
  let humanGames = 0;

  let colors = readTheme();
  let dirty = true;
  let chartDirty = true;
  let flashUntil = 0;
  let flashArm = -1;
  let flashWin = false;
  let accum = 0;
  let lastNow = 0;

  // ---------- Éléments ----------
  const machinesEl = $('bandit-machines');
  const btnRun = $<HTMLButtonElement>('bandit-run');
  const chartCanvas = $<HTMLCanvasElement>('bandit-chart');
  const betaCanvas = $<HTMLCanvasElement>('bandit-beta');
  const statusEl = $('bandit-status');
  const resultsEl = $('bandit-results');
  const revealBox = $<HTMLInputElement>('bandit-reveal');
  const changeBox = $<HTMLInputElement>('bandit-change');
  const shortBox = $<HTMLInputElement>('bandit-short');
  const legendEl = $('bandit-legend');
  const viewEl = $('bandit-view');

  // ---------- Construction du monde ----------
  function buildEnvs() {
    raceEnv = new BanditEnv(makeEnvSpec(probs, change, horizon));
    humanEnv = new BanditEnv(makeEnvSpec(probs, change, budget));
  }
  function newRace() {
    race = new Race(raceEnv, STRAT_IDS, params, deriveSeed(machineSeed, luck++, 3));
    accum = 0;
    chartDirty = dirty = true;
  }
  function newHuman() {
    human = {
      counts: new Array(k).fill(0),
      wins: new Array(k).fill(0),
      t: 0,
      total: 0,
      lastArm: -1,
      lastReward: 0,
      rng: mulberry32(deriveSeed(machineSeed, 99, ++humanGames)),
      done: false,
    };
    resultsEl.hidden = true;
    resultsEl.replaceChildren();
    if (mode === 'human') setReveal(false);
    dirty = true;
  }
  function newMachines(seed = machineSeed) {
    machineSeed = seed;
    probs = scenarioProbs(scenario, k, machineSeed);
    buildEnvs();
    buildMachines();
    setRunning(false);
    newRace();
    newHuman();
    updateAll();
  }

  // ---------- Machines (DOM) ----------
  interface MachineView {
    el: HTMLButtonElement;
    est: HTMLElement;
    window: HTMLElement;
    plays: HTMLElement;
    ci: HTMLElement;
    ucb: HTMLElement;
    mark: HTMLElement;
    truthMark: HTMLElement;
    truth: HTMLElement;
    tag: HTMLElement;
  }
  let machines: MachineView[] = [];

  function armColor(i: number) {
    return `var(--series-${(i % 6) + 1})`;
  }

  function buildMachines() {
    machinesEl.replaceChildren();
    machines = [];
    for (let i = 0; i < k; i++) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'bandit-machine';
      if (i >= 6) el.classList.add('bandit-alt');
      el.dataset.arm = String(i);
      el.style.setProperty('--bandit-arm', armColor(i));
      el.innerHTML = `
        <span class="bandit-m-head"><span class="bandit-m-name">M${i + 1}</span><span class="bandit-m-tag"></span></span>
        <span class="bandit-m-window"><span class="bandit-m-est"></span></span>
        <span class="bandit-m-bar" aria-hidden="true"><span class="bandit-m-ci"></span><span class="bandit-m-ucb"></span><span class="bandit-m-mark"></span><span class="bandit-m-truthmark"></span></span>
        <span class="bandit-m-plays"></span>
        <span class="bandit-m-truth"></span>
        <span class="bandit-m-lever" aria-hidden="true"></span>`;
      const q = (c: string) => el.querySelector(`.${c}`) as HTMLElement;
      machines.push({
        el,
        est: q('bandit-m-est'),
        window: q('bandit-m-window'),
        plays: q('bandit-m-plays'),
        ci: q('bandit-m-ci'),
        ucb: q('bandit-m-ucb'),
        mark: q('bandit-m-mark'),
        truthMark: q('bandit-m-truthmark'),
        truth: q('bandit-m-truth'),
        tag: q('bandit-m-tag'),
      });
      machinesEl.append(el);
    }
  }

  machinesEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.bandit-machine');
    if (!btn || mode !== 'human') return;
    humanPlay(Number(btn.dataset.arm));
  });

  /** Informations à afficher pour la machine i, selon le mode et la stratégie regardée. */
  function machineInfo(i: number) {
    if (mode === 'human') {
      const n = human.counts[i];
      const w = human.wins[i];
      const { mean, sd } = betaMoments(1 + w, 1 + n - w);
      return { n, w, est: n ? w / n : null, mean, sd, ucbTop: null as number | null };
    }
    const a = race.agents[view];
    const n = a.counts[i];
    const isT = a.strategy === 'thompson';
    const [pa, pb] = isT ? a.posterior(i) : a.posterior(i, 1, 1);
    const { mean, sd } = betaMoments(pa, pb);
    let ucbTop: number | null = null;
    if (a.strategy === 'ucb') {
      const s = a.ucb(i);
      ucbTop = Number.isFinite(s) ? Math.min(1, s) : 1;
    }
    return { n, w: a.wins[i], est: n || isT ? a.estimate(i) : null, mean, sd, ucbTop };
  }

  function renderMachines(now: number) {
    const tNow = mode === 'human' ? human.t : race.t;
    const env = mode === 'human' ? humanEnv : raceEnv;
    const trueP = env.probs(Math.max(0, tNow - 1));
    const infos = machines.map((_, i) => machineInfo(i));
    // Favori = meilleure estimation actuelle (parmi les machines déjà jouées).
    let fav = -1;
    infos.forEach((inf, i) => {
      if (inf.n > 0 && inf.est !== null && (fav < 0 || inf.est > (infos[fav].est ?? -1))) fav = i;
    });
    const lastArm = mode === 'human' ? human.lastArm : race.lastArm[view];
    const flashing = now < flashUntil;
    const bestArm = trueP.indexOf(Math.max(...trueP));
    machines.forEach((m, i) => {
      const inf = infos[i];
      m.est.textContent = inf.est === null ? '?' : pct(inf.est);
      const lo = Math.max(0, inf.mean - 1.96 * inf.sd);
      const hi = Math.min(1, inf.mean + 1.96 * inf.sd);
      m.ci.style.left = `${lo * 100}%`;
      m.ci.style.width = `${(hi - lo) * 100}%`;
      m.mark.style.left = `${(inf.est ?? inf.mean) * 100}%`;
      m.mark.hidden = inf.est === null;
      if (inf.ucbTop !== null && inf.est !== null) {
        m.ucb.hidden = false;
        m.ucb.style.left = `${inf.est * 100}%`;
        m.ucb.style.width = `${Math.max(0, inf.ucbTop - inf.est) * 100}%`;
      } else m.ucb.hidden = true;
      m.plays.innerHTML = `<span>${inf.n} partie${inf.n > 1 ? 's' : ''}</span><span>${inf.w} gain${inf.w > 1 ? 's' : ''}</span>`;
      m.truthMark.hidden = !reveal;
      m.truthMark.style.left = `${trueP[i] * 100}%`;
      m.truth.textContent = reveal ? `vraie : ${pct(trueP[i])}` : 'vraie : ?';
      m.truth.classList.toggle('bandit-revealed', reveal);
      m.el.classList.toggle('bandit-best', reveal && i === bestArm);
      m.tag.textContent = i === fav ? 'favori' : '';
      m.el.classList.toggle('bandit-last', i === lastArm);
      const f = flashing && i === flashArm;
      m.el.classList.toggle('bandit-win', f && flashWin);
      m.el.classList.toggle('bandit-lose', f && !flashWin);
      m.el.classList.toggle('bandit-pulled', f);
      m.el.disabled = mode !== 'human' || human.done;
      m.el.setAttribute(
        'aria-label',
        `Machine ${i + 1} : ${inf.n} parties, ${inf.w} gains, estimation ${inf.est === null ? 'inconnue' : pct(inf.est)}${reveal ? `, vraie probabilité ${pct(trueP[i])}` : ''}`,
      );
    });
  }

  // ---------- Course ----------
  function setRunning(on: boolean) {
    running = on && race !== undefined && race.t < horizon && mode === 'race';
    btnRun.textContent = running ? 'Pause' : race && race.t > 0 && race.t < horizon ? 'Reprendre' : 'Démarrer';
    lastNow = 0;
    updateStatus();
  }

  function raceStep(animate: boolean) {
    if (race.t >= horizon) return;
    race.step();
    if (animate) {
      flashArm = race.lastArm[view];
      flashWin = race.lastReward[view] === 1;
      flashUntil = performance.now() + 240;
    }
    dirty = chartDirty = true;
    if (race.t >= horizon) setRunning(false);
  }

  btnRun.addEventListener('click', () => {
    if (race.t >= horizon) newRace();
    setRunning(!running);
  });
  $('bandit-step').addEventListener('click', () => {
    setRunning(false);
    if (race.t >= horizon) newRace();
    raceStep(true);
    updateAll();
  });
  $('bandit-restart').addEventListener('click', () => {
    const was = running;
    newRace();
    setRunning(was);
    updateAll();
  });
  $('bandit-new').addEventListener('click', () => {
    newMachines((machineSeed * 1103515245 + 12345) >>> 0);
  });
  revealBox.addEventListener('change', () => setReveal(revealBox.checked));
  function setReveal(on: boolean) {
    reveal = on;
    revealBox.checked = on;
    dirty = chartDirty = true;
  }

  // ---------- Mode humain ----------
  function humanPlay(arm: number) {
    if (human.done) return;
    const r = humanEnv.pull(arm, human.t, human.rng);
    human.counts[arm]++;
    human.wins[arm] += r;
    human.total += r;
    human.t++;
    human.lastArm = arm;
    human.lastReward = r;
    flashArm = arm;
    flashWin = r === 1;
    flashUntil = performance.now() + 420;
    if (human.t >= budget) finishHuman();
    dirty = true;
    updateAll();
  }

  function finishHuman() {
    human.done = true;
    setReveal(true);
    const ref = referenceWins(humanEnv, budget);
    const rows: Array<{ label: string; value: number; sd?: number; you?: boolean; ref?: boolean }> = [
      { label: 'Vous', value: human.total, you: true },
      ...STRATEGIES.map((s, i) => {
        const r = averageWins(humanEnv, s.id, params, budget, HUMAN_SIM_RUNS, deriveSeed(machineSeed, 500 + i, humanGames));
        return { label: s.label, value: r.mean, sd: r.sd };
      }),
      { label: 'Toujours la meilleure machine', value: ref.oracle, ref: true },
      { label: 'Au hasard', value: ref.random, ref: true },
    ];
    const maxV = Math.max(...rows.map((r) => r.value), 1);
    const strat = rows.slice(1, 1 + STRATEGIES.length);
    const best = strat.reduce((a, b) => (b.value > a.value ? b : a));
    const beaten = strat.filter((r) => human.total > r.value).map((r) => r.label);
    let verdict: string;
    if (human.total >= best.value)
      verdict = `Bravo : vous faites mieux que la moyenne de toutes les stratégies, y compris ${best.label} (${fr(best.value, 1)}).`;
    else if (beaten.length)
      verdict = `Vous battez la moyenne de : ${beaten.join(', ')}. La meilleure stratégie ici est ${best.label} (${fr(best.value, 1)} en moyenne).`;
    else verdict = `Les stratégies font mieux en moyenne ; la meilleure ici est ${best.label} (${fr(best.value, 1)}).`;
    const sdBest = best.sd ?? 0;
    resultsEl.innerHTML = `
      <h2>Résultat : ${human.total} gain${human.total > 1 ? 's' : ''} sur ${budget} pièces</h2>
      <p class="help">Stratégies : moyenne sur ${HUMAN_SIM_RUNS} parties simulées avec les mêmes machines et le même budget.</p>
      <div class="bandit-bars"></div>
      <p class="bandit-verdict"></p>
      <p class="help">Avec seulement ${budget} pièces, la chance pèse lourd : d’une partie à l’autre, les gains de ${best.label} varient d’environ ±${fr(sdBest, 1)} (écart-type). Rejouez pour voir si votre méthode tient la distance.</p>`;
    resultsEl.querySelector('.bandit-verdict')!.textContent = verdict;
    const bars = resultsEl.querySelector('.bandit-bars')!;
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'bandit-bar-row' + (r.you ? ' bandit-you' : '') + (r.ref ? ' bandit-ref' : '');
      row.innerHTML = `<span class="bandit-bar-label"></span><span class="bandit-bar-track"><span class="bandit-bar-fill"></span></span><span class="bandit-bar-value"></span>`;
      (row.querySelector('.bandit-bar-label') as HTMLElement).textContent = r.label;
      (row.querySelector('.bandit-bar-fill') as HTMLElement).style.width = `${(r.value / maxV) * 100}%`;
      (row.querySelector('.bandit-bar-value') as HTMLElement).textContent = r.you ? String(r.value) : fr(r.value, 1);
      bars.append(row);
    }
    resultsEl.hidden = false;
  }

  $('bandit-human-restart').addEventListener('click', () => {
    newHuman();
    updateAll();
  });

  // ---------- Modes / vue / mesure ----------
  function setMode(m: Mode) {
    mode = m;
    setRunning(false);
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === m);
      b.setAttribute('aria-pressed', String(b.dataset.mode === m));
    });
    const isH = m === 'human';
    $('bandit-viewbar').hidden = isH;
    $('bandit-view-help').hidden = isH;
    $('bandit-human-intro').hidden = !isH;
    $('bandit-race-controls').hidden = isH;
    $('bandit-human-controls').hidden = !isH;
    $('bandit-chart-panel').hidden = isH;
    resultsEl.hidden = !isH || !human.done;
    playsSlider.el.hidden = isH;
    budgetSlider.el.hidden = !isH;
    speedSlider.el.hidden = isH;
    if (isH && !human.done) setReveal(false);
    machinesEl.classList.toggle('bandit-clickable', isH);
    dirty = chartDirty = true;
    updateAll();
  }
  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => setMode(b.dataset.mode as Mode)),
  );

  STRATEGIES.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s.label;
    b.dataset.view = String(i);
    b.addEventListener('click', () => {
      view = i;
      updateViewButtons();
      dirty = true;
      updateAll();
    });
    viewEl.append(b);
  });
  function updateViewButtons() {
    viewEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      const on = Number(b.dataset.view) === view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $('bandit-view-help').textContent = STRATEGY_HELP[STRAT_IDS[view]];
    const isUcb = STRAT_IDS[view] === 'ucb' && mode === 'race';
    $('bandit-key-ucb').hidden = !isUcb;
    $('bandit-key-ucb-text').hidden = !isUcb;
  }

  root.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach((b) =>
    b.addEventListener('click', () => {
      metric = b.dataset.metric as Metric;
      root.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach((x) => {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      chartDirty = true;
      updateChartTexts();
    }),
  );
  function updateChartTexts() {
    $('bandit-chart-title').textContent = metric === 'regret' ? 'Regret cumulé' : 'Part des coups sur la meilleure machine';
    $('bandit-chart-help').textContent =
      metric === 'regret'
        ? 'Gains perdus (en moyenne) par rapport à quelqu’un qui jouerait toujours la meilleure machine. Plus bas = mieux. Une courbe qui s’aplatit = la stratégie a trouvé la bonne machine.'
        : `Pourcentage des ${50} derniers coups joués sur la meilleure machine du moment. Plus haut = mieux. En cas de changement de réglages, on voit qui s’en aperçoit et en combien de temps.`;
  }

  // Légende cliquable (masquer / afficher une stratégie).
  const legendItems: HTMLButtonElement[] = STRATEGIES.map((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bandit-legend-item ghost';
    b.style.setProperty('--bandit-series', `var(--series-${i + 1})`);
    b.innerHTML = `<span class="bandit-swatch"></span><span class="bandit-legend-label"></span><span class="bandit-legend-value"></span>`;
    (b.querySelector('.bandit-legend-label') as HTMLElement).textContent = s.label;
    b.setAttribute('aria-pressed', 'true');
    b.title = 'Cliquer pour masquer / afficher cette courbe';
    b.addEventListener('click', () => {
      if (hidden.has(i)) hidden.delete(i);
      else hidden.add(i);
      b.classList.toggle('bandit-off', hidden.has(i));
      b.setAttribute('aria-pressed', String(!hidden.has(i)));
      chartDirty = true;
    });
    legendEl.append(b);
    return b;
  });

  // ---------- Curseurs ----------
  const world = $('bandit-world');
  const agentBox = $('bandit-agent');
  const expert = $('bandit-expert');

  const kSlider = createSlider({
    label: 'Nombre de machines',
    help: 'Plus il y a de machines, plus il faut de pièces pour toutes les essayer : l’exploration coûte plus cher. Tire de nouvelles machines.',
    min: 2, max: 10, step: 1, value: k,
    onInput: (v) => {
      k = v;
      newMachines();
    },
  });
  const playsSlider = createSlider({
    label: 'Nombre de coups de la course',
    help: 'Durée de la partie. Sur une longue partie, explorer au début rapporte davantage : on profite plus longtemps de ce qu’on a appris.',
    min: 50, max: 2000, step: 50, value: horizon,
    onInput: (v) => {
      horizon = v;
      buildEnvs();
      // Sans changement de réglages, la course continue simplement avec la nouvelle limite.
      if (change || race.t > horizon) newRace();
      setRunning(running);
      chartDirty = dirty = true;
      updateAll();
    },
  });
  const budgetSlider = createSlider({
    label: 'Votre budget (pièces)',
    help: 'Nombre de pièces que vous pouvez jouer. Changer le budget recommence la partie.',
    min: 10, max: 100, step: 5, value: budget,
    onInput: (v) => {
      budget = v;
      buildEnvs();
      newHuman();
      updateAll();
    },
  });
  const speedSlider = createSlider({
    label: 'Vitesse de l’animation',
    help: 'Nombre de coups joués par seconde (chaque stratégie joue un coup à la fois).',
    min: 1, max: SPEEDS.length, step: 1, value: speedLevel,
    format: (v) => `${SPEEDS[v - 1]} coups/s`,
    onInput: (v) => (speedLevel = v),
  });
  world.append(kSlider.el, playsSlider.el, budgetSlider.el, speedSlider.el);
  budgetSlider.el.hidden = true;

  const curiositySlider = createSlider({
    label: 'Curiosité',
    help: 'Envie d’essayer d’autres machines plutôt que de rejouer la favorite. Règle ε (ε-greedy) et c (UCB). Thompson et le glouton pur n’en tiennent pas compte : Thompson dose sa curiosité tout seul, d’après son incertitude.',
    min: 0, max: 10, step: 1, value: curiosity,
    format: (v) => {
      const p = curiosityToParams(v);
      return `${curiosityWord(v)} (ε = ${fr(p.epsilon)}, c = ${fr(p.c)})`;
    },
    onInput: (v) => {
      curiosity = v;
      const p = curiosityToParams(v);
      params.epsilon = p.epsilon;
      params.c = p.c;
      epsSlider.set(p.epsilon);
      cSlider.set(p.c);
      dirty = true;
    },
  });
  agentBox.append(curiositySlider.el);

  // Experts
  const group = (t: string) => {
    const g = document.createElement('div');
    g.className = 'group-title';
    g.textContent = t;
    return g;
  };
  const epsSlider = createSlider({
    label: 'ε (ε-greedy)',
    help: 'Probabilité de jouer une machine au hasard à chaque coup.',
    min: 0, max: 0.5, step: 0.01, value: params.epsilon, format: (v) => fr(v),
    onInput: (v) => (params.epsilon = v),
  });
  const cSlider = createSlider({
    label: 'c (UCB)',
    help: 'Poids du bonus d’optimisme c·√(ln t / n). c = √2 ≈ 1,41 : UCB1 classique. c = 0 : UCB devient glouton (après un essai par machine).',
    min: 0, max: 4, step: 0.01, value: params.c, format: (v) => fr(v),
    onInput: (v) => {
      params.c = v;
      dirty = true;
    },
  });
  const aSlider = createSlider({
    label: 'a₀ : gains imaginaires + 1 (Thompson)',
    help: 'A priori Beta(a₀, b₀) : avant de jouer, Thompson fait comme s’il avait vu a₀ − 1 gains et b₀ − 1 pertes. Beta(1, 1) = « je n’en sais rien » (uniforme).',
    min: 0.5, max: 20, step: 0.5, value: params.priorA, format: (v) => fr(v, 1),
    onInput: (v) => {
      params.priorA = v;
      dirty = true;
    },
  });
  const bSlider = createSlider({
    label: 'b₀ : pertes imaginaires + 1 (Thompson)',
    help: 'Un a priori pessimiste (b₀ grand) fait démarrer toutes les machines avec une croyance basse ; il faut plus de gains pour s’en convaincre.',
    min: 0.5, max: 20, step: 0.5, value: params.priorB, format: (v) => fr(v, 1),
    onInput: (v) => {
      params.priorB = v;
      dirty = true;
    },
  });
  const alphaSlider = createSlider({
    label: 'α : pas de la mémoire courte',
    help: 'Utilisé seulement si « Mémoire courte » est cochée : Q ← Q + α(r − Q). Chaque machine retient environ ses 1/α derniers résultats.',
    min: 0.01, max: 0.5, step: 0.01, value: params.stepSize, format: (v) => fr(v),
    onInput: (v) => {
      params.stepSize = v;
      updateShortHelp();
    },
  });
  const q0Slider = createSlider({
    label: 'Q₀ : estimation de départ (glouton, ε-greedy)',
    help: 'Avec Q₀ = 100 %, toute machine non jouée paraît excellente : même le glouton pur essaie alors chaque machine (« optimisme initial »). Recommence la course.',
    min: 0, max: 1, step: 0.05, value: params.initialValue, format: pct,
    onInput: (v) => {
      params.initialValue = v;
      newRace();
      setRunning(false);
      updateAll();
    },
  });
  expert.append(group('Exploration'), epsSlider.el, cSlider.el, group('Croyances de Thompson'), aSlider.el, bSlider.el, group('Mémoire et départ'), alphaSlider.el, q0Slider.el);

  function updateShortHelp() {
    const n = Math.round(1 / params.stepSize);
    $('bandit-short-help').textContent =
      `Coché, chaque stratégie ne retient en gros que les ~${n} derniers résultats de chaque machine (les plus anciens s’effacent peu à peu) : estimation moins précise quand rien ne change, mais bien plus réactive si le casino change les réglages.`;
  }

  shortBox.addEventListener('change', () => {
    params.shortMemory = shortBox.checked;
    dirty = true;
    updateStatus();
  });
  changeBox.addEventListener('change', () => {
    change = changeBox.checked;
    buildEnvs();
    setRunning(false);
    newRace();
    newHuman();
    updateAll();
  });

  // ---------- Scénarios ----------
  function applyScenario(kind: ScenarioKind) {
    scenario = kind;
    const s = SCENARIOS[kind];
    k = s.k;
    horizon = s.plays;
    change = s.change;
    kSlider.set(k);
    playsSlider.set(horizon);
    changeBox.checked = change;
    root.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((b) => b.classList.toggle('active', b.dataset.scenario === kind));
    $('bandit-preset-info').innerHTML = `<strong>${s.label}.</strong> ${s.description}`;
    newMachines();
  }
  root.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((b) =>
    b.addEventListener('click', () => applyScenario(b.dataset.scenario as ScenarioKind)),
  );

  // ---------- Statistiques et statut ----------
  function setStat(i: number, dt: string, dd: string) {
    $(`bandit-dt-${i}`).textContent = dt;
    $(`bandit-st-${i}`).textContent = dd;
  }

  function leaderIndex(): number {
    let best = 0;
    for (let i = 1; i < STRAT_IDS.length; i++) if (race.currentRegret(i) < race.currentRegret(best)) best = i;
    return best;
  }

  function updateStats() {
    if (mode === 'human') {
      setStat(1, 'Pièces restantes', `${budget - human.t} / ${budget}`);
      setStat(2, 'Vos gains', String(human.total));
      setStat(3, 'Votre taux', human.t ? pct(human.total / human.t) : '–');
      const tried = human.counts.filter((c) => c > 0).length;
      setStat(4, 'Machines essayées', `${tried} / ${k}`);
      return;
    }
    const lbl = STRATEGIES[view].label;
    setStat(1, 'Coup', `${race.t} / ${horizon}`);
    setStat(2, `Gains (${lbl})`, String(race.totalWins[view]));
    setStat(3, `Regret (${lbl})`, fr(race.currentRegret(view), 1));
    setStat(4, 'En tête (regret)', race.t ? STRATEGIES[leaderIndex()].label : '–');
  }

  function updateStatus() {
    let msg: string;
    if (mode === 'human') {
      if (human.done) msg = 'Partie terminée : comparez votre score aux stratégies ci-dessous.';
      else if (human.t === 0) msg = `Vous avez ${budget} pièces. Cliquez sur une machine pour jouer.`;
      else if (change && human.t === humanEnv.spec.changeAt) msg = 'Attention : le casino vient peut-être de changer ses réglages…';
      else
        msg = human.lastReward ? `M${human.lastArm + 1} : gagné !` : `M${human.lastArm + 1} : perdu.`;
    } else if (!race) msg = '';
    else if (race.t >= horizon) {
      const l = STRATEGIES[leaderIndex()].label;
      msg = `Course terminée : ${l} a le plus petit regret. Une seule course dépend de la chance : cliquez sur « Recommencer » pour en relancer une.`;
    } else if (running) {
      msg = change && race.t >= raceEnv.spec.changeAt ? 'Les réglages ont changé ! Qui s’en aperçoit ?' : 'Les stratégies jouent…';
    } else if (race.t === 0) msg = 'Prêt. Cliquez sur « Démarrer » : les quatre stratégies jouent en même temps sur les mêmes machines.';
    else msg = 'En pause.';
    statusEl.textContent = msg;
  }

  function updateAll() {
    updateViewButtons();
    updateStats();
    updateStatus();
    dirty = chartDirty = true;
  }

  // ---------- Dessins ----------
  function drawRaceChart() {
    const series = metric === 'regret' ? race.regret : race.bestShare;
    const extra = series
      .map((values, i) => ({ values, color: colors.series[i], label: STRATEGIES[i].label }))
      .filter((_, i) => !hidden.has(i));
    drawChart(chartCanvas, [], { raw: colors.chartRaw, avg: colors.accent, axis: colors.border, text: colors.muted }, {
      window: 0,
      showRaw: false,
      xLabel: 'coup',
      emptyText: 'Cliquez sur « Démarrer » pour lancer la course',
      extra,
    });
    if (change) drawChangeMarker(chartCanvas, race.t, raceEnv.spec.changeAt, colors, 'changement');
    legendItems.forEach((b, i) => {
      const v = metric === 'regret' ? race.currentRegret(i) : race.bestShare[i][race.bestShare[i].length - 1];
      (b.querySelector('.bandit-legend-value') as HTMLElement).textContent =
        v === undefined ? '' : metric === 'regret' ? fr(v, 1) : `${Math.round(v)} %`;
    });
  }

  function drawBetaChart() {
    const env = mode === 'human' ? humanEnv : raceEnv;
    const tNow = mode === 'human' ? human.t : race.t;
    const trueP = env.probs(Math.max(0, tNow - 1));
    const curves: BetaCurve[] = [];
    for (let i = 0; i < k; i++) {
      let a: number;
      let b: number;
      if (mode === 'human') {
        a = 1 + human.wins[i];
        b = 1 + human.counts[i] - human.wins[i];
      } else {
        const ag = race.agents[view];
        [a, b] = ag.strategy === 'thompson' ? ag.posterior(i) : ag.posterior(i, 1, 1);
      }
      curves.push({ a, b, color: colors.series[i % 6], dashed: i >= 6, label: `M${i + 1}`, truth: reveal ? trueP[i] : null });
    }
    drawBeta(betaCanvas, curves, colors);
    const isT = mode === 'race' && STRAT_IDS[view] === 'thompson';
    $('bandit-beta-title').textContent =
      mode === 'human' ? 'Ce que vos parties disent' : isT ? 'Croyances de Thompson' : `Ce que les parties de ${STRATEGIES[view].label} disent`;
    $('bandit-beta-help').textContent =
      mode === 'human'
        ? 'Pour chaque machine : où se situe probablement sa vraie probabilité de gain, d’après vos gains et pertes (loi Beta, en partant de « je n’en sais rien »). Plus une machine est jouée, plus sa courbe est étroite.'
        : isT
          ? 'Chaque courbe dit où Thompson pense que se trouve la vraie probabilité de gain de la machine. À chaque coup, il tire un point au hasard sous chaque courbe et joue la plus haute valeur : une courbe large peut encore « gagner le tirage », c’est son exploration. Triangles : vraies probabilités (si révélées).'
          : 'Mêmes courbes Beta, calculées à partir des gains et pertes de cette stratégie (a priori uniforme). Elle ne s’en sert pas pour choisir, mais on y voit ce qu’elle sait vraiment : une courbe large = une machine négligée.';
  }

  // ---------- Boucle ----------
  const stopLoop = rafLoop((now) => {
    if (running) {
      const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      lastNow = now;
      const speed = SPEEDS[speedLevel - 1];
      accum += dt * speed;
      let steps = Math.floor(accum);
      accum -= steps;
      steps = Math.min(steps, 200);
      const animate = speed <= 15;
      for (let i = 0; i < steps && running; i++) raceStep(animate);
      if (steps > 0) {
        updateStats();
        updateStatus();
      }
    }
    if (dirty || now < flashUntil + 50) {
      renderMachines(now);
      drawBetaChart();
      dirty = false;
    }
    if (chartDirty && mode === 'race') {
      drawRaceChart();
      chartDirty = false;
    }
  });
  disposers.push(stopLoop);

  disposers.push(
    onThemeChange(() => {
      colors = readTheme();
      dirty = chartDirty = true;
    }),
  );
  disposers.push(onResize(chartCanvas, () => (chartDirty = true)));
  disposers.push(onResize(betaCanvas, () => (dirty = true)));

  // ---------- Démarrage ----------
  updateShortHelp();
  updateChartTexts();
  applyScenario('easy');
  setMode('race');

  return () => {
    running = false;
    disposers.forEach((d) => d());
    root.replaceChildren();
  };
}
