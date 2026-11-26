import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/shared/rng';
import { Agent, DEFAULT_AGENT, TileCoder, Trainer, greedyRollout } from '../src/problems/mountaincar/agent';
import {
  DEFAULT_PHYSICS,
  MountainCar,
  V_MAX,
  X_MAX,
  X_MIN,
  canClimbDirectly,
  energy,
  physicsStep,
  shapingBonus,
} from '../src/problems/mountaincar/env';
import { scenarioSettings, TRAITS, detectLevel, defaultSettings } from '../src/problems/mountaincar/config';
import { runTurboBatch } from '../src/problems/mountaincar/worker';

const LEFT = 0, NONE = 1, RIGHT = 2;

function train(settings: ReturnType<typeof defaultSettings>, episodes: number, seed = 1): Trainer {
  const tr = new Trainer(settings.agent, settings.physics, mulberry32(seed));
  tr.recordTrajectory = false;
  for (let i = 0; i < episodes; i++) tr.runEpisode();
  return tr;
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

describe('dynamique', () => {
  it('applique exactement v ← v + 0,001·a − 0,0025·cos(3x), x ← x + v', () => {
    const x = -0.3, v = 0.01;
    for (const [a, sign] of [[LEFT, -1], [NONE, 0], [RIGHT, 1]]) {
      const r = physicsStep(x, v, a);
      const nv = v + 0.001 * sign - 0.0025 * Math.cos(3 * x);
      expect(r.v).toBeCloseTo(nv, 12);
      expect(r.x).toBeCloseTo(x + nv, 12);
    }
  });

  it('reste dans les bornes pour des états et actions aléatoires', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 20000; i++) {
      const x = X_MIN + rng() * (X_MAX - X_MIN);
      const v = (rng() * 2 - 1) * V_MAX;
      const r = physicsStep(x, v, Math.floor(rng() * 3), 0.5 + rng() * 4, 0.4 + rng() * 1.2);
      expect(r.x).toBeGreaterThanOrEqual(X_MIN);
      expect(r.x).toBeLessThanOrEqual(X_MAX);
      expect(Math.abs(r.v)).toBeLessThanOrEqual(V_MAX);
    }
  });

  it('le mur de gauche arrête la voiture (choc inélastique)', () => {
    const r = physicsStep(-1.19, -0.05, LEFT);
    expect(r.x).toBe(X_MIN);
    expect(r.v).toBe(0);
  });

  it('départ dans [−0,6 ; −0,4] à vitesse nulle, −1 par pas, fin au drapeau ou à la limite', () => {
    const env = new MountainCar({ ...DEFAULT_PHYSICS, maxSteps: 5 });
    const rng = mulberry32(3);
    for (let i = 0; i < 100; i++) {
      env.reset(rng);
      expect(env.x).toBeGreaterThanOrEqual(-0.6);
      expect(env.x).toBeLessThanOrEqual(-0.4);
      expect(env.v).toBe(0);
    }
    let r = env.step(NONE);
    expect(r.reward).toBe(-1);
    for (let i = 0; i < 4; i++) r = env.step(NONE);
    expect(r.truncated).toBe(true);
    expect(r.goal).toBe(false);
    env.x = 0.49;
    env.v = 0.02;
    env.t = 0;
    expect(env.step(RIGHT).goal).toBe(true);
  });

  it('moteur classique : foncer à droite ne suffit pas ; moteur ×3 : montée directe sans jamais reculer', () => {
    expect(canClimbDirectly(1, 1)).toBe(false);
    expect(canClimbDirectly(3, 1)).toBe(true);
    expect(canClimbDirectly(1, 0.3)).toBe(true);
    const run = (force: number) => {
      const env = new MountainCar({ ...DEFAULT_PHYSICS, force });
      env.x = -0.5;
      let minV = 0;
      for (;;) {
        const r = env.step(RIGHT);
        minV = Math.min(minV, r.v);
        if (r.goal || r.truncated) return { goal: r.goal, minV };
      }
    };
    expect(run(1).goal).toBe(false);
    const strong = run(3);
    expect(strong.goal).toBe(true);
    expect(strong.minV).toBeGreaterThanOrEqual(0);
  });
});

