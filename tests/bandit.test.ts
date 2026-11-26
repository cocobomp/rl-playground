import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/shared/rng';
import {
  Agent,
  BanditEnv,
  DEFAULT_PARAMS,
  Race,
  STRATEGIES,
  StrategyId,
  argmaxRandom,
  averageWins,
  betaMoments,
  betaPdf,
  logGamma,
  makeEnvSpec,
  referenceWins,
  reversedRanking,
  sampleBeta,
  sampleGamma,
  scenarioProbs,
  simulate,
  ucbScore,
} from '../src/problems/bandit/bandit';

function meanVar(xs: number[]) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
  return { m, v };
}

describe('outils statistiques', () => {
  it('logGamma correspond aux factorielles', () => {
    expect(logGamma(1)).toBeCloseTo(0, 10);
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 10);
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10);
  });

  it('la densité Beta s’intègre à 1 et vaut 1 pour Beta(1,1)', () => {
    expect(betaPdf(0.3, 1, 1)).toBeCloseTo(1, 10);
    expect(betaPdf(0.5, 2, 2)).toBeCloseTo(1.5, 10);
    for (const [a, b] of [[2, 5], [10, 3], [30, 70]]) {
      let s = 0;
      const n = 4000;
      for (let i = 0; i < n; i++) s += betaPdf((i + 0.5) / n, a, b) / n;
      expect(s).toBeCloseTo(1, 3);
    }
  });

  it('Gamma (Marsaglia–Tsang) : moyenne = variance = forme', () => {
    const rng = mulberry32(1);
    for (const shape of [0.5, 1, 3.5, 20]) {
      const xs = Array.from({ length: 20000 }, () => sampleGamma(rng, shape));
      const { m, v } = meanVar(xs);
      expect(Math.abs(m - shape) / shape).toBeLessThan(0.03);
      expect(Math.abs(v - shape) / shape).toBeLessThan(0.08);
      expect(xs.every((x) => x > 0)).toBe(true);
    }
  });

  it('Beta : moyenne et variance correctes', () => {
    const rng = mulberry32(2);
    for (const [a, b] of [[1, 1], [2, 5], [0.5, 0.5], [30, 10]]) {
      const xs = Array.from({ length: 20000 }, () => sampleBeta(rng, a, b));
      const { m, v } = meanVar(xs);
      const th = betaMoments(a, b);
      expect(Math.abs(m - th.mean)).toBeLessThan(0.01);
      expect(Math.abs(v - th.sd * th.sd) / (th.sd * th.sd)).toBeLessThan(0.08);
      expect(xs.every((x) => x >= 0 && x <= 1)).toBe(true);
    }
  });

  it('argmaxRandom départage les ex æquo uniformément', () => {
    const rng = mulberry32(3);
    const hits = [0, 0, 0, 0];
    for (let i = 0; i < 9000; i++) hits[argmaxRandom([1, 3, 3, 3], rng)]++;
    expect(hits[0]).toBe(0);
    for (const h of hits.slice(1)) expect(Math.abs(h - 3000)).toBeLessThan(200);
  });
});

describe('formules de mise à jour', () => {
  it('moyenne incrémentale = taux de gain observé', () => {
    const a = new Agent('egreedy', 3, { ...DEFAULT_PARAMS }, mulberry32(4));
    for (const r of [1, 0, 1, 1]) a.update(1, r);
    expect(a.counts[1]).toBe(4);
    expect(a.values[1]).toBeCloseTo(0.75, 12);
    expect(a.values[0]).toBe(0);
    expect(a.t).toBe(4);
  });

  it('mémoire courte : pas constant α, les vieux résultats s’effacent', () => {
    const p = { ...DEFAULT_PARAMS, shortMemory: true, stepSize: 0.5 };
    const a = new Agent('egreedy', 2, p, mulberry32(5));
    a.update(0, 1); // Q = 0 + 0,5·(1 − 0) = 0,5
    a.update(0, 1); // 0,75
    a.update(0, 0); // 0,375
    expect(a.values[0]).toBeCloseTo(0.375, 12);
    // Information retenue : 0,5·(0,5·1 + 1) + 1 = 1,75 < 3 parties réelles
    expect(a.effectiveCount(0)).toBeCloseTo(1.75, 12);
    expect(a.counts[0]).toBe(3);
  });

  it('a posteriori de Thompson = a priori + gains / pertes', () => {
    const a = new Agent('thompson', 2, { ...DEFAULT_PARAMS, priorA: 2, priorB: 3 }, mulberry32(6));
    for (const r of [1, 1, 0]) a.update(0, r);
    expect(a.posterior(0)).toEqual([4, 4]);
    expect(a.posterior(1)).toEqual([2, 3]);
    expect(a.estimate(0)).toBeCloseTo(0.5, 12);
  });

  it('formule UCB : Q + c·√(ln t / n), +∞ si jamais jouée', () => {
    expect(ucbScore(0.5, 0, 10, 1)).toBe(Infinity);
    expect(ucbScore(0.5, 4, 100, Math.SQRT2)).toBeCloseTo(0.5 + Math.SQRT2 * Math.sqrt(Math.log(100) / 4), 12);
    // Plus une machine est jouée, plus son bonus diminue.
    expect(ucbScore(0.5, 50, 100, 1)).toBeLessThan(ucbScore(0.5, 5, 100, 1));
  });

  it('UCB essaie chaque machine une fois avant tout', () => {
    const env = new BanditEnv(makeEnvSpec([0.9, 0.1, 0.2, 0.3], false, 100));
    const a = new Agent('ucb', 4, { ...DEFAULT_PARAMS }, mulberry32(7));
    const rr = mulberry32(8);
    for (let t = 0; t < 4; t++) {
      const arm = a.select();
      a.update(arm, env.pull(arm, t, rr));
    }
    expect(a.counts).toEqual([1, 1, 1, 1]);
  });
});

