// Web Worker d'évaluation : joue des essais de 8 s (physique Rapier) pour des cerveaux candidats.
// Plusieurs workers tournent en parallèle ; la stratégie d'évolution reste dans la page (pool.ts).
import { initPhysics } from './env';
import { evaluate } from './agent';
import type { FromWorker, ToWorker } from './protocol';

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);
let ready = false;
const queue: ToWorker[] = [];

function handle(m: ToWorker): void {
  try {
    post({ type: 'result', batch: m.batch, index: m.index, result: evaluate(m.params, m.world, m.reward) });
  } catch (e) {
    post({ type: 'error', message: String(e) });
  }
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  if (!ready) queue.push(ev.data);
  else handle(ev.data);
};

initPhysics()
  .then(() => {
    ready = true;
    post({ type: 'ready' });
    for (const m of queue.splice(0)) handle(m);
  })
  .catch((e) => post({ type: 'error', message: `Rapier n’a pas pu démarrer : ${String(e)}` }));