describe('coup de pouce', () => {
  it('« énergie » est à potentiel : avec γ = 1 la somme des bonus vaut −Φ(départ)', () => {
    const env = new MountainCar({ ...DEFAULT_PHYSICS, shaping: 'energy' });
    env.reset(mulberry32(1));
    const phi0 = 10 * energy(env.x, env.v);
    let sum = 0;
    let t = 0;
    for (;;) {
      // stratégie « pompe » : pousser dans le sens de la vitesse
      const r = env.step(env.v >= 0 ? RIGHT : LEFT, 1);
      sum += r.reward + 1;
      t++;
      if (r.goal || r.truncated) {
        expect(r.goal).toBe(true);
        break;
      }
    }
    expect(t).toBeLessThan(200);
    expect(sum).toBeCloseTo(-phi0, 9);
  });

  it('« vitesse » rapporte plus que le coût d’un pas quand la voiture va vite', () => {
    expect(shapingBonus('speed', 0, 0, -0.5, 0.05, false, 0.99)).toBeGreaterThan(1);
    expect(shapingBonus('none', 0, 0, -0.5, 0.05, false, 0.99)).toBe(0);
  });
});

describe('codage en tuiles', () => {
  const tc = new TileCoder(8, 8);
  const out = new Int32Array(8);

  it('compte : 8 grilles de (8+1)² tuiles', () => {
    expect(tc.size).toBe(8 * 81);
  });

  it('une tuile par grille, dans la bonne plage, y compris aux coins', () => {
    const rng = mulberry32(5);
    const pts: Array<[number, number]> = [[X_MIN, -V_MAX], [X_MAX, V_MAX], [X_MIN, V_MAX], [X_MAX, -V_MAX]];
    for (let i = 0; i < 1000; i++) pts.push([X_MIN + rng() * (X_MAX - X_MIN), (rng() * 2 - 1) * V_MAX]);
    for (const [x, v] of pts) {
      tc.indices(x, v, out);
      for (let t = 0; t < 8; t++) {
        expect(out[t]).toBeGreaterThanOrEqual(t * 81);
        expect(out[t]).toBeLessThan((t + 1) * 81);
      }
    }
  });

  it('généralise : deux états proches partagent presque toutes leurs tuiles, deux états éloignés aucune', () => {
    const shared = (a: [number, number], b: [number, number]) => {
      const A = Array.from(tc.indices(a[0], a[1], new Int32Array(8)));
      const B = new Set(tc.indices(b[0], b[1], new Int32Array(8)));
      return A.filter((i) => B.has(i)).length;
    };
    expect(shared([-0.5, 0], [-0.5, 0])).toBe(8);
    expect(shared([-0.5, 0], [-0.49, 0.001])).toBeGreaterThanOrEqual(6);
    expect(shared([-0.5, 0], [0.3, 0.05])).toBe(0);
  });

  it('les grilles sont décalées : une même tuile de grille 0 se découpe différemment dans les autres', () => {
    // Deux points dans la même tuile de la grille 0 mais séparés ailleurs.
    const w = (X_MAX - X_MIN) / 8;
    const a = tc.indices(X_MIN + 0.05 * w, 0.0001, new Int32Array(8));
    const b = tc.indices(X_MIN + 0.95 * w, 0.0001, new Int32Array(8));
    expect(a[0]).toBe(b[0]);
    expect(Array.from(a).some((i, t) => i !== b[t])).toBe(true);
  });
});

describe('agent', () => {
  it('Q part de Q₀ partout', () => {
    const ag = new Agent({ ...DEFAULT_AGENT, qInit: -42 }, mulberry32(1));
    expect(ag.q(-0.5, 0, 0)).toBeCloseTo(-42, 9);
    expect(ag.q(0.2, 0.05, 2)).toBeCloseTo(-42, 9);
  });

  it('mise à jour terminale : Q(s,a) ← Q(s,a) + α·(r − Q(s,a))', () => {
    const ag = new Agent({ ...DEFAULT_AGENT, alpha: 0.5, qInit: 0 }, mulberry32(1));
    const f = ag.features(-0.5, 0);
    const delta = ag.update(f, RIGHT, -1, null, 0);
    expect(delta).toBe(-1);
    expect(ag.qFeat(f, RIGHT)).toBeCloseTo(-0.5, 9);
    expect(ag.qFeat(f, LEFT)).toBe(0); // les autres actions ne bougent pas
  });

  it('Sarsa : δ = r + γ·Q(s′,a′) − Q(s,a)', () => {
    const ag = new Agent({ ...DEFAULT_AGENT, alpha: 0.1, gamma: 0.9, qInit: -10, lambda: 0 }, mulberry32(1));
    const f = ag.features(-0.5, 0);
    const g = ag.features(0.2, 0.05);
    const delta = ag.update(f, NONE, -1, g, LEFT);
    expect(delta).toBeCloseTo(-1 + 0.9 * -10 - -10, 9);
    expect(ag.qFeat(f, NONE)).toBeCloseTo(-10 + 0.1 * delta, 9);
  });

  it('traces : le mérite remonte vers les états précédents (λ > 0), pas avec λ = 0', () => {
    for (const lambda of [0, 0.9]) {
      const ag = new Agent({ ...DEFAULT_AGENT, alpha: 0.5, gamma: 1, lambda, qInit: 0 }, mulberry32(1));
      const s1 = ag.features(-1.0, -0.05);
      const s2 = ag.features(0.4, 0.06);
      ag.update(s1, LEFT, 0, s2, RIGHT);
      ag.update(s2, RIGHT, 10, null, 0);
      if (lambda === 0) expect(ag.qFeat(s1, LEFT)).toBe(0);
      else expect(ag.qFeat(s1, LEFT)).toBeCloseTo(0.5 * 10 * 0.9, 9);
    }
  });
});

