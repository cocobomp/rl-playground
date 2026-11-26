// Vérifie la vitesse d'adaptation (cerveau sain → patte cassée), comme dans le navigateur.
import { readFileSync } from 'node:fs';
import { DEFAULT_REWARD, DEFAULT_WORLD, initPhysics } from '../../src/problems/quadruped3d/env';
import { DEFAULT_HYPER, Trainer, evaluate } from '../../src/problems/quadruped3d/agent';
await initPhysics();
const key = process.argv[2] ?? 'brokenFrontLeft';
const val = process.argv[3] ? Number(process.argv[3]) : true;
const w = { ...DEFAULT_WORLD, [key]: val };
const b = JSON.parse(readFileSync('src/problems/quadruped3d/pretrained/healthy.json', 'utf8'));
console.log('start', evaluate(b.params, w, DEFAULT_REWARD));
const R = { ...DEFAULT_REWARD, ...JSON.parse(process.env.R ?? '{}') };
const t = new Trainer(b.params, w, R, { ...DEFAULT_HYPER, ...JSON.parse(process.env.H ?? '{}') }, 1);
for (let g = 0; g < 40; g++) { const r = t.generation(); console.log(g + 1, r.distance.toFixed(2), r.fitness.toFixed(2), r.fell, r.popBest.toFixed(2)); }
