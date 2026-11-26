import { initPhysics, QuadrupedEnv, DEFAULT_WORLD, DEFAULT_REWARD, OBS_SIZE } from '../../src/problems/quadruped3d/env';
import { evaluate, randomBrain } from '../../src/problems/quadruped3d/agent';
await initPhysics();
const env = new QuadrupedEnv(DEFAULT_WORLD);
for (let i = 0; i < 120; i++) { env.step(new Float64Array(8)); if (i % 30 == 0) console.log(i, env.torso.translation(), env.angles.join(',').slice(0,80), env.fallen); }
console.log('final', env.torso.translation(), env.upVector(), env.fallen);
env.free();
let t = performance.now();
for (let s = 0; s < 10; s++) { const r = evaluate(randomBrain(s), DEFAULT_WORLD, DEFAULT_REWARD); console.log(JSON.stringify(r)); }
console.log('ms/ep', (performance.now() - t) / 10);
