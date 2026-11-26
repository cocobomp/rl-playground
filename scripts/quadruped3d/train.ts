// Pré-entraînement hors ligne du robot 3D (mêmes env.ts et agent.ts que le navigateur).
// Usage : npx --yes tsx scripts/quadruped3d/train.ts --name healthy --gens 300 --threads 3
//   [--minutes 10] [--world broken|locked|heavy|slippery|weak] [--init chemin.json] [--pop 24]
//   [--sigma 0.06] [--lr 0.05] [--seed 1] [--brainseed 1] [--priority 2] [--history "texte"] [--story story.json] [--dry]
// --story : enregistre aussi des « moments clés » (cerveaux intermédiaires) pour la frise de l'interface.
// Les candidats sont évalués par index : le résultat ne dépend pas du nombre de fils.
// Cerveaux livrés : healthy = 250 gén. de zéro (--gens 250 --seed 4 --story …, puis story.ts) ;
// broken = --world broken --init healthy.json --gens 150 --threads 2 --seed 7.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WORLD, EpisodeResult, RewardParams, WorldParams, initPhysics } from '../../src/problems/quadruped3d/env';
import { BRAIN_SIZES, DEFAULT_HYPER, PARAM_COUNT, Trainer, evaluate, randomBrain } from '../../src/problems/quadruped3d/agent';
import { WORLD_PRESETS } from '../../src/problems/quadruped3d/worlds';
import { defaultSettings, rewardOf } from '../../src/problems/quadruped3d/config';
import { jointStats } from '../../src/problems/quadruped3d/gaitstats';
import { MILESTONES } from '../../src/problems/quadruped3d/moments';

interface Job {
  id: number;
  params: Float64Array;
  world: WorldParams;
  reward: RewardParams;
}

