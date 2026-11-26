// Banc d'essai hors ligne : regret moyen de chaque stratégie par scénario.
// Usage : npx --yes tsx scripts/bandit/benchmark.ts
import {
  BanditEnv, DEFAULT_PARAMS, STRATEGIES, ScenarioKind, makeEnvSpec, scenarioProbs, simulate,
} from '../../src/problems/bandit/bandit';

const cases: Array<{ kind: ScenarioKind; k: number; n: number; change: boolean }> = [
  { kind: 'easy', k: 5, n: 500, change: false },
  { kind: 'hard', k: 5, n: 500, change: false },
  { kind: 'switch', k: 5, n: 500, change: true },
  { kind: 'needle', k: 10, n: 500, change: false },
];
const RUNS = 300;
for (const c of cases) {
  for (const short of [false, true]) {
    if (short && !c.change) continue;
    const params = { ...DEFAULT_PARAMS, shortMemory: short };
    const row: string[] = [];
    for (const s of STRATEGIES) {
      let reg = 0;
      for (let r = 0; r < RUNS; r++) {
        const env = new BanditEnv(makeEnvSpec(scenarioProbs(c.kind, c.k, 1000 + r), c.change, c.n));
        reg += simulate(env, s.id, params, c.n, 77 + r).regret;
      }
      row.push(`${s.label}=${(reg / RUNS).toFixed(1)}`);
    }
    console.log(`${c.kind}${short ? ' (mémoire courte)' : ''}: ${row.join('  ')}`);
  }
}
