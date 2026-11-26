import { describe, expect, it } from 'vitest';
import {
  ANGLE_LIMIT,
  CartPole,
  DEFAULT_WORLD,
  MAX_STEPS,
  State,
  accelerations,
  eulerStep,
  observe,
} from '../src/problems/cartpole/env';
import {
  EsTrainer,
  ReinforceTrainer,
  forwardLayers,
  logProbGrad,
  makeController,
  normalizedReturns,
  runEpisode,
  softmaxProb,
  PolicySpec,
} from '../src/problems/cartpole/agent';
import { MLP } from '../src/shared/nn';
import { mulberry32 } from '../src/shared/rng';

const W = DEFAULT_WORLD;

function meanScore(spec: PolicySpec, world = W, n = 20): number {
  const ctrl = makeController(spec, mulberry32(3));
  let s = 0;
  for (let i = 0; i < n; i++) s += runEpisode(ctrl, world, 5000 + i);
  return s / n;
}

describe('Physique du pendule inversé', () => {
  it('reste immobile à l’équilibre parfait, sans force', () => {
    let s: State = [0, 0, 0, 0];
    for (let i = 0; i < 100; i++) s = eulerStep(s, 0, 0, W);
    expect(s).toEqual([0, 0, 0, 0]);
  });

  it('le bâton tombe sans contrôle (en moins d’une seconde depuis 0,6°)', () => {
    const env = new CartPole(W, mulberry32(1));
    env.reset();
    env.state = [0, 0, 0.01, 0];
    while (!env.done) env.step(0);
    expect(env.failed).toBe(true);
    expect(Math.abs(env.state[2])).toBeGreaterThan(ANGLE_LIMIT);
    expect(env.state[2]).toBeGreaterThan(0); // tombe du côté où il penchait
    expect(env.steps * 0.02).toBeGreaterThan(0.8);
    expect(env.steps * 0.02).toBeLessThan(1.1);
  });

  it('est symétrique : état et force opposés donnent une trajectoire opposée', () => {
    let a: State = [0.1, -0.2, 0.03, 0.1];
    let b: State = [-0.1, 0.2, -0.03, -0.1];
    for (let i = 0; i < 40; i++) {
      const f = i % 3 === 0 ? 10 : -10;
      a = eulerStep(a, f, 0.2, W);
      b = eulerStep(b, -f, -0.2, W);
    }
    for (let k = 0; k < 4; k++) expect(a[k]).toBeCloseTo(-b[k], 12);
  });

  it('pousser le chariot à droite le fait accélérer à droite et pencher le bâton à gauche', () => {
    const [xAcc, thAcc] = accelerations([0, 0, 0, 0], 10, 0, W);
    expect(xAcc).toBeGreaterThan(0);
    expect(thAcc).toBeLessThan(0);
  });

  it('formules de Barto : valeurs numériques à θ = 0 et F = 10 N', () => {
    // temp = 10 / 1,1 ; θ̈ = −temp / (0,5 · (4/3 − 0,1/1,1)) ; ẍ = temp − 0,05 · θ̈ / 1,1
    const temp = 10 / 1.1;
    const th = -temp / (0.5 * (4 / 3 - 0.1 / 1.1));
    const [xAcc, thAcc] = accelerations([0, 0, 0, 0], 10, 0, W);
    expect(thAcc).toBeCloseTo(th, 12);
    expect(xAcc).toBeCloseTo(temp - (0.05 * th) / 1.1, 12);
  });

  it('le vent sur le bâton le fait pencher dans le sens du vent, et moins s’il est lourd', () => {
    const light = accelerations([0, 0, 0, 0], 0, 0.4, W)[1];
    const heavy = accelerations([0, 0, 0, 0], 0, 0.4, { ...W, massPole: 1 })[1];
    expect(light).toBeGreaterThan(0);
    expect(heavy).toBeGreaterThan(0);
    expect(heavy).toBeLessThan(light);
  });

  it('un bâton court tombe plus vite (temps ∝ √longueur, à peu près)', () => {
    const fallTime = (hl: number) => {
      const env = new CartPole({ ...W, halfLength: hl }, mulberry32(1));
      env.reset();
      env.state = [0, 0, 0.01, 0];
      while (!env.done) env.step(0);
      return env.steps;
    };
    const tShort = fallTime(0.15);
    const tNormal = fallTime(0.5);
    expect(tShort).toBeLessThan(tNormal);
    expect(tShort / tNormal).toBeGreaterThan(0.45);
    expect(tShort / tNormal).toBeLessThan(0.65); // √0,3 ≈ 0,55
  });

  it('borne la force du moteur et s’arrête à 500 pas au plus', () => {
    const env = new CartPole(W, mulberry32(2));
    env.reset();
    env.step(1000);
    expect(env.lastForce).toBe(10);
    // Contrôleur PD très simple : il tient les 500 pas.
    while (!env.done) env.step(env.state[2] * 60 + env.state[3] * 10 + env.state[0] * 1 + env.state[1] * 2 > 0 ? 10 : -10);
    expect(env.steps).toBeLessThanOrEqual(MAX_STEPS);
    expect(env.steps).toBe(MAX_STEPS);
    expect(env.failed).toBe(false);
  });

  it('les rafales sont reproductibles avec la même graine', () => {
    const run = () => {
      const env = new CartPole({ ...W, windForce: 0.35 }, mulberry32(9));
      env.reset();
      const winds: number[] = [];
      for (let i = 0; i < 300 && !env.done; i++) {
        env.step(env.state[2] * 60 + env.state[3] * 10 + env.state[0] + env.state[1] * 2 > 0 ? 10 : -10);
        winds.push(env.wind);
      }
      return winds;
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a.some((w) => Math.abs(w) > 0.1)).toBe(true);
    expect(Math.max(...a.map(Math.abs))).toBeLessThanOrEqual(0.35 + 1e-12);
  });
});