if (!isMainThread) {
  await initPhysics();
  parentPort!.on('message', (jobs: Job[]) => {
    parentPort!.postMessage(jobs.map((j) => ({ id: j.id, r: evaluate(j.params, j.world, j.reward) })));
  });
} else {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : d;
  };
  const has = (k: string) => args.includes(`--${k}`);
  const name = arg('name', 'healthy');
  const minutes = Number(arg('minutes', '30'));
  const maxGens = Number(arg('gens', '1000000'));
  const threads = Number(arg('threads', '3'));
  const seed = Number(arg('seed', '1'));
  const worldKey = arg('world', 'healthy');
  const initPath = arg('init', '');
  const history = arg('history', '');
  const storyPath = arg('story', '');
  const settings = defaultSettings();
  settings.priority = Number(arg('priority', String(settings.priority)));
  const reward = rewardOf(settings);
  const hyper = {
    popSize: Number(arg('pop', String(DEFAULT_HYPER.popSize))),
    sigma: Number(arg('sigma', String(DEFAULT_HYPER.sigma))),
    lr: Number(arg('lr', String(DEFAULT_HYPER.lr))),
  };
  const world: WorldParams = { ...DEFAULT_WORLD, ...(WORLD_PRESETS[worldKey] ?? {}) };
  await initPhysics();

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, '../../src/problems/quadruped3d/pretrained', `${name}.json`);
  mkdirSync(dirname(outPath), { recursive: true });

  const init = initPath ? Float64Array.from(JSON.parse(readFileSync(initPath, 'utf8')).params) : randomBrain(Number(arg('brainseed', String(seed))));
  if (init.length !== PARAM_COUNT) throw new Error(`cerveau de départ incompatible (${init.length} ≠ ${PARAM_COUNT})`);
  const trainer = new Trainer(init, world, reward, hyper, seed);

  const workers = Array.from({ length: threads }, () => new Worker(fileURLToPath(import.meta.url), { execArgv: process.execArgv }));
  const evalAll = (cands: Float64Array[]): Promise<EpisodeResult[]> =>
    new Promise((res) => {
      const out = new Array<EpisodeResult>(cands.length);
      let pending = workers.length;
      workers.forEach((w, wi) => {
        const jobs: Job[] = [];
        for (let i = wi; i < cands.length; i += workers.length) jobs.push({ id: i, params: cands[i], world, reward });
        w.once('message', (o: { id: number; r: EpisodeResult }[]) => {
          for (const x of o) out[x.id] = x.r;
          if (--pending === 0) res(out);
        });
        w.postMessage(jobs);
      });
    });

  const round = (p: ArrayLike<number>) => Array.from(p, (v) => +v.toFixed(4));
  interface Moment {
    generation: number;
    distance: number;
    fell: boolean;
    kind: string;
    params: number[];
  }
  const story: Moment[] = [];
  // Mêmes paliers que la frise de l'interface (moments.ts), plus une génération régulière toutes les 25.
  const milestones = MILESTONES;
  let recordD = -Infinity;
  let firstStand = false;
  const t0 = Date.now();
  let best = { fitness: -Infinity, params: Float64Array.from(trainer.brain), gen: 0 };
  let lastLog = 0;
  for (;;) {
    const cands = trainer.ask();
    const results = await evalAll(cands);
    const r = trainer.finish(results);
    const theta = cands[0];
    if (r.fitness > best.fitness) best = { fitness: r.fitness, params: Float64Array.from(theta), gen: r.generation };
    if (storyPath) {
      const kinds: string[] = [];
      if (r.generation === 0) kinds.push('start');
      if (!r.fell && !firstStand) {
        firstStand = true;
        kinds.push('nofall');
      }
      for (const m of milestones) if (r.distance >= m && recordD < m) kinds.push(`m${m}`);
      if (r.distance > recordD) recordD = r.distance;
      if (r.generation % 25 === 0 && r.generation > 0) kinds.push('regular');
      if (kinds.length) {
        // Distance mesurée avec les paramètres arrondis : c'est elle que le rejeu montrera.
        const params = round(theta);
        const c = evaluate(params, world, reward);
        story.push({ generation: r.generation, distance: +c.distance.toFixed(3), fell: c.fell, kind: kinds.join(','), params });
      }
    }
    const el = (Date.now() - t0) / 1000;
    if (r.generation % 10 === 0 || el - lastLog > 20) {
      lastLog = el;
      console.log(
        `gen ${r.generation} fit ${r.fitness.toFixed(2)} dist ${r.distance.toFixed(2)} E ${r.energy.toFixed(0)} fell ${r.fell} popBest ${r.popBest.toFixed(2)} best ${best.fitness.toFixed(2)}@${best.gen} t ${el.toFixed(0)}s ${(r.generation + 1) / el > 0 ? ((r.generation + 1) / el).toFixed(2) : ''} gen/s`,
      );
    }
    if (r.generation + 1 >= maxGens || Date.now() - t0 > minutes * 60_000) break;
  }
  if (!has('dry')) save();
  for (const w of workers) await w.terminate();

  function save() {
    const params = round(best.params);
    const check = evaluate(params, world, reward);
    const st = jointStats(params, world);
    console.log('amplitudes (std rad) h/g par patte AvG AvD ArG ArD :', st.std.map((v) => v.toFixed(3)).join(' '));
    const json = {
      sizes: BRAIN_SIZES,
      kind: 'cpg',
      world: worldKey,
      generation: best.gen,
      distance: +check.distance.toFixed(3),
      fitness: +check.fitness.toFixed(3),
      history: history || `${best.gen} générations (monde « ${worldKey} »)`,
      params,
    };
    writeFileSync(outPath, JSON.stringify(json));
    console.log(`saved ${outPath} gen ${best.gen} dist(rounded) ${check.distance.toFixed(2)} fell ${check.fell}`);
    if (storyPath) {
      // Le cerveau final rejoint l'histoire.
      if (!story.some((m) => m.generation === best.gen))
        story.push({ generation: best.gen, distance: +check.distance.toFixed(3), fell: check.fell, kind: 'final', params });
      story.sort((a, b) => a.generation - b.generation);
      writeFileSync(storyPath, JSON.stringify(story));
      console.log(`story ${storyPath}: ${story.map((m) => `${m.generation}:${m.kind}:${m.distance}`).join(' ')}`);
    }
  }
}
