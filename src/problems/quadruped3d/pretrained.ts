// Cerveaux pré-entraînés hors ligne (scripts/quadruped3d/train.ts), importés tels quels dans le paquet.
import healthyRaw from './pretrained/healthy.json?raw';
import brokenRaw from './pretrained/broken.json?raw';
import { BRAIN_SIZES } from './agent';

export interface PretrainedBrain {
  sizes: number[];
  world: string;
  generation: number;
  distance: number;
  fitness: number;
  params: number[];
}

function parse(raw: string): PretrainedBrain {
  const b = JSON.parse(raw) as PretrainedBrain;
  if (b.sizes.join(',') !== BRAIN_SIZES.join(',')) throw new Error('Cerveau pré-entraîné incompatible avec l’architecture actuelle');
  return b;
}

/** Cerveau entraîné sur le robot intact. */
export const PRETRAINED_HEALTHY = parse(healthyRaw);
/** Cerveau adapté à la patte avant gauche cassée (entraîné à partir du précédent). */
export const PRETRAINED_BROKEN = parse(brokenRaw);
