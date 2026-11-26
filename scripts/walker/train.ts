// Pré-entraînement hors ligne des cerveaux du robot marcheur.
// Utilise EXACTEMENT le même code de simulation que la page (src/problems/walker/env.ts).
//
// Un seul entraînement (un processus, une graine) :
//   npx --yes tsx scripts/walker/train.ts --task healthy --seed 1 --gens 400 --out /tmp/healthy-1.json
//   npx --yes tsx scripts/walker/train.ts --task injured --init src/problems/walker/pretrained/healthy.json --seed 1 --gens 200 --out /tmp/injured-1.json
// Tout le pipeline (plusieurs graines en parallèle, on garde la meilleure) :
//   npx --yes tsx scripts/walker/train.ts --all
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OBJECTIVES, HEALTHY, NET_SIZES, WorldConfig } from '../../src/problems/walker/env';
import { evaluate, makeES, randomParams, runGeneration } from '../../src/problems/walker/agent';
import { MLP } from '../../src/shared/nn';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const outDir = resolve(root, 'src/problems/walker/pretrained');

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const TASKS: Record<string, WorldConfig> = {
  healthy: HEALTHY,
  injured: { ...HEALTHY, lockLeftKnee: true },
};

function trainOne(): void {
  const task = arg('task', 'healthy')!;
  const config = TASKS[task];
  const seed = Number(arg('seed', '1'));
  const gens = Number(arg('gens', '300'));
  const pop = Number(arg('pop', '48'));
  const sigma = Number(arg('sigma', '0.08'));
  const lr = Number(arg('lr', '0.03'));
  const out = arg('out')!;
  const initPath = arg('init');
  // --trace fichier : pour chaque génération, la meilleure distance/score, la moyenne et le cerveau de la génération
  // (binaire Float64 : [gen, bestDist, bestFit, bestFell, meanDist, meanFit, ...params]), pour bâtir les « moments clés ».
  const tracePath = arg('trace');
  const traceChunks: Buffer[] = [];
  const init = initPath ? MLP.fromJSON(JSON.parse(readFileSync(initPath, 'utf8'))).params : randomParams(seed);
  const es = makeES(init, { popSize: pop, sigma, lr }, seed * 7919 + 13);
  let bestFit = -Infinity;
  let bestParams = Float64Array.from(init);
  const t0 = Date.now();
  const first = evaluate(init, config, DEFAULT_OBJECTIVES);
  bestFit = first.fitness;
  console.log(`[${task} s${seed}] départ : ${first.distance.toFixed(2)} m, chute=${first.fell}, score ${first.fitness.toFixed(2)}`);
  for (let g = 1; g <= gens; g++) {
    const rep = runGeneration(es, config, DEFAULT_OBJECTIVES);
    if (tracePath) {
      const gb = rep.theta.fitness >= rep.best.fitness ? { r: rep.theta, p: es.theta } : { r: rep.best, p: rep.bestParams };
      // NB : es.theta est déjà mis à jour ici ; rep.theta est le résultat du θ mis à jour (voir runGeneration).
      const row = new Float64Array(6 + gb.p.length);
      row.set([g, gb.r.distance, gb.r.fitness, gb.r.fell ? 1 : 0, rep.meanDistance, rep.mean]);
      row.set(gb.p, 6);
      traceChunks.push(Buffer.from(row.buffer));
    }
    for (const [r, p] of [
      [rep.best, rep.bestParams],
      [rep.theta, es.theta],
    ] as const) {
      if (r.fitness > bestFit) {
        bestFit = r.fitness;
        bestParams = Float64Array.from(p);
      }
    }
    if (g % 10 === 0 || g === gens) {
      const b = evaluate(bestParams, config, DEFAULT_OBJECTIVES);
      console.log(
        `[${task} s${seed}] gen ${g} moy ${rep.mean.toFixed(2)} θ ${rep.theta.fitness.toFixed(2)} record ${bestFit.toFixed(2)} (${b.distance.toFixed(2)} m, ${b.energy.toFixed(0)} J, chute=${b.fell}) ${((Date.now() - t0) / 1000).toFixed(0)} s`,
      );
      writeFileSync(out, JSON.stringify({ fitness: bestFit, brain: new MLP(NET_SIZES, 'tanh', bestParams).toJSON() }));
      if (tracePath) writeFileSync(tracePath, Buffer.concat(traceChunks));
    }
  }
}

function runChild(args: string[]): Promise<void> {
  return new Promise((ok, ko) => {
    const p = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ...args], { stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? ok() : ko(new Error(`code ${code}`))));
  });
}

async function pickBest(task: string, outName: string, seeds: number[], extra: string[]): Promise<string> {
  const files = seeds.map((s) => `/tmp/walker-${outName}-${s}.json`);
  await Promise.all(seeds.map((s, i) => runChild(['--task', task, '--seed', String(s), '--out', files[i], ...extra])));
  const all = files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as { fitness: number; brain: unknown });
  all.sort((a, b) => b.fitness - a.fitness);
  mkdirSync(outDir, { recursive: true });
  const dest = resolve(outDir, `${outName}.json`);
  writeFileSync(dest, JSON.stringify(all[0].brain));
  console.log(`→ ${dest} (score ${all[0].fitness.toFixed(2)})`);
  return dest;
}

async function main() {
  if (!process.argv.includes('--all')) return trainOne();
  const procs = Number(arg('procs', '3'));
  const seeds = Array.from({ length: procs }, (_, i) => i + 1);
  // 1) robot intact, à partir de zéro ; 2) affinage du même cerveau (bruit plus faible) ;
  // 3) genou gauche bloqué, en partant du cerveau sain affiné, avec le même budget que l'affinage
  //    (comparaison équitable : le cerveau blessé n'a pas eu plus d'entraînement que le sain).
  const fine = arg('gens-fine', '300')!;
  // --skip-scratch : reprend le healthy.json existant (étape 1 déjà faite).
  let healthy = process.argv.includes('--skip-scratch')
    ? resolve(outDir, 'healthy.json')
    : await pickBest('healthy', 'healthy', seeds, ['--gens', arg('gens-healthy', '500')!]);
  healthy = await pickBest('healthy', 'healthy', seeds.map((s) => s + 10), ['--gens', fine, '--init', healthy, '--sigma', '0.05']);
  await pickBest('injured', 'injured', seeds, ['--gens', fine, '--init', healthy, '--sigma', '0.05']);
}

main();
