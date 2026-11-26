// Mesure de la vitesse d'apprentissage du robot marcheur (hors ligne, un seul cœur).
// Pour chaque graine : temps (mur) et nombre de générations avant d'atteindre une « bonne démarche »
// (un essai de 10 s sans chute à plus de --good mètres), en partant d'un cerveau au hasard.
//   npx --yes tsx scripts/walker/bench.ts --pop 32 --sigma 0.08 --lr 0.03 --seeds 1,2,3 --gens 300 --good 10,20
//   npx --yes tsx scripts/walker/bench.ts --init src/problems/walker/pretrained/healthy.json --task injured --good 20,25
import { DEFAULT_OBJECTIVES, HEALTHY, DT } from '../../src/problems/walker/env';
import { makeES, randomParams, runGeneration } from '../../src/problems/walker/agent';
import { readFileSync } from 'node:fs';
import { MLP } from '../../src/shared/nn';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const pop = Number(arg('pop', '32'));
const sigma = Number(arg('sigma', '0.08'));
const lr = Number(arg('lr', '0.03'));
const gens = Number(arg('gens', '300'));
const goods = arg('good', '10,20').split(',').map(Number);
const seeds = arg('seeds', '1,2,3').split(',').map(Number);
// --init cerveau.json --task injured : mesure de la réadaptation (ex. « Réapprendre » après la blessure au genou).
const initPath = process.argv.includes('--init') ? arg('init', '') : '';
const world = arg('task', 'healthy') === 'injured' ? { ...HEALTHY, lockLeftKnee: true } : HEALTHY;

for (const seed of seeds) {
  // Même tirage que la page : cerveau au hasard, échelle 0,5.
  const init = initPath ? MLP.fromJSON(JSON.parse(readFileSync(initPath, 'utf8'))).params : randomParams(seed);
  const es = makeES(init, { popSize: pop, sigma, lr }, 1000 + seed);
  const t0 = performance.now();
  let steps = 0;
  const reached: Record<number, { gen: number; s: number; steps: number }> = {};
  let best = 0;
  for (let g = 1; g <= gens; g++) {
    const rep = runGeneration(es, world, DEFAULT_OBJECTIVES);
    // Coût en pas de simulation : la population + l'évaluation de θ.
    steps += rep.steps + Math.round(rep.theta.time / DT);
    for (const r of [rep.best, rep.theta]) {
      if (!r.fell) best = Math.max(best, r.distance);
    }
    for (const gd of goods) if (!reached[gd] && best >= gd) reached[gd] = { gen: g, s: (performance.now() - t0) / 1000, steps };
    if (goods.every((gd) => reached[gd])) break;
  }
  const total = (performance.now() - t0) / 1000;
  console.log(
    JSON.stringify({ pop, sigma, lr, seed, best: +best.toFixed(2), total: +total.toFixed(1), reached }),
  );
}
