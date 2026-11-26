// Choisit 5 à 7 moments clés dans l'histoire brute d'un entraînement (train.ts --story) pour la frise.
// Usage : npx --yes tsx scripts/quadruped3d/story.ts story-raw.json src/problems/quadruped3d/pretrained/story.json
import { readFileSync, writeFileSync } from 'node:fs';
interface M { generation: number; distance: number; fell: boolean; kind: string; params: number[] }
const raw = JSON.parse(readFileSync(process.argv[2], 'utf8')) as M[];
const has = (m: M, k: string) => m.kind.split(',').includes(k);
const pick: M[] = [];
const add = (m: M | undefined) => m && !pick.includes(m) && pick.push(m);
add(raw.find((m) => has(m, 'start')));
add(raw.find((m) => has(m, 'nofall') && m.generation > 0));
// Paliers de moments.ts : une étape par ordre de grandeur, jusqu'à 6 moments avant le cerveau final.
for (const k of ['m3', 'm8', 'm12', 'm16', 'm20']) if (pick.length < 6) add(raw.find((m) => has(m, k)));
add(raw.find((m) => has(m, 'final')) ?? raw[raw.length - 1]);
pick.sort((a, b) => a.generation - b.generation);
writeFileSync(process.argv[3], JSON.stringify(pick));
console.log(pick.map((m) => `${m.generation}:${m.kind}:${m.distance}${m.fell ? 'F' : ''}`).join(' '), 'octets', JSON.stringify(pick).length);
