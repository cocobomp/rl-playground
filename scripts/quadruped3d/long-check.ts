// Vérifie qu'un cerveau pré-entraîné tient sur un rejeu long (20 s) dans divers mondes.
import { readFileSync } from 'node:fs';
import { DEFAULT_REWARD, DEFAULT_WORLD, initPhysics } from '../../src/problems/quadruped3d/env';
import { evaluate } from '../../src/problems/quadruped3d/agent';
import { WORLD_PRESETS } from '../../src/problems/quadruped3d/worlds';
await initPhysics();
const b = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const [k, w] of Object.entries(WORLD_PRESETS)) {
  const r8 = evaluate(b.params, { ...DEFAULT_WORLD, ...w }, DEFAULT_REWARD);
  const r20 = evaluate(b.params, { ...DEFAULT_WORLD, ...w }, DEFAULT_REWARD, 1200);
  console.log(k.padEnd(9), '8s', r8.distance.toFixed(2), r8.fell, '| 20s', r20.distance.toFixed(2), r20.fell, r20.steps);
}
