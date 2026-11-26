import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_REWARD,
  DEFAULT_WORLD,
  EPISODE_STEPS,
  NUM_JOINTS,
  OBS_SIZE,
  QuadrupedEnv,
  START_HEIGHT,
  fitnessOf,
  initPhysics,
  kneeIndex,
  relativeAngleZ,
  rotate,
  rotateInv,
} from '../src/problems/quadruped3d/env';
import { BRAIN_SIZES, PARAM_COUNT, Trainer, evaluate, makePolicy, randomBrain } from '../src/problems/quadruped3d/agent';
import { INTERVENTIONS, SCENARIOS, rewardOf, defaultSettings } from '../src/problems/quadruped3d/config';

import { PRETRAINED_BROKEN, PRETRAINED_HEALTHY } from '../src/problems/quadruped3d/pretrained';

const load = (name: 'healthy' | 'broken') => (name === 'healthy' ? PRETRAINED_HEALTHY : PRETRAINED_BROKEN);

beforeAll(async () => {
  await initPhysics();
});

function run(env: QuadrupedEnv, steps: number, action: (t: number) => number[]): void {
  for (let t = 0; t < steps; t++) env.step(action(t));
}

describe('quaternions et angles', () => {
  it('rotateInv annule rotate', () => {
    const s = Math.sin(0.4), c = Math.cos(0.4);
    const q = { x: 0.3 * s, y: 0.5 * s, z: Math.sqrt(1 - 0.34) * s, w: c };
    const v = { x: 0.2, y: -1.3, z: 0.7 };
    const back = rotateInv(q, rotate(q, v));
    expect(back.x).toBeCloseTo(v.x, 10);
    expect(back.y).toBeCloseTo(v.y, 10);
    expect(back.z).toBeCloseTo(v.z, 10);
  });
  it('relativeAngleZ retrouve une rotation autour de z', () => {
    const a = 0.7;
    const id = { x: 0, y: 0, z: 0, w: 1 };
    const qz = { x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) };
    expect(relativeAngleZ(id, qz)).toBeCloseTo(a, 10);
    expect(relativeAngleZ(qz, id)).toBeCloseTo(-a, 10);
    // Rotation de 90° autour de z : (1,0,0) → (0,1,0)
    const q90 = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
    const r = rotate(q90, { x: 1, y: 0, z: 0 });
    expect(r.x).toBeCloseTo(0, 10);
    expect(r.y).toBeCloseTo(1, 10);
  });
});

describe('environnement Rapier', () => {
  it('le robot tient debout sans consigne et perçoit la gravité vers le bas', () => {
    const env = new QuadrupedEnv(DEFAULT_WORLD);
    run(env, 60, () => new Array(NUM_JOINTS).fill(0));
    expect(env.fallen).toBe(false);
    const y = env.torso.translation().y;
    expect(y).toBeGreaterThan(START_HEIGHT - 0.06);
    expect(y).toBeLessThan(START_HEIGHT + 0.01);
    const obs = env.observe();
    expect(obs.length).toBe(OBS_SIZE);
    expect(obs[3]).toBeLessThan(-0.98); // gravité vue du tronc ≈ (0, −1, 0)
    env.free();
  });

  it('un pas est déterministe', () => {
    const act = (t: number) => Array.from({ length: NUM_JOINTS }, (_, j) => Math.sin(0.1 * t + j));
    const a = new QuadrupedEnv(DEFAULT_WORLD);
    const b = new QuadrupedEnv(DEFAULT_WORLD);
    run(a, 1, act);
    run(b, 1, act);
    expect(a.torso.translation()).toEqual(b.torso.translation());
    run(a, 90, act);
    run(b, 90, act);
    expect(a.torso.translation()).toEqual(b.torso.translation());
    expect(Array.from(a.angles)).toEqual(Array.from(b.angles));
    a.free();
    b.free();
  });

  it('les moteurs suivent leur consigne d’angle', () => {
    const env = new QuadrupedEnv(DEFAULT_WORLD);
    const act = new Array(NUM_JOINTS).fill(0);
    act[kneeIndex(1)] = 0.5; // genou avant droit
    run(env, 60, () => act);
    expect(env.angles[kneeIndex(1)]).toBeGreaterThan(0.35);
    expect(env.angles[kneeIndex(1)]).toBeLessThan(0.7);
    env.free();
  });

  it('un genou bloqué ne tourne pas, les autres oui', () => {
    const env = new QuadrupedEnv({ ...DEFAULT_WORLD, lockedRearRightKnee: true });
    run(env, 90, (t) => new Array(NUM_JOINTS).fill(Math.sin(t * 0.15)));
    let maxLocked = 0;
    let maxFree = 0;
    run(env, 60, (t) => {
      maxLocked = Math.max(maxLocked, Math.abs(env.angles[kneeIndex(3)]));
      maxFree = Math.max(maxFree, Math.abs(env.angles[kneeIndex(2)]));
      return new Array(NUM_JOINTS).fill(Math.sin(t * 0.15));
    });
    expect(maxLocked).toBeLessThan(0.1); // liaison rigide (à la souplesse du solveur près)
    expect(maxFree).toBeGreaterThan(0.4);
    expect(env.isActuated(kneeIndex(3))).toBe(false);
    env.free();
  });

  it('la patte cassée n’a plus de tibia ni de genou', () => {
    const env = new QuadrupedEnv({ ...DEFAULT_WORLD, brokenFrontLeft: true });
    expect(env.lower[0]).toBeNull();
    expect(env.isActuated(kneeIndex(0))).toBe(false);
    expect(env.poses().lower[0]).toBeNull();
    env.free();
  });

  it('les interventions modifient bien le monde', () => {
    for (const iv of INTERVENTIONS) {
      const w = { ...DEFAULT_WORLD };
      expect(iv.get(w)).toBe(false);
      iv.set(w, true);
      expect(iv.get(w)).toBe(true);
      iv.set(w, false);
      expect(w).toEqual(DEFAULT_WORLD);
    }
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(2);
  });
});

