// Messages échangés entre la page et les workers d'évaluation.
import type { EpisodeResult, RewardParams, WorldParams } from './env';

export type ToWorker = {
  type: 'eval';
  batch: number;
  index: number;
  params: Float64Array;
  world: WorldParams;
  reward: RewardParams;
};

export type FromWorker =
  | { type: 'ready' }
  | { type: 'result'; batch: number; index: number; result: EpisodeResult }
  | { type: 'error'; message: string };
