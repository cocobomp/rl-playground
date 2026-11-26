// Mesure de la démarche d'un cerveau : amplitude de chaque articulation pendant un essai (sans DOM).
import { EPISODE_STEPS, NUM_JOINTS, OBS_SIZE, WorldParams, newEnvFor } from './env';
import { makePolicy } from './agent';

export interface JointStats {
  /** Écart type de l'angle (rad) après la première seconde. */
  std: number[];
  /** Max − min de l'angle (rad). */
  range: number[];
  distance: number;
  fell: boolean;
}

export function jointStats(params: ArrayLike<number>, world: WorldParams, steps = EPISODE_STEPS, skip = 60): JointStats {
  const policy = makePolicy(params);
  const env = newEnvFor(policy, world);
  const obs = new Float64Array(OBS_SIZE);
  const lo = new Array(NUM_JOINTS).fill(Infinity);
  const hi = new Array(NUM_JOINTS).fill(-Infinity);
  const s = new Array(NUM_JOINTS).fill(0);
  const s2 = new Array(NUM_JOINTS).fill(0);
  let n = 0;
  try {
    while (env.steps < steps && !env.fallen) {
      env.observe(obs);
      env.step(policy(obs));
      if (env.steps <= skip) continue;
      n++;
      for (let j = 0; j < NUM_JOINTS; j++) {
        const a = env.angles[j];
        lo[j] = Math.min(lo[j], a);
        hi[j] = Math.max(hi[j], a);
        s[j] += a;
        s2[j] += a * a;
      }
    }
    const std = s.map((v, j) => (n ? Math.sqrt(Math.max(0, s2[j] / n - (v / n) ** 2)) : 0));
    const range = hi.map((v, j) => (n ? v - lo[j] : 0));
    return { std, range, distance: env.distance, fell: env.fallen };
  } finally {
    env.free();
  }
}
