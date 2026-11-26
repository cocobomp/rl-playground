import { describe, expect, it } from 'vitest';
import { EvolutionStrategy, MLP } from '../src/shared/nn';
import { mulberry32, randn } from '../src/shared/rng';
import { movingAverage } from '../src/shared/chart';

describe('MLP', () => {
  it('compte correctement les paramètres', () => {
    expect(MLP.paramCount([3, 4, 2])).toBe(3 * 4 + 4 + 4 * 2 + 2);
  });

  it('calcule une propagation avant connue', () => {
    // 1 entrée → 1 sortie linéaire : y = w·x + b
    const net = new MLP([1, 1], 'linear', [2, 0.5]);
    expect(net.forward([3])[0]).toBeCloseTo(6.5);
    // tanh en sortie
    const t = new MLP([1, 1], 'tanh', [1, 0]);
    expect(t.forward([0.5])[0]).toBeCloseTo(Math.tanh(0.5));
  });

  it('se sérialise et se recharge à l’identique', () => {
    const net = new MLP([4, 8, 2]).randomize(mulberry32(1));
    const copy = MLP.fromJSON(JSON.parse(JSON.stringify(net)));
    const a = Array.from(net.forward([0.1, -0.2, 0.3, 0.4]));
    const b = Array.from(copy.forward([0.1, -0.2, 0.3, 0.4]));
    a.forEach((v, i) => expect(b[i]).toBeCloseTo(v, 4));
  });

  it('refuse un nombre de paramètres incohérent', () => {
    expect(() => new MLP([2, 2], 'tanh', [1, 2, 3])).toThrow();
  });
});

describe('EvolutionStrategy', () => {
  it('minimise une fonction quadratique', () => {
    const target = [1, -2, 0.5, 3];
    const es = new EvolutionStrategy({ dim: 4, popSize: 40, sigma: 0.2, lr: 0.1, weightDecay: 0, rng: mulberry32(5) });
    const f = (x: Float64Array) => -x.reduce((s, v, i) => s + (v - target[i]) ** 2, 0);
    for (let g = 0; g < 300; g++) {
      const cands = es.ask();
      es.tell(cands.map(f));
    }
    es.theta.forEach((v, i) => expect(v).toBeCloseTo(target[i], 1));
    expect(es.generation).toBe(300);
  });

  it('vérifie le nombre de scores', () => {
    const es = new EvolutionStrategy({ dim: 2, popSize: 4, rng: mulberry32(1) });
    es.ask();
    expect(() => es.tell([1, 2])).toThrow();
  });
});

describe('Utilitaires', () => {
  it('randn a une moyenne ≈ 0 et un écart-type ≈ 1', () => {
    const rng = mulberry32(9);
    const xs = Array.from({ length: 20000 }, () => randn(rng));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(sd - 1)).toBeLessThan(0.03);
  });

  it('moyenne glissante', () => {
    expect(movingAverage([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
  });
});
