// Construit l'« histoire » d'un cerveau pré-entraîné (moments clés + courbes) à partir des traces de train.ts --trace.
// Chaque cerveau retenu est arrondi comme les fichiers livrés, puis réévalué : les distances affichées
// dans la frise sont exactement celles que la page rejouera.
//   npx --yes tsx scripts/walker/story.ts --task healthy --start-seed 2 \
//     --traces /tmp/h1-2.bin:0,/tmp/h2-11.bin:500 --final src/problems/walker/pretrained/healthy.json \
//     --out src/problems/walker/pretrained/story-healthy.json
//   npx --yes tsx scripts/walker/story.ts --task injured --before src/problems/walker/pretrained/healthy.json \
//     --traces /tmp/i-1.bin:800 --final src/problems/walker/pretrained/injured.json \
//     --out src/problems/walker/pretrained/story-injured.json
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_OBJECTIVES, HEALTHY, NET_SIZES, WorldConfig } from '../../src/problems/walker/env';
import { evaluate, randomParams } from '../../src/problems/walker/agent';
import { MLP } from '../../src/shared/nn';
import { StoryJSON, Timeline, roundParams } from '../../src/problems/walker/timeline';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const task = arg('task', 'healthy')!;
const config: WorldConfig = task === 'injured' ? { ...HEALTHY, lockLeftKnee: true } : { ...HEALTHY };
const dim = MLP.paramCount(NET_SIZES);
const row = 6 + dim;
// Peu d'instantanés dans le fichier livré : l'histoire doit rester lisible (et légère).
const tl = new Timeline(Number(arg('cap', '22')), Number(arg('every', '100')));
const curve: StoryJSON['curve'] = { bestDist: [], meanDist: [], bestFit: [], meanFit: [] };
const r2 = (v: number) => +v.toFixed(2);
const ev = (p: ArrayLike<number>) => evaluate(Float64Array.from(roundParams(p)), config, DEFAULT_OBJECTIVES);

let lastGen = 0;
const startSeed = arg('start-seed');
const before = arg('before');
if (startSeed) {
  const p = randomParams(Number(startSeed));
  const r = ev(p);
  tl.observe({ gen: 0, params: p, config, distance: r.distance, fell: r.fell, fitness: r.fitness }, true);
}
for (const spec of arg('traces')!.split(',')) {
  const [file, offStr] = spec.split(':');
  const off = Number(offStr);
  const buf = readFileSync(file);
  const f = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
  const n = f.length / row;
  for (let k = 0; k < n; k++) {
    const o = k * row;
    const gen = off + f[o];
    if (before && k === 0) {
      // Le cerveau sain, tel quel, dans le monde blessé : le moment « juste après la blessure ».
      const p = MLP.fromJSON(JSON.parse(readFileSync(before, 'utf8'))).params;
      const r = ev(p);
      tl.push({ gen: off, kind: 'after', params: p, config, distance: r.distance, fell: r.fell, fitness: r.fitness, extra: 'même cerveau, genou G bloqué' });
      tl.prime(r);
    }
    curve.bestDist.push(r2(f[o + 1]));
    curve.bestFit.push(r2(f[o + 2]));
    curve.meanDist.push(r2(f[o + 4]));
    curve.meanFit.push(r2(f[o + 5]));
    const p = f.subarray(o + 6, o + 6 + dim);
    const r = ev(p);
    tl.observe({ gen, params: p, config, distance: r.distance, fell: r.fell, fitness: r.fitness });
    lastGen = gen;
  }
}
const finalP = MLP.fromJSON(JSON.parse(readFileSync(arg('final')!, 'utf8'))).params;
const fr = ev(finalP);
// Le cerveau livré est le meilleur cerveau (arrondi) trouvé pendant l'entraînement : --final-gen dit à quelle génération.
const finalGen = Number(arg('final-gen', String(lastGen)));
tl.push({
  gen: finalGen,
  kind: 'final',
  params: finalP,
  config,
  distance: fr.distance,
  fell: fr.fell,
  fitness: fr.fitness,
  extra: task === 'injured' ? 'cerveau adapté (le meilleur trouvé)' : 'cerveau final (le meilleur trouvé)',
});
// Le moment final s'insère à sa place chronologique (tri stable) et remplace le record de la même génération.
tl.moments = tl.moments.filter((m) => !(m.kind === 'record' && m.gen === finalGen));
tl.moments.sort((a, b) => a.gen - b.gen);
const diff = (c: WorldConfig) => Object.fromEntries(Object.entries(c).filter(([, v]) => v));
const story: StoryJSON = {
  endGen: lastGen,
  curve,
  moments: tl.moments.map(({ key: _k, config: c, ...m }) => ({
    ...m,
    distance: +m.distance.toFixed(4),
    fitness: +m.fitness.toFixed(4),
    config: diff(c),
  })),
};
writeFileSync(arg('out')!, JSON.stringify(story));
for (const m of tl.moments) console.log(`${m.kind.padEnd(10)} ${m.label}`);
console.log(`${arg('out')} : ${(JSON.stringify(story).length / 1024).toFixed(1)} Ko`);
