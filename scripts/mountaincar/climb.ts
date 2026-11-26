// Seuil de montée directe (toujours « droite ») selon la force, depuis −0,6, −0,5 et −0,4.
import { physicsStep } from '../../src/problems/mountaincar/env';
function direct(x0: number, f: number, g = 1) { let x = x0, v = 0; for (let t = 0; t < 1000; t++) { const r = physicsStep(x, v, 2, f, g); x = r.x; v = r.v; if (x >= 0.5) return t + 1; } return -1; }
for (const f of [1, 1.5, 1.75, 1.8, 1.9, 2, 2.1, 2.2, 2.25, 2.3, 2.4, 2.5, 2.6, 3]) console.log(f, [-0.6, -0.5, -0.4].map((x) => direct(x, f)).join(' '));
