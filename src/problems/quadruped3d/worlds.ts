// Interventions sur le monde ou le corps du robot (sans DOM).
import type { WorldParams } from './env';

/** Valeurs appliquées par chaque intervention quand elle est activée. */
export const SLIPPERY_FRICTION = 0.15;
export const HEAVY_MASS = 2;
export const WEAK_STRENGTH = 0.45;

export const WORLD_PRESETS: Record<string, Partial<WorldParams>> = {
  healthy: {},
  broken: { brokenFrontLeft: true },
  locked: { lockedRearRightKnee: true },
  heavy: { bodyMass: HEAVY_MASS },
  slippery: { friction: SLIPPERY_FRICTION },
  weak: { motorStrength: WEAK_STRENGTH },
};
