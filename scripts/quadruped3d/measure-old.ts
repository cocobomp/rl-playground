// Mesure des amplitudes articulaires d’un ancien cerveau « réseau libre » (MLP 20→24→8, avant les métronomes).
// Usage : npx --yes tsx scripts/quadruped3d/measure-old.ts ancien.json
import { readFileSync } from 'node:fs';
import { DEFAULT_REWARD, DEFAULT_WORLD, EPISODE_STEPS, NUM_JOINTS, OBS_SIZE, QuadrupedEnv, initPhysics } from '../../src/problems/quadruped3d/env';
import { MLP } from '../../src/shared/nn';
await initPhysics();
const b = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const net = new MLP(b.sizes, 'tanh', b.params);
const env = new QuadrupedEnv(DEFAULT_WORLD);
env.gaitHz = 1.6; // l’ancien cerveau avait une horloge fixe à 1,6 Hz
const obs = new Float64Array(OBS_SIZE);
const lo = new Array(NUM_JOINTS).fill(Infinity), hi = new Array(NUM_JOINTS).fill(-Infinity);
const s = new Array(NUM_JOINTS).fill(0), s2 = new Array(NUM_JOINTS).fill(0);
let n = 0;
while (env.steps < EPISODE_STEPS && !env.fallen) {
  env.observe(obs); env.step(net.forward(obs));
  if (env.steps > 60) { n++; for (let j = 0; j < NUM_JOINTS; j++) { const a = env.angles[j]; lo[j] = Math.min(lo[j], a); hi[j] = Math.max(hi[j], a); s[j] += a; s2[j] += a * a; } }
}
const names = ['AvG', 'AvD', 'ArG', 'ArD'];
for (let j = 0; j < NUM_JOINTS; j++) { const m = s[j] / n; console.log(`${names[j >> 1]} ${j % 2 ? 'genou' : 'hanche'} range ${(hi[j] - lo[j]).toFixed(3)} std ${Math.sqrt(s2[j] / n - m * m).toFixed(3)} mean ${m.toFixed(3)}`); }
console.log('distance', env.distance.toFixed(2), 'fell', env.fallen, 'energy', env.energy.toFixed(0));
