// Expériences hors-ligne : npx --yes tsx scripts/mountaincar/experiment.ts
import { mulberry32 } from '../../src/shared/rng';
import { DEFAULT_AGENT, Trainer, AgentConfig } from '../../src/problems/mountaincar/agent';
import { DEFAULT_PHYSICS, PhysicsParams } from '../../src/problems/mountaincar/env';

function run(name: string, cfg: Partial<AgentConfig>, phys: Partial<PhysicsParams>, episodes = 200, seeds = [1, 2, 3]) {
  const t0 = Date.now();
  const rows: string[] = [];
  for (const seed of seeds) {
    const tr = new Trainer({ ...DEFAULT_AGENT, ...cfg }, { ...DEFAULT_PHYSICS, ...phys }, mulberry32(seed));
    tr.recordTrajectory = false;
    for (let i = 0; i < episodes; i++) tr.runEpisode();
    const h = tr.history.map((r) => r.steps);
    const avg = (a: number, b: number) => (h.slice(a, b).reduce((s, x) => s + x, 0) / (b - a)).toFixed(0);
    const goals = tr.history.filter((r) => r.goal).length;
    rows.push(`s${seed}: ep1-10 ${avg(0, 10)} | 40-50 ${avg(40, 50)} | 90-100 ${avg(90, 100)} | last20 ${avg(episodes - 20, episodes)} goals ${goals} ret ${tr.history[episodes - 1].ret.toFixed(0)}`);
  }
  console.log(`== ${name} (${Date.now() - t0} ms)\n  ` + rows.join('\n  '));
}

const which = process.argv[2] ?? 'all';
if (which === 'all' || which === 'base') {
  run('défaut', {}, {});
  run('eps 0.05', { epsilon: 0.05 }, {});
  run('eps 0.2', { epsilon: 0.2 }, {});
  run('qlearning', { algorithm: 'qlearning' }, {});
  run('lambda 0', { lambda: 0 }, {});
  run('alpha 0.1', { alpha: 0.1 }, {});
  run('alpha 1', { alpha: 1 }, {});
  run('force 3', {}, { force: 3 });
  run('gravity 0.4', {}, { gravity: 0.4 });
  run('gravity 1.5', {}, { gravity: 1.5 });
}
if (which === 'all' || which === 'shaping') {
  run('energy', {}, { shaping: 'energy' });
  run('speed', {}, { shaping: 'speed' });
}
if (which === 'all' || which === 'pess') {
  run('g0.99 q0', { gamma: 0.99 }, {});
  run('g0.99 q-150 eps0', { gamma: 0.99, qInit: -150 }, {});
  run('g0.99 q-150 eps0.1', { gamma: 0.99, qInit: -150, epsilon: 0.1 }, {});
  run('g1 q-300', { qInit: -300 }, {});
}
