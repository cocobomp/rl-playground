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
  hipIndex,
  initPhysics,
  kneeIndex,
  relativeAngleZ,
  rotate,
  rotateInv,
} from '../src/problems/quadruped3d/env';
import {
  CPG_SIZE,
  PARAM_COUNT,
  RESIDUAL_SCALE,
  Trainer,
  evaluate,
  gaitOf,
  makePolicy,
  randomBrain,
} from '../src/problems/quadruped3d/agent';
import { ENERGY_LEVELS, FIGURES, INTERVENTIONS, SCENARIOS, defaultSettings, describeWorld, fillFigures, rewardOf, workersFor } from '../src/problems/quadruped3d/config';
import { PRETRAINED_BROKEN, PRETRAINED_HEALTHY, PRETRAINED_STORY } from '../src/problems/quadruped3d/pretrained';
import { jointStats } from '../src/problems/quadruped3d/gaitstats';
import { EvalPool, defaultWorkerCount } from '../src/problems/quadruped3d/pool';
import { TrainingLoop } from '../src/problems/quadruped3d/trainloop';
import type { ToWorker } from '../src/problems/quadruped3d/protocol';

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
    expect(obs[3]).toBeLessThan(-0.98);
    env.free();
  });

  it('un pas est déterministe', () => {
    const act = (t: number) => Array.from({ length: NUM_JOINTS }, (_, j) => Math.sin(0.1 * t + j));
    const a = new QuadrupedEnv(DEFAULT_WORLD);
    const b = new QuadrupedEnv(DEFAULT_WORLD);
    run(a, 91, act);
    run(b, 91, act);
    expect(a.torso.translation()).toEqual(b.torso.translation());
    expect(Array.from(a.angles)).toEqual(Array.from(b.angles));
    a.free();
    b.free();
  });

  it('les moteurs suivent leur consigne d’angle', () => {
    const env = new QuadrupedEnv(DEFAULT_WORLD);
    const act = new Array(NUM_JOINTS).fill(0);
    act[kneeIndex(1)] = 0.5;
    run(env, 60, () => act);
    expect(env.angles[kneeIndex(1)]).toBeGreaterThan(0.35);
    expect(env.angles[kneeIndex(1)]).toBeLessThan(0.7);
    env.free();
  });

  it('le rythme interne avance au tempo choisi', () => {
    const env = new QuadrupedEnv(DEFAULT_WORLD);
    env.gaitHz = 2;
    run(env, 15, () => new Array(NUM_JOINTS).fill(0)); // 0,25 s à 2 Hz = un demi-tour… de π
    expect(env.phase).toBeCloseTo(Math.PI, 6);
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
    expect(maxLocked).toBeLessThan(0.1);
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
      expect(describeWorld(w)).toBe(iv.label.toLowerCase());
      iv.set(w, false);
      expect(w).toEqual(DEFAULT_WORLD);
    }
    expect(describeWorld(DEFAULT_WORLD)).toBe('');
  });
});

