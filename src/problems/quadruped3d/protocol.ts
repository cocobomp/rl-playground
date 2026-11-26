// Messages échangés entre la page et le worker d'entraînement.
import type { EsHyper, GenerationReport } from './agent';
import type { RewardParams, WorldParams } from './env';

export type ToWorker =
  | { type: 'reset'; runId: number; brain: number[]; world: WorldParams; reward: RewardParams; hyper: EsHyper; seed: number }
  | { type: 'run'; on: boolean }
  | { type: 'world'; world: WorldParams }
  | { type: 'reward'; reward: RewardParams }
  | { type: 'hyper'; hyper: Partial<EsHyper> };

export type FromWorker =
  | { type: 'ready'; runId: number }
  | { type: 'gen'; runId: number; report: GenerationReport; brain: number[] }
  | { type: 'error'; message: string };
