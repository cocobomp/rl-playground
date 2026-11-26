// Script hors ligne : vérifie la vitesse d'apprentissage et l'histoire « Tempête ».
// Usage : npx --yes tsx scripts/cartpole/tune.ts
import { EsTrainer, ReinforceTrainer, makeController, runEpisode, PolicySpec } from '../../src/problems/cartpole/agent';
import { DEFAULT_WORLD, WorldParams } from '../../src/problems/cartpole/env';
import { mulberry32 } from '../../src/shared/rng';

function test(spec: PolicySpec, world: WorldParams, n = 30): number {
  const c = makeController(spec, mulberry32(5));
  let s = 0;
  for (let i = 0; i < n; i++) s += runEpisode(c, world, 1000 + i);
  return s / n;
}
function trainEs(world: WorldParams, opts: object, gens: number, label: string, seed = 1) {
  const t = new EsTrainer({ seed, ...opts });
  const out: string[] = [];
  let solved = -1;
  for (let g = 0; g < gens; g++) {
    const r = t.generation(world);
    if (g % 5 === 0) out.push(`${g}:${r.mean.toFixed(0)}/${r.best.toFixed(0)}`);
    if (solved < 0 && r.mean >= 475) solved = g;
  }
  console.log(label, 'solved@', solved, out.join(' '));
  return t;
}
const arg = process.argv[2] ?? 'all';
const W = DEFAULT_WORLD;
if (arg === 'all' || arg === 'es') {
  for (const seed of [1, 2, 3, 4]) trainEs(W, {}, 40, `mlp seed${seed}`, seed);
  for (const seed of [1, 2, 3]) trainEs(W, { brain: 'linear' }, 40, `lin seed${seed}`, seed);
  trainEs({ ...W, halfLength: 0.15 }, {}, 60, 'short');
  trainEs({ ...W, massPole: 0.5 }, {}, 60, 'heavy pole');
  trainEs({ ...W, massCart: 3 }, {}, 60, 'heavy cart');
  trainEs({ ...W, forceMag: 4 }, {}, 60, 'weak motor 4');
}
if (arg === 'all' || arg === 'rf') {
  for (const lr of [0.005, 0.01, 0.02, 0.05]) {
    const t = new ReinforceTrainer({ lr, seed: 1 });
    const pts: string[] = [];
    for (let e = 0; e < 2000; e++) {
      t.runEpisode(W);
      if ((e + 1) % 200 === 0) {
        const last = t.history.slice(-200);
        pts.push((last.reduce((a, b) => a + b, 0) / 200).toFixed(0));
      }
    }
    console.log('reinforce lr', lr, pts.join(' '));
  }
}
if (arg === 'all' || arg === 'wind') {
  const wf = Number(process.argv[3] ?? 1);
  const windy = { ...W, windForce: wf };
  for (const seed of [1, 2, 3]) {
    const calm = trainEs(W, {}, 40, `calm s${seed}`, seed);
    console.log('  calm champion: calm', test(calm.champion, W), 'windy', test(calm.champion, windy));
    for (let g = 0; g < 40; g++) calm.generation(windy);
    console.log('  after windy retrain: calm', test(calm.champion, W), 'windy', test(calm.champion, windy));
  }
}