describe('Politiques', () => {
  it('forwardLayers donne la même sortie que MLP.forward', () => {
    const rng = mulberry32(4);
    const net = new MLP([4, 8, 1], 'tanh').randomize(rng);
    const o = [0.3, -0.2, 0.5, 0.1];
    const layers = forwardLayers(net.sizes, net.params, o);
    expect(layers.map((l) => l.length)).toEqual([4, 8, 1]);
    expect(layers[2][0]).toBeCloseTo(net.forward(o)[0], 12);
  });

  it('normalise les observations par des échelles fixes', () => {
    expect(observe([2.4, 2, ANGLE_LIMIT, -2])).toEqual([1, 1, 1, -1]);
  });

  it('REINFORCE : gradient de log π exact (différences finies)', () => {
    const w = [0.3, -0.5, 1.2, 0.7, -0.1];
    const o = [0.2, -0.4, 0.6, 0.1];
    for (const a of [0, 1] as const) {
      const g = logProbGrad(w, o, a);
      for (let i = 0; i < 5; i++) {
        const e = 1e-6;
        const wp = w.slice(), wm = w.slice();
        wp[i] += e;
        wm[i] -= e;
        const lp = (ww: number[]) => Math.log(a === 1 ? softmaxProb(ww, o) : 1 - softmaxProb(ww, o));
        expect(g[i]).toBeCloseTo((lp(wp) - lp(wm)) / (2 * e), 6);
      }
    }
  });

  it('REINFORCE : retours actualisés centrés-réduits', () => {
    const adv = normalizedReturns([1, 1, 1, 1], 0.5);
    // G = [1,875 ; 1,75 ; 1,5 ; 1] → décroissants, moyenne 0, écart-type 1
    expect(adv[0]).toBeGreaterThan(adv[3]);
    const mean = adv.reduce((a, b) => a + b, 0) / 4;
    const sd = Math.sqrt(adv.reduce((a, b) => a + (b - mean) ** 2, 0) / 4);
    expect(mean).toBeCloseTo(0, 10);
    expect(sd).toBeCloseTo(1, 6);
  });
});

describe('Apprentissage', () => {
  it('la stratégie d’évolution résout le cart-pole (≥ 195 pas en moyenne) en moins de 30 générations', () => {
    const t = new EsTrainer({ seed: 6 });
    const before = meanScore(t.spec(t.es.theta));
    let solvedAt = -1;
    for (let g = 0; g < 30 && solvedAt < 0; g++) {
      t.generation(W);
      if (meanScore(t.champion) >= 195) solvedAt = g + 1;
    }
    expect(before).toBeLessThan(100);
    expect(solvedAt).toBeGreaterThan(0);
    expect(meanScore(t.champion, W, 30)).toBeGreaterThanOrEqual(195);
  });

  it('la politique linéaire (5 nombres) suffit aussi', () => {
    const t = new EsTrainer({ seed: 6, brain: 'linear' });
    for (let g = 0; g < 35; g++) t.generation(W);
    expect(t.sizes).toEqual([4, 1]);
    expect(meanScore(t.champion)).toBeGreaterThanOrEqual(195);
  });

  it('est déterministe à graine fixée', () => {
    const a = new EsTrainer({ seed: 3 });
    const b = new EsTrainer({ seed: 3 });
    for (let g = 0; g < 3; g++) expect(a.generation(W).mean).toBe(b.generation(W).mean);
  });

  it('REINFORCE progresse (bruité) en quelques centaines d’épisodes', () => {
    const t = new ReinforceTrainer({ seed: 6, lr: 0.01 });
    for (let e = 0; e < 400; e++) t.runEpisode(W);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const early = avg(t.history.slice(0, 50));
    const late = avg(t.history.slice(300, 400));
    expect(late).toBeGreaterThan(2 * early);
    expect(late).toBeGreaterThan(150);
  });

  it('Tempête : un agent entraîné sans vent perd beaucoup de score quand le vent se lève', () => {
    const t = new EsTrainer({ seed: 6 });
    for (let g = 0; g < 40; g++) t.generation(W);
    const windy = { ...W, windForce: 0.35 };
    const theta = () => t.spec(t.es.theta);
    const calm = meanScore(theta(), W);
    const stormy = meanScore(theta(), windy);
    expect(calm).toBeGreaterThanOrEqual(475);
    expect(stormy).toBeLessThan(calm - 100);
    // … puis, entraîné avec le vent, il devient plus robuste.
    for (let g = 0; g < 40; g++) t.generation(windy);
    expect(meanScore(theta(), windy)).toBeGreaterThan(stormy + 50);
  });
});