describe('environnement', () => {
  it('gagne avec la bonne fréquence', () => {
    const env = new BanditEnv(makeEnvSpec([0.2, 0.7], false, 10));
    const rng = mulberry32(9);
    let w = 0;
    for (let i = 0; i < 20000; i++) w += env.pull(1, i, rng);
    expect(Math.abs(w / 20000 - 0.7)).toBeLessThan(0.015);
  });

  it('le casino inverse le classement à mi-partie', () => {
    const p = [0.1, 0.8, 0.4];
    expect(reversedRanking(p)).toEqual([0.8, 0.1, 0.4]);
    const env = new BanditEnv(makeEnvSpec(p, true, 100));
    expect(env.bestArm(49)).toBe(1);
    expect(env.bestArm(50)).toBe(0);
  });

  it('scénarios : probabilités valides, meilleure machine unique', () => {
    for (const kind of ['easy', 'hard', 'switch', 'needle'] as const) {
      for (const k of [2, 5, 10]) {
        const p = scenarioProbs(kind, k, 42);
        expect(p).toHaveLength(k);
        expect(p.every((v) => v > 0 && v < 1)).toBe(true);
        const max = Math.max(...p);
        expect(p.filter((v) => v === max)).toHaveLength(1);
      }
    }
    const needle = scenarioProbs('needle', 10, 1);
    expect(needle.filter((v) => v >= 0.5)).toHaveLength(1);
  });

  it('référence : l’oracle gagne plus que le hasard', () => {
    const env = new BanditEnv(makeEnvSpec([0.2, 0.6], false, 30));
    const r = referenceWins(env, 30);
    expect(r.oracle).toBeCloseTo(18, 9);
    expect(r.random).toBeCloseTo(12, 9);
  });
});

describe('apprentissage', () => {
  it('la course est déterministe pour une graine donnée', () => {
    const run = () => {
      const env = new BanditEnv(makeEnvSpec(scenarioProbs('easy', 5, 3), false, 200));
      const race = new Race(env, STRATEGIES.map((s) => s.id), { ...DEFAULT_PARAMS }, 123);
      for (let i = 0; i < 200; i++) race.step();
      return race.regret.map((r) => r[r.length - 1]);
    };
    expect(run()).toEqual(run());
  });

  it('UCB et Thompson battent le glouton pur (regret moyen sur 40 graines)', () => {
    const avg = (s: StrategyId) => {
      let tot = 0;
      for (let seed = 0; seed < 40; seed++) {
        const env = new BanditEnv(makeEnvSpec(scenarioProbs('easy', 5, 500 + seed), false, 1000));
        tot += simulate(env, s, { ...DEFAULT_PARAMS }, 1000, seed).regret;
      }
      return tot / 40;
    };
    const greedy = avg('greedy');
    expect(avg('ucb')).toBeLessThan(greedy * 0.8);
    expect(avg('thompson')).toBeLessThan(greedy * 0.5);
    expect(avg('egreedy')).toBeLessThan(greedy);
  });

  it('Thompson finit par jouer surtout la meilleure machine', () => {
    const env = new BanditEnv(makeEnvSpec([0.2, 0.3, 0.75, 0.4], false, 2000));
    const race = new Race(env, ['thompson'], { ...DEFAULT_PARAMS }, 5);
    for (let i = 0; i < 2000; i++) race.step();
    expect(race.agents[0].counts[2] / 2000).toBeGreaterThan(0.9);
  });

  it('mémoire courte : s’adapte mieux au changement de réglages', () => {
    let longReg = 0;
    let shortReg = 0;
    for (let seed = 0; seed < 30; seed++) {
      const env = new BanditEnv(makeEnvSpec(scenarioProbs('switch', 5, 900 + seed), true, 600));
      longReg += simulate(env, 'ucb', { ...DEFAULT_PARAMS }, 600, seed).regret;
      shortReg += simulate(env, 'ucb', { ...DEFAULT_PARAMS, shortMemory: true }, 600, seed).regret;
    }
    expect(shortReg).toBeLessThan(longReg * 0.8);
  });

  it('gains moyens simulés cohérents avec les références', () => {
    const env = new BanditEnv(makeEnvSpec([0.1, 0.2, 0.8], false, 30));
    const ref = referenceWins(env, 30);
    const th = averageWins(env, 'thompson', { ...DEFAULT_PARAMS }, 30, 200, 1);
    expect(th.mean).toBeGreaterThan(ref.random);
    expect(th.mean).toBeLessThan(ref.oracle);
  });
});
