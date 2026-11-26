// Web Worker : l'entraînement (des milliers d'épisodes simulés) tourne ici pour ne jamais bloquer la page.
import { EsOptions, EsTrainer, ReinforceOptions, ReinforceTrainer } from './agent';
import { WorldParams } from './env';
import type { FromWorker, ToWorker } from './protocol';

let algo: 'es' | 'reinforce' = 'es';
let es: EsTrainer | null = null;
let rf: ReinforceTrainer | null = null;
let world: WorldParams | null = null;
let runId = 0;
/** Arrêt automatique (générations pour ES, épisodes pour REINFORCE). */
let limit = Infinity;
let running = false;
/** Épisodes simulés par seconde (0 = aussi vite que possible). */
let pace = 150;
let credit = 0;
let lastTick = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

function costOfUnit(): number {
  return algo === 'es' && es ? es.es.popSize * es.opts.episodesPerEval : 1;
}

/** Une unité de travail : une génération (ES) ou un épisode (REINFORCE). */
function reachedLimit(): boolean {
  return algo === 'es' ? !!es && es.es.generation >= limit : !!rf && rf.episode >= limit;
}

function doUnit(pending: number[]): void {
  if (!world) return;
  if (reachedLimit()) {
    running = false;
    return;
  }
  if (algo === 'es' && es) {
    const r = es.generation(world);
    post({ type: 'gen', runId, generation: r.generation, mean: r.mean, best: r.best, champion: r.champion, episodes: r.episodes });
  } else if (rf) {
    pending.push(rf.runEpisode(world));
  }
}

function flushEpisodes(pending: number[]): void {
  if (rf && pending.length) post({ type: 'episodes', runId, steps: pending.slice(), episode: rf.episode, policy: rf.spec() });
  pending.length = 0;
}

function tick(): void {
  timer = null;
  if (!running) return;
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now;
  const pending: number[] = [];
  const t0 = performance.now();
  if (pace <= 0) {
    // Maximum : on travaille ~35 ms puis on rend la main (pour recevoir les messages).
    while (running && performance.now() - t0 < 35) doUnit(pending);
  } else {
    credit = Math.min(credit + pace * dt, costOfUnit() + pace * 0.25);
    while (running && credit >= costOfUnit() && performance.now() - t0 < 60) {
      credit -= costOfUnit();
      doUnit(pending);
    }
  }
  flushEpisodes(pending);
  timer = setTimeout(tick, pace <= 0 ? 0 : 40);
}

function setRunning(on: boolean): void {
  running = on;
  if (on && timer === null) {
    lastTick = performance.now();
    timer = setTimeout(tick, 0);
  }
  if (!on && timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function reset(a: 'es' | 'reinforce', esOpts: EsOptions, rfOpts: ReinforceOptions, w: WorldParams, id: number, max: number): void {
  algo = a;
  limit = max;
  world = w;
  runId = id;
  credit = 0;
  es = a === 'es' ? new EsTrainer(esOpts) : null;
  rf = a === 'reinforce' ? new ReinforceTrainer(rfOpts) : null;
  post({ type: 'ready', runId, policy: es ? es.champion : rf!.spec() });
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case 'reset':
      setRunning(false);
      reset(m.algo, m.es, m.rf, m.world, m.runId, m.limit);
      break;
    case 'run':
      setRunning(m.on);
      break;
    case 'world':
      world = m.world;
      break;
    case 'pace':
      pace = m.pace;
      break;
    case 'hyper':
      if (es && m.es) es.setHyper(m.es);
      if (rf && m.rf) Object.assign(rf.opts, m.rf);
      break;
    case 'unit': {
      const pending: number[] = [];
      const n = algo === 'es' ? 1 : m.episodes;
      for (let i = 0; i < n && !reachedLimit(); i++) doUnit(pending);
      flushEpisodes(pending);
      break;
    }
  }
};