describe('apprentissage', () => {
  it('réglages par défaut : moins de 300 pas en moyenne après 100 épisodes (graine fixe)', () => {
    const tr = train(defaultSettings(), 100, 1);
    const first = mean(tr.history.slice(0, 5).map((r) => r.steps));
    const last = mean(tr.history.slice(-20).map((r) => r.steps));
    expect(first).toBeGreaterThan(300);
    expect(last).toBeLessThan(300);
    expect(tr.history.slice(-20).every((r) => r.goal)).toBe(true);
    // la stratégie gloutonne apprise recule d’abord (vitesse négative) avant d’arriver
    const test = greedyRollout(tr.agent, DEFAULT_PHYSICS, -0.5, 0);
    expect(test.goal).toBe(true);
    let minV = 0;
    for (let i = 1; i < test.traj.length; i += 2) minV = Math.min(minV, test.traj[i]);
    expect(minV).toBeLessThan(-0.01);
  });

  it('Q(λ) apprend aussi', () => {
    const s = defaultSettings();
    s.agent.algorithm = 'qlearning';
    const tr = train(s, 100, 2);
    expect(mean(tr.history.slice(-20).map((r) => r.steps))).toBeLessThan(300);
  });

  it('le lot turbo (worker) renvoie des poids entraînés et un résultat par épisode', () => {
    const s = defaultSettings();
    const agent = new Agent(s.agent, mulberry32(1));
    const reply = runTurboBatch({ gen: 3, cfg: s.agent, physics: s.physics, weights: agent.w.slice(), seed: 9, maxEpisodes: 30, budgetMs: 10000 });
    expect(reply.gen).toBe(3);
    expect(reply.results).toHaveLength(30);
    expect(reply.weights.length).toBe(agent.w.length);
    expect(reply.traj.length).toBe(2 * (reply.results[29].steps + 1));
  });
});

describe('scénarios (ce que racontent les textes)', () => {
  it('« Moteur surpuissant » : vite appris, une quarantaine de pas', () => {
    const tr = train(scenarioSettings('strong'), 60, 1);
    expect(mean(tr.history.slice(-20).map((r) => r.steps))).toBeLessThan(50);
  });

  it('« Sans curiosité » (ε = 0, Q₀ = 0) apprend quand même grâce à l’optimisme', () => {
    const tr = train(scenarioSettings('nocuriosity'), 100, 1);
    expect(mean(tr.history.slice(-20).map((r) => r.steps))).toBeLessThan(200);
  });

  it('curiosité « Méfiante » (Q₀ = −150 < −1/(1−γ)) : n’atteint presque jamais le drapeau', () => {
    const s = defaultSettings();
    const trait = TRAITS.find((t) => t.id === 'curiosity')!;
    trait.levels[0].apply(s);
    expect(detectLevel(trait, s)).toBe(0);
    const tr = train(s, 40, 1);
    expect(tr.history.filter((r) => r.goal).length).toBeLessThanOrEqual(2);
  });

  it('« Récompense mal conçue » : finit par se balancer jusqu’à la limite, avec un score perçu positif', () => {
    for (const seed of [1, 2, 4]) {
      const tr = train(scenarioSettings('badreward'), 150, seed);
      const tail = tr.history.slice(-20);
      expect(tail.filter((r) => !r.goal).length).toBeGreaterThanOrEqual(18);
      expect(mean(tail.map((r) => r.ret))).toBeGreaterThan(0);
    }
    // avec la graine 2, elle a d’abord su arriver, puis a « préféré » le bonus
    const tr2 = train(scenarioSettings('badreward'), 150, 2);
    expect(tr2.history.slice(0, 10).every((r) => r.goal)).toBe(true);
  });
});
