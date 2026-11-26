// Worker d'entraînement : chaque worker tient une copie identique de la stratégie d'évolution
// (même graine ⇒ mêmes variantes), évalue sa part de la population (par indice), puis tous appliquent
// la même mise à jour avec les scores complets. Résultat identique quel que soit le nombre de workers actifs.
import type { EvolutionStrategy } from '../../shared/nn';
import { makeES, evaluate, evaluateShare } from './agent';
import type { Objectives, WorldConfig } from './env';
import type { FromWorker, Scored, ToWorker } from './protocol';

let es: EvolutionStrategy | null = null;
let runId = -1;
let index = 0;
let config: WorldConfig;
let objectives: Objectives;

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.type === 'init') {
    runId = m.runId;
    index = m.index;
    config = m.config;
    objectives = m.objectives;
    es = makeES(m.init, m.es, m.seed);
  } else if (m.type === 'objectives') {
    objectives = m.objectives;
  } else if (m.type === 'hyper') {
    if (es) {
      es.popSize = Math.max(2, m.es.popSize & ~1);
      es.sigma = m.es.sigma;
      es.lr = m.es.lr;
    }
  } else if (m.type === 'gen') {
    if (!es || m.runId !== runId) return;
    const t0 = performance.now();
    if (m.fitness) es.tell(m.fitness);
    let theta: FromWorker['theta'];
    if (index === 0) theta = { r: evaluate(es.theta, config, objectives), params: Array.from(es.theta) };
    const cands = es.ask();
    const scored: Scored[] = evaluateShare(cands, index, m.active, config, objectives);
    let bestI = -1;
    let bestF = -Infinity;
    for (const s of scored) {
      if (bestI < 0 || s.r.fitness > bestF) {
        bestI = s.i;
        bestF = s.r.fitness;
      }
    }
    post({
      type: 'scores',
      runId,
      generation: es.generation + 1,
      index,
      scored,
      bestI,
      bestParams: bestI >= 0 ? Array.from(cands[bestI]) : [],
      theta,
      ms: performance.now() - t0,
    });
  }
};
