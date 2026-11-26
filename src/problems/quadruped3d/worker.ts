// Web Worker : la stratégie d'évolution et toutes les simulations d'entraînement tournent ici
// (Rapier est initialisé dans le worker), pour ne jamais bloquer la page.
import { initPhysics } from './env';
import { Trainer } from './agent';
import type { FromWorker, ToWorker } from './protocol';

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

let trainer: Trainer | null = null;
let runId = 0;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let ready = false;
const queue: ToWorker[] = [];

function tick(): void {
  timer = null;
  if (!running || !trainer) return;
  try {
    const report = trainer.generation();
    post({ type: 'gen', runId, report, brain: Array.from(trainer.brain) });
  } catch (e) {
    running = false;
    post({ type: 'error', message: String(e) });
    return;
  }
  // On rend la main entre deux générations pour recevoir les messages (pause, changements…).
  timer = setTimeout(tick, 0);
}

function setRunning(on: boolean): void {
  running = on;
  if (on && timer === null) timer = setTimeout(tick, 0);
  if (!on && timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function handle(m: ToWorker): void {
  switch (m.type) {
    case 'reset':
      setRunning(false);
      runId = m.runId;
      trainer = new Trainer(m.brain, m.world, m.reward, m.hyper, m.seed);
      post({ type: 'ready', runId });
      break;
    case 'run':
      setRunning(m.on);
      break;
    case 'world':
      if (trainer) trainer.world = { ...m.world };
      break;
    case 'reward':
      if (trainer) trainer.reward = { ...m.reward };
      break;
    case 'hyper':
      trainer?.setHyper(m.hyper);
      break;
  }
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  if (!ready) queue.push(ev.data);
  else handle(ev.data);
};

initPhysics()
  .then(() => {
    ready = true;
    for (const m of queue.splice(0)) handle(m);
  })
  .catch((e) => post({ type: 'error', message: `Rapier n’a pas pu démarrer : ${String(e)}` }));
