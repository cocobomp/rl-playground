// Vitesse d'adaptation du cerveau sain à une intervention (comme « Réapprendre » dans le navigateur).
// Usage : npx --yes tsx scripts/quadruped3d/adapt-check.ts broken|locked|heavy|slippery|weak [générations]
// (un seul fil ; pour la durée réelle avec plusieurs fils : train.ts --init … --world … --dry)
import { readFileSync } from 'node:fs';
import { DEFAULT_REWARD, DEFAULT_WORLD, initPhysics } from '../../src/problems/quadruped3d/env';
import { DEFAULT_HYPER, Trainer, evaluate } from '../../src/problems/quadruped3d/agent';
import { WORLD_PRESETS } from '../../src/problems/quadruped3d/worlds';
await initPhysics();
const w = { ...DEFAULT_WORLD, ...WORLD_PRESETS[process.argv[2] ?? 'broken'] };
const gens = Number(process.argv[3] ?? 60);
const b = JSON.parse(readFileSync('src/problems/quadruped3d/pretrained/healthy.json', 'utf8'));
console.log('départ', evaluate(b.params, w, DEFAULT_REWARD));
const t = new Trainer(b.params, w, DEFAULT_REWARD, DEFAULT_HYPER, 1);
for (let g = 0; g < gens; g++) {
  const r = t.generation();
  if (g % 5 === 0) console.log(r.generation, r.distance.toFixed(2), r.fitness.toFixed(2), r.fell);
}
