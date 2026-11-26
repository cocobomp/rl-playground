import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OBJECTIVES,
  HEALTHY,
  KNEE_LIMITS,
  LOCKED_KNEE_ANGLE,
  MAX_STEPS,
  NET_SIZES,
  OBS_SIZE,
  SHIN_LEN,
  SHORT_FACTOR,
  Walker,
  WEAK_FACTOR,
  fitnessOf,
  runEpisode,
} from '../src/problems/walker/env';
import { BrainJSON, evaluate, makeES, policyFromJSON, randomParams, runGeneration } from '../src/problems/walker/agent';
import { MLP } from '../src/shared/nn';
import healthy from '../src/problems/walker/pretrained/healthy.json';
import injured from '../src/problems/walker/pretrained/injured.json';

const KNEE_LOCKED = { ...HEALTHY, lockLeftKnee: true };

describe('environnement du marcheur', () => {
  it('se construit : 4 articulations, observation de taille fixe, debout au départ', () => {
    const w = new Walker();
    expect(w.joints).toHaveLength(4);
    const o = w.observe();
    expect(o).toHaveLength(OBS_SIZE);
    expect(Array.from(o).every(Number.isFinite)).toBe(true);
    expect(w.hull.getPosition().y).toBeGreaterThan(1);
    expect(w.distance).toBe(0);
    expect(MLP.paramCount(NET_SIZES)).toBe(356);
  });

  it('un pas est déterministe : mêmes actions ⇒ même état, au bit près', () => {
    const run = () => {
      const w = new Walker(HEALTHY);
      for (let t = 0; t < 120; t++) w.step([Math.sin(t / 7), -0.5, Math.cos(t / 9), 0.3]);
      return { pose: w.pose(), energy: w.energy };
    };
    expect(run()).toEqual(run());
  });

  it('la gravité agit : sans moteurs utiles, le robot finit par tomber', () => {
    const w = new Walker(HEALTHY);
    while (!w.done) w.step([0, -1, 0, -1]); // genoux pliés au maximum
    expect(w.fell).toBe(true);
    expect(w.steps).toBeLessThan(MAX_STEPS);
  });

  it('le genou bloqué ne tourne pas, même quand on lui ordonne de plier', () => {
    const w = new Walker(KNEE_LOCKED);
    const free = new Walker(HEALTHY);
    let maxDev = 0;
    for (let t = 0; t < 60; t++) {
      w.step([0, -1, 0, -1]);
      free.step([0, -1, 0, -1]);
      maxDev = Math.max(maxDev, Math.abs(w.joints[1].getJointAngle() - LOCKED_KNEE_ANGLE));
    }
    expect(maxDev).toBeLessThan(0.02);
    expect(w.joints[1].isMotorEnabled()).toBe(false);
    // le genou droit et le genou d'un robot intact, eux, plient
    expect(w.joints[3].getJointAngle()).toBeLessThan(-1);
    expect(free.joints[1].getJointAngle()).toBeLessThan(KNEE_LIMITS[0] + 0.3);
  });

  it('les autres interventions modifient bien le corps et le monde', () => {
    const base = new Walker(HEALTHY);
    const weak = new Walker({ ...HEALTHY, weakRightLeg: true });
    expect(weak.joints[2].getMaxMotorTorque()).toBeCloseTo(base.joints[2].getMaxMotorTorque() * WEAK_FACTOR);
    expect(weak.joints[0].getMaxMotorTorque()).toBeCloseTo(base.joints[0].getMaxMotorTorque());
    const short = new Walker({ ...HEALTHY, shortLeftLeg: true });
    expect(short.shinLength(0)).toBeCloseTo(SHIN_LEN * SHORT_FACTOR);
    expect(short.shinLength(1)).toBeCloseTo(SHIN_LEN);
    const heavy = new Walker({ ...HEALTHY, heavyBackpack: true });
    expect(heavy.hull.getMass()).toBeCloseTo(base.hull.getMass() * 2);
    const slope = new Walker({ ...HEALTHY, slope: true });
    expect(slope.groundY(10)).toBeGreaterThan(1);
  });

  it('le score combine distance, énergie, chute et inclinaison', () => {
    const o = { speed: 2, energy: 0.1, fall: 5, upright: 1 };
    expect(fitnessOf({ distance: 3, energy: 1000, fell: false, tilt: 0.2 }, o)).toBeCloseTo(6 - 1 - 0 - 0.2);
    expect(fitnessOf({ distance: 3, energy: 1000, fell: true, tilt: 0.2 }, o)).toBeCloseTo(6 - 1 - 5 - 0.2);
  });
});

describe('cerveaux pré-entraînés', () => {
  const healthyBrain = policyFromJSON(healthy as BrainJSON);
  const injuredBrain = policyFromJSON(injured as BrainJSON);
  const sane = runEpisode(healthyBrain, HEALTHY, DEFAULT_OBJECTIVES);
  const saneHurt = runEpisode(healthyBrain, KNEE_LOCKED, DEFAULT_OBJECTIVES);
  const adapted = runEpisode(injuredBrain, KNEE_LOCKED, DEFAULT_OBJECTIVES);

  it('le cerveau sain fait marcher le robot intact sur plus de 10 m en 10 s, sans tomber', () => {
    expect(sane.fell).toBe(false);
    expect(sane.distance).toBeGreaterThan(10);
  });

  it('avec le genou bloqué, le cerveau adapté fait mieux que le cerveau sain', () => {
    expect(adapted.distance).toBeGreaterThan(saneHurt.distance + 2);
    expect(adapted.fitness).toBeGreaterThan(saneHurt.fitness);
  });

  it('le cerveau adapté s’est spécialisé : sur le robot intact, il fait moins bien que le cerveau sain', () => {
    const adaptedOnSane = runEpisode(injuredBrain, HEALTHY, DEFAULT_OBJECTIVES);
    expect(adaptedOnSane.distance).toBeLessThan(sane.distance);
  });

  it('les fichiers restent légers', () => {
    expect(JSON.stringify(healthy).length).toBeLessThan(200_000);
    expect(JSON.stringify(injured).length).toBeLessThan(200_000);
  });
});

describe('stratégie d’évolution', () => {
  it('deux copies avec la même graine proposent les mêmes variantes (répartition entre workers)', () => {
    const init = randomParams(3);
    const a = makeES(init, { popSize: 8, sigma: 0.1, lr: 0.03 }, 42).ask();
    const b = makeES(init, { popSize: 8, sigma: 0.1, lr: 0.03 }, 42).ask();
    expect(a.map((x) => Array.from(x))).toEqual(b.map((x) => Array.from(x)));
  });

  it('apprend : en quelques générations, le cerveau au hasard progresse nettement', () => {
    const init = randomParams(7);
    const start = evaluate(init, HEALTHY, DEFAULT_OBJECTIVES);
    const es = makeES(init, { popSize: 16, sigma: 0.08, lr: 0.05 }, 2024);
    let best = -Infinity;
    for (let g = 0; g < 20; g++) {
      const rep = runGeneration(es, HEALTHY, DEFAULT_OBJECTIVES);
      best = Math.max(best, rep.best.fitness, rep.theta.fitness);
    }
    expect(best).toBeGreaterThan(start.fitness + 5);
  }, 20_000);
});
