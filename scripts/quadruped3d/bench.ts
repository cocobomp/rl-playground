// Vitesse de l'apprentissage depuis zéro dans un seul fil (gén./s), et coût d'un essai complet.
import { readFileSync } from 'node:fs';
import { DEFAULT_REWARD, DEFAULT_WORLD, initPhysics } from '../../src/problems/quadruped3d/env';
import { DEFAULT_HYPER, Trainer, evaluate, randomBrain } from '../../src/problems/quadruped3d/agent';
await initPhysics();
const b = JSON.parse(readFileSync('src/problems/quadruped3d/pretrained/healthy.json', 'utf8'));
let t = performance.now();
for (let i = 0; i < 10; i++) evaluate(b.params, DEFAULT_WORLD, DEFAULT_REWARD);
console.log('essai complet de 8 s (ms)', ((performance.now() - t) / 10).toFixed(1));
const tr = new Trainer(randomBrain(1), DEFAULT_WORLD, DEFAULT_REWARD, DEFAULT_HYPER, 1);
t = performance.now();
for (let g = 0; g < 10; g++) tr.generation();
console.log('gén./s dans un seul fil (de zéro, 10 gén.)', (10000 / (performance.now() - t)).toFixed(2));
