// Calibrage des niveaux « Priorité » : depuis un cerveau, quelques générations d'apprentissage
// à chaque niveau, puis distance, énergie et note obtenues. Un niveau « économe » doit encore avancer.
// Usage : npx --yes tsx scripts/quadruped3d/calibrate.ts chemin.json [générations] [fils] [niveaux, ex. 3,4]
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WORLD, EpisodeResult, RewardParams, initPhysics } from '../../src/problems/quadruped3d/env';
import { DEFAULT_HYPER, Trainer, evaluate } from '../../src/problems/quadruped3d/agent';
import { ENERGY_LEVELS, defaultSettings, rewardOf } from '../../src/problems/quadruped3d/config';

if (!isMainThread) {
  await initPhysics();
  parentPort!.on('message', (m: { c: Float64Array[]; r: RewardParams; off: number }) => {
    parentPort!.postMessage(m.c.map((p, i) => ({ i: m.off + i, r: evaluate(p, DEFAULT_WORLD, m.r) })));
  });
} else {
  await initPhysics();
  const b = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const gens = Number(process.argv[3] ?? 40);
  const threads = Number(process.argv[4] ?? 3);
  const ws = Array.from({ length: threads }, () => new Worker(fileURLToPath(import.meta.url), { execArgv: process.execArgv }));
  const evalAll = (c: Float64Array[], r: RewardParams) =>
    new Promise<EpisodeResult[]>((res) => {
      const out: EpisodeResult[] = new Array(c.length);
      let pend = ws.length;
      const chunk = Math.ceil(c.length / ws.length);
      ws.forEach((w, k) => {
        w.once('message', (o: { i: number; r: EpisodeResult }[]) => {
          for (const x of o) out[x.i] = x.r;
          if (--pend === 0) res(out);
        });
        w.postMessage({ c: c.slice(k * chunk, (k + 1) * chunk), r, off: k * chunk });
      });
    });
  const only = process.argv[5] ? process.argv[5].split(",").map(Number) : null;
  for (let lvl = 0; lvl < ENERGY_LEVELS.length; lvl++) {
    if (only && !only.includes(lvl)) continue;
    const s = defaultSettings();
    s.priority = lvl;
    const r = rewardOf(s);
    const t = new Trainer(b.params, DEFAULT_WORLD, r, DEFAULT_HYPER, 7);
    let last: EpisodeResult | null = null;
    const start = evaluate(b.params, DEFAULT_WORLD, r);
    for (let g = 0; g < gens; g++) {
      const c = t.ask();
      const res = await evalAll(c, r);
      t.finish(res);
    }
    last = evaluate(t.brain, DEFAULT_WORLD, r);
    console.log(
      `priorité ${lvl} (w=${r.energyWeight}) départ ${start.distance.toFixed(2)} m ${start.energy.toFixed(0)} J note ${start.fitness.toFixed(2)} → après ${gens} gén. : ${last.distance.toFixed(2)} m ${last.energy.toFixed(0)} J note ${last.fitness.toFixed(2)} chute ${last.fell}`,
    );
  }
  for (const w of ws) await w.terminate();
}
