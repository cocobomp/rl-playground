// Pré-entraînement hors ligne du robot 3D (même env.ts que le navigateur).
// Usage : npx --yes tsx scripts/quadruped3d/train.ts --name healthy --minutes 10 --threads 3
//         [--world broken|locked|heavy|slippery|weak] [--init src/problems/quadruped3d/pretrained/healthy.json]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REWARD, DEFAULT_WORLD, WorldParams, initPhysics } from '../../src/problems/quadruped3d/env';
import { BRAIN_SIZES, DEFAULT_HYPER, Trainer, evaluate, randomBrain } from '../../src/problems/quadruped3d/agent';
import { WORLD_PRESETS } from '../../src/problems/quadruped3d/worlds';

interface Job {
  id: number;
  params: Float64Array;
  world: WorldParams;
}

if (!isMainThread) {
  await initPhysics();
  parentPort!.on('message', (jobs: Job[]) => {
    const out = jobs.map((j) => ({ id: j.id, f: evaluate(j.params, j.world, DEFAULT_REWARD).fitness }));
    parentPort!.postMessage(out);
  });
} else {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : d;
  };
  const name = arg('name', 'healthy');
  const minutes = Number(arg('minutes', '10'));
  const threads = Number(arg('threads', '3'));
  const seed = Number(arg('seed', '1'));
  const worldKey = arg('world', 'healthy');
  const initPath = arg('init', '');
  const pop = Number(arg('pop', String(DEFAULT_HYPER.popSize)));
  const world: WorldParams = { ...DEFAULT_WORLD, ...(WORLD_PRESETS[worldKey] ?? {}) };
  await initPhysics();

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, '../../src/problems/quadruped3d/pretrained', `${name}.json`);
  mkdirSync(dirname(outPath), { recursive: true });

  const init = initPath ? Float64Array.from(JSON.parse(readFileSync(initPath, 'utf8')).params) : randomBrain(seed);
  const trainer = new Trainer(init, world, DEFAULT_REWARD, { ...DEFAULT_HYPER, popSize: pop }, seed);

  const workers = Array.from({ length: threads }, () => new Worker(fileURLToPath(import.meta.url), { execArgv: process.execArgv }));
  const evalAll = (cands: Float64Array[]): Promise<number[]> =>
    new Promise((res) => {
      const scores = new Array<number>(cands.length);
      let pending = workers.length;
      workers.forEach((w, wi) => {
        const jobs: Job[] = [];
        for (let i = wi; i < cands.length; i += workers.length) jobs.push({ id: i, params: cands[i], world });
        w.once('message', (out: { id: number; f: number }[]) => {
          for (const o of out) scores[o.id] = o.f;
          if (--pending === 0) res(scores);
        });
        w.postMessage(jobs);
      });
    });

  const t0 = Date.now();
  let best = { fitness: -Infinity, params: Float64Array.from(trainer.brain), gen: 0, distance: 0 };
  const curve: number[] = [];
  while (Date.now() - t0 < minutes * 60_000) {
    const scores = await evalAll(trainer.es.ask());
    const r = trainer.finish(scores);
    curve.push(+r.distance.toFixed(3));
    if (r.fitness > best.fitness) best = { fitness: r.fitness, params: Float64Array.from(trainer.brain), gen: r.generation, distance: r.distance };
    if (r.generation % 10 === 0)
      console.log(
        `gen ${r.generation} fit ${r.fitness.toFixed(2)} dist ${r.distance.toFixed(2)} E ${r.energy.toFixed(0)} fell ${r.fell} popBest ${r.popBest.toFixed(2)} best ${best.fitness.toFixed(2)}@${best.gen} t ${((Date.now() - t0) / 1000).toFixed(0)}s`,
      );
    if (r.generation % 50 === 0) save();
  }
  save();
  for (const w of workers) await w.terminate();

  function save() {
    const check = evaluate(best.params, world, DEFAULT_REWARD);
    const json = {
      sizes: BRAIN_SIZES,
      world: worldKey,
      generation: best.gen,
      distance: +check.distance.toFixed(3),
      fitness: +check.fitness.toFixed(3),
      params: Array.from(best.params, (p) => +p.toFixed(5)),
    };
    // Vérification : les poids arrondis donnent-ils le même comportement ?
    const rounded = evaluate(json.params, world, DEFAULT_REWARD);
    json.distance = +rounded.distance.toFixed(3);
    json.fitness = +rounded.fitness.toFixed(3);
    writeFileSync(outPath, JSON.stringify(json));
    console.log(`saved ${outPath} gen ${best.gen} dist(rounded) ${rounded.distance.toFixed(2)} fell ${rounded.fell}`);
  }
}