describe('cerveau à métronomes', () => {
  it('trot : les pattes en diagonale battent ensemble, l’autre diagonale à contretemps', () => {
    const p = new Float64Array(PARAM_COUNT);
    p[1] = 0.05; // amplitude commune de la hanche
    const g = gaitOf(p);
    expect(g.legs.map((l) => l.phase)).toEqual([0, Math.PI, Math.PI, 0]);
    const pol = makePolicy(p);
    const obs = new Float64Array(OBS_SIZE);
    obs[0] = 1; // sin φ = 1 (φ = π/2)
    obs[1] = 0;
    const a = Array.from(pol(obs));
    expect(a[hipIndex(0)]).toBeCloseTo(a[hipIndex(3)], 6);
    expect(a[hipIndex(1)]).toBeCloseTo(a[hipIndex(2)], 6);
    expect(a[hipIndex(0)]).toBeCloseTo(-a[hipIndex(1)], 6);
    expect(a[hipIndex(0)]).toBeGreaterThan(0.2);
  });

  it('la correction du réseau reste bornée', () => {
    const p = randomBrain(4);
    for (let i = CPG_SIZE; i < PARAM_COUNT; i++) p[i] *= 40; // réseau saturé
    const pol = makePolicy(p);
    const obs = new Float64Array(OBS_SIZE).map((_, i) => Math.sin(i));
    pol(obs);
    for (const c of pol.last.correction) expect(Math.abs(c)).toBeLessThanOrEqual(RESIDUAL_SCALE + 1e-12);
    for (const a of pol.last.action) expect(Math.abs(a)).toBeLessThanOrEqual(1);
  });

  it('les réglages du rythme restent dans leurs bornes même poussés à l’extrême', () => {
    const p = new Float64Array(PARAM_COUNT).fill(50);
    const g = gaitOf(p);
    for (const l of g.legs) {
      expect(Math.abs(l.hipBias)).toBeLessThan(0.6);
      expect(Math.abs(l.kneeAmp)).toBeLessThan(0.75);
    }
    expect(g.hz).toBeLessThan(3.4);
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

  it('une génération note d’abord le cerveau actuel puis ses variantes', () => {
    const init = randomBrain(3);
    const trainer = new Trainer(init, DEFAULT_WORLD, DEFAULT_REWARD, { popSize: 6, sigma: 0.06, lr: 0.05 }, 11);
    const r0 = trainer.generation();
    expect(r0.generation).toBe(0);
    expect(r0.distance).toBeCloseTo(evaluate(init, DEFAULT_WORLD, DEFAULT_REWARD).distance, 10);
    const r1 = trainer.generation();
    expect(r1.generation).toBe(1);
    expect(trainer.episodes).toBe(2 * 7);
    expect(EPISODE_STEPS).toBe(480);
  }, 20000);

  it('le résultat ne dépend pas du nombre de workers (évaluation par index)', async () => {
    // Faux workers : évaluent dans le fil principal, avec des délais différents (ordre d'arrivée mélangé).
    const fakeFactory = () => {
      let k = 0;
      const w = {
        onmessage: null as null | ((ev: MessageEvent) => void),
        onerror: null,
        postMessage(m: ToWorker) {
          const delay = (k++ * 7 + m.index * 3) % 5;
          setTimeout(() => w.onmessage?.({ data: { type: 'result', batch: m.batch, index: m.index, result: evaluate(m.params, m.world, m.reward, 90) } } as MessageEvent), delay);
        },
        terminate() {},
      };
      return w as unknown as Worker;
    };
    const runWith = async (n: number) => {
      const pool = new EvalPool(fakeFactory, n);
      const loop = new TrainingLoop(pool);
      loop.reset(randomBrain(5), DEFAULT_WORLD, DEFAULT_REWARD, { popSize: 6, sigma: 0.06, lr: 0.05 }, 3);
      const dists: number[] = [];
      await new Promise<void>((done) => {
        loop.onGeneration = (r) => {
          dists.push(r.distance);
          if (dists.length === 3) {
            loop.stop();
            done();
          }
        };
        loop.start();
      });
      const theta = Array.from(loop.trainer!.brain);
      pool.dispose();
      return { dists, theta };
    };
    const a = await runWith(1);
    const b = await runWith(3);
    expect(b.dists).toEqual(a.dists);
    expect(b.theta).toEqual(a.theta);
  }, 30000);

  it('nombre de workers selon l’appareil et la vitesse choisie', () => {
    expect(defaultWorkerCount(4)).toBe(3);
    expect(defaultWorkerCount(1)).toBe(1);
    expect(defaultWorkerCount(32)).toBe(6);
    expect(defaultWorkerCount(undefined)).toBe(1);
    expect(workersFor('normal', 3)).toBe(1);
    expect(workersFor('fast', 3)).toBe(3);
    expect(workersFor('turbo', 3)).toBe(4);
    expect(workersFor('turbo', 6)).toBe(6);
  });
});

describe('cerveaux pré-entraînés', () => {
  it('le cerveau pré-entraîné avance et refait exactement son essai', () => {
    const b = PRETRAINED_HEALTHY;
    expect(b.params.length).toBe(PARAM_COUNT);
    const r = evaluate(b.params, DEFAULT_WORLD, DEFAULT_REWARD);
    expect(r.fell).toBe(false);
    expect(r.distance).toBeCloseTo(b.distance, 2);
  });

  it('les 4 hanches ET les 4 genoux bougent nettement ; l’arrière au moins moitié autant que l’avant', () => {
    const st = jointStats(PRETRAINED_HEALTHY.params, DEFAULT_WORLD);
    const hips = [0, 1, 2, 3].map((l) => st.std[hipIndex(l)]);
    const knees = [0, 1, 2, 3].map((l) => st.std[kneeIndex(l)]);
    for (const v of [...hips, ...knees]) expect(v).toBeGreaterThan(0.05);
    const front = (a: number[]) => (a[0] + a[1]) / 2;
    const hind = (a: number[]) => (a[2] + a[3]) / 2;
    expect(hind(hips)).toBeGreaterThanOrEqual(0.5 * front(hips));
    expect(hind(knees)).toBeGreaterThanOrEqual(0.5 * front(knees));
    // Chaque patte arrière, prise seule, bouge au moins un tiers autant que l'avant en moyenne.
    expect(Math.min(hips[2], hips[3])).toBeGreaterThanOrEqual(0.33 * front(hips));
    expect(Math.min(knees[2], knees[3])).toBeGreaterThanOrEqual(0.33 * front(knees));
  });

  it('chaque intervention fait perdre du terrain au cerveau sain', () => {
    const base = evaluate(PRETRAINED_HEALTHY.params, DEFAULT_WORLD, DEFAULT_REWARD).distance;
    for (const iv of INTERVENTIONS) {
      const w = { ...DEFAULT_WORLD };
      iv.set(w, true);
      const d = evaluate(PRETRAINED_HEALTHY.params, w, DEFAULT_REWARD).distance;
      // Corps lourd et moteurs faibles freinent (−15 % au moins) ; les autres cassent la démarche.
      expect(d).toBeLessThan(iv.id === 'heavy' || iv.id === 'weak' ? base * 0.85 : base * 0.3);
    }
  });

  it('le cerveau adapté à la patte cassée fait mieux que le cerveau sain sur 3 pattes', () => {
    const w = { ...DEFAULT_WORLD, brokenFrontLeft: true };
    const a = evaluate(PRETRAINED_HEALTHY.params, w, DEFAULT_REWARD);
    const b = evaluate(PRETRAINED_BROKEN.params, w, DEFAULT_REWARD);
    expect(b.fitness).toBeGreaterThan(a.fitness);
    expect(b.distance).toBeGreaterThan(a.distance + 1);
  });

  it('l’histoire hors ligne va du début à la fin, chaque moment rejoue sa distance', () => {
    expect(PRETRAINED_STORY.length).toBeGreaterThanOrEqual(4);
    expect(PRETRAINED_STORY[0].generation).toBe(0);
    for (let i = 1; i < PRETRAINED_STORY.length; i++) expect(PRETRAINED_STORY[i].generation).toBeGreaterThan(PRETRAINED_STORY[i - 1].generation);
    const last = PRETRAINED_STORY[PRETRAINED_STORY.length - 1];
    expect(last.distance).toBeGreaterThan(PRETRAINED_STORY[0].distance + 3);
    for (const m of PRETRAINED_STORY) expect(evaluate(m.params, DEFAULT_WORLD, DEFAULT_REWARD).distance).toBeCloseTo(m.distance, 2);
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

describe('chiffres annoncés dans l’interface', () => {
  const reward = rewardOf(defaultSettings());
  it('robot intact : environ 22 m en 8 s, sans chute', () => {
    expect(FIGURES.healthy).toBe('22 m');
    const r = evaluate(PRETRAINED_HEALTHY.params, DEFAULT_WORLD, reward);
    expect(r.fell).toBe(false);
    expect(Math.round(r.distance)).toBe(22);
  });
  it('même cerveau, patte cassée : 2,8 m puis il tombe', () => {
    const r = evaluate(PRETRAINED_HEALTHY.params, { ...DEFAULT_WORLD, brokenFrontLeft: true }, reward);
    expect(r.fell).toBe(true);
    expect(r.distance.toFixed(1)).toBe('2.8');
  });
  it('même cerveau, genou bloqué : 5,6 m avant de tomber', () => {
    const r = evaluate(PRETRAINED_HEALTHY.params, { ...DEFAULT_WORLD, lockedRearRightKnee: true }, reward);
    expect(r.fell).toBe(true);
    expect(r.distance.toFixed(1)).toBe('5.6');
  });
  it('cerveau adapté hors ligne à la patte cassée : dans la fourchette annoncée (5 à 10 m) ou mieux', () => {
    const r = evaluate(PRETRAINED_BROKEN.params, { ...DEFAULT_WORLD, brokenFrontLeft: true }, reward);
    expect(r.fell).toBe(false);
    expect(r.distance).toBeGreaterThan(5);
  });
  it('tous les {{…}} des scénarios sont remplacés', () => {
    for (const sc of SCENARIOS) expect(fillFigures(sc.description)).not.toMatch(/\{\{|\? m/);
  });
  it('« très économe » : marcher comme le cerveau livré rapporte plus que rester immobile', () => {
    const s = defaultSettings();
    s.priority = ENERGY_LEVELS.length - 1;
    const r = rewardOf(s);
    const walk = evaluate(PRETRAINED_HEALTHY.params, DEFAULT_WORLD, r);
    expect(walk.fitness).toBeGreaterThan(2);
  });
});

describe('textes des interventions', () => {
  it('corps lourd ≈ 16 m, moteurs affaiblis ≈ 18 m', () => {
    const heavy = INTERVENTIONS.find((i) => i.id === 'heavy')!;
    const weak = INTERVENTIONS.find((i) => i.id === 'weak')!;
    const d = (iv: typeof heavy) => {
      const w = { ...DEFAULT_WORLD };
      iv.set(w, true);
      return Math.round(evaluate(PRETRAINED_HEALTHY.params, w, rewardOf(defaultSettings())).distance);
    };
    expect(heavy.help).toContain(`${d(heavy)} m`);
    expect(weak.help).toContain(`${d(weak)} m`);
  });
});

describe('scénario « Partir de zéro » (tirage fixé, annoncé dans le texte)', () => {
  it('une vraie démarche (près de 8 m) dès la génération 13', () => {
    const sc = SCENARIOS.find((s) => s.id === 'scratch')!;
    const reward = rewardOf(defaultSettings());
    const t = new Trainer(randomBrain(sc.seeds!.brain), DEFAULT_WORLD, reward, defaultSettings().hyper, sc.seeds!.trainer);
    let r = t.generation();
    expect(r.distance).toBeLessThan(1);
    let at13 = 0;
    for (let g = 1; g <= 30; g++) {
      r = t.generation();
      if (g === 13) at13 = r.distance;
    }
    expect(at13).toBeGreaterThan(7);
    expect(r.generation).toBe(30);
    expect(r.distance).toBeGreaterThan(7);
  }, 60000);
});