describe('note et apprentissage', () => {
  it('formule de la note', () => {
    const r = { energyWeight: 0.01, stabilityWeight: 2, fallPenalty: 3 };
    expect(fitnessOf(2, 100, 0.1, false, r)).toBeCloseTo(2 - 1 - 0.2, 12);
    expect(fitnessOf(2, 100, 0.1, true, r)).toBeCloseTo(2 - 1 - 0.2 - 3, 12);
    const s = defaultSettings();
    s.priority = 0;
    expect(rewardOf(s).energyWeight).toBe(0);
    s.priority = 4;
    expect(rewardOf(s).energyWeight).toBeGreaterThan(DEFAULT_REWARD.energyWeight);
  });

  it('le cerveau pré-entraîné avance et refait exactement son essai', () => {
    const b = load('healthy');
    expect(b.sizes).toEqual(BRAIN_SIZES);
    expect(b.params.length).toBe(PARAM_COUNT);
    const r = evaluate(b.params, DEFAULT_WORLD, DEFAULT_REWARD);
    expect(r.fell).toBe(false);
    expect(r.distance).toBeGreaterThan(1.5);
    expect(r.distance).toBeCloseTo(b.distance, 2);
  });

  it('chaque intervention fait perdre du terrain au cerveau sain', () => {
    const b = load('healthy');
    const base = evaluate(b.params, DEFAULT_WORLD, DEFAULT_REWARD).distance;
    for (const iv of INTERVENTIONS) {
      const w = { ...DEFAULT_WORLD };
      iv.set(w, true);
      expect(evaluate(b.params, w, DEFAULT_REWARD).distance).toBeLessThan(base * 0.8);
    }
  });

  it('le cerveau sain marche moins bien avec la patte cassée que le cerveau adapté', () => {
    const healthy = load('healthy');
    const broken = load('broken');
    const w = { ...DEFAULT_WORLD, brokenFrontLeft: true };
    const a = evaluate(healthy.params, w, DEFAULT_REWARD);
    const b = evaluate(broken.params, w, DEFAULT_REWARD);
    expect(b.fitness).toBeGreaterThan(a.fitness);
  });

  it('quelques générations améliorent un cerveau aléatoire (déterministe)', () => {
    const init = randomBrain(3);
    const policy = makePolicy(init);
    expect(policy(new Float64Array(OBS_SIZE)).length).toBe(NUM_JOINTS);
    const trainer = new Trainer(init, DEFAULT_WORLD, DEFAULT_REWARD, { popSize: 10, sigma: 0.08, lr: 0.05 }, 11);
    const start = evaluate(init, DEFAULT_WORLD, DEFAULT_REWARD).fitness;
    let best = -Infinity;
    for (let g = 0; g < 8; g++) best = Math.max(best, trainer.generation().fitness);
    expect(trainer.episodes).toBe(8 * 11);
    expect(best).toBeGreaterThan(start + 0.3);
    expect(EPISODE_STEPS).toBe(480);
  }, 20000);
});

describe('chiffres annoncés dans l’interface (Commencez ici, scénarios)', () => {
  const reward = rewardOf(defaultSettings());
  it('cerveau pré-entraîné, robot intact : environ 9 m en 8 s sans chute', () => {
    const r = evaluate(PRETRAINED_HEALTHY.params, DEFAULT_WORLD, reward);
    expect(r.fell).toBe(false);
    expect(r.distance).toBeGreaterThan(8);
    expect(r.distance).toBeLessThan(10);
  });
  it('même cerveau, patte cassée : il boite, environ 1 m', () => {
    const r = evaluate(PRETRAINED_HEALTHY.params, { ...DEFAULT_WORLD, brokenFrontLeft: true }, reward);
    expect(r.distance).toBeLessThan(1.5);
  });
  it('même cerveau, genou bloqué : il tombe presque aussitôt', () => {
    const r = evaluate(PRETRAINED_HEALTHY.params, { ...DEFAULT_WORLD, lockedRearRightKnee: true }, reward);
    expect(r.fell).toBe(true);
    expect(r.distance).toBeLessThan(0.5);
  });
  it('les scénarios « Blessure » et « Genou raide » partent du cerveau du robot intact', () => {
    const injury = SCENARIOS.find((s) => s.id === 'injury')!;
    const knee = SCENARIOS.find((s) => s.id === 'knee')!;
    expect(injury.brain).toBe('healthy');
    expect(injury.world.brokenFrontLeft).toBe(true);
    expect(knee.brain).toBe('healthy');
    expect(knee.world.lockedRearRightKnee).toBe(true);
  });
});
