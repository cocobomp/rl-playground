// Messages échangés entre la page et le worker d'entraînement.
import type { EsOptions, PolicySpec, ReinforceOptions } from './agent';
import type { WorldParams } from './env';

export type ToWorker =
  | { type: 'reset'; runId: number; algo: 'es' | 'reinforce'; es: EsOptions; rf: ReinforceOptions; world: WorldParams }
  | { type: 'run'; on: boolean }
  | { type: 'world'; world: WorldParams }
  | { type: 'pace'; pace: number }
  | { type: 'hyper'; es?: { popSize?: number; sigma?: number; lr?: number; episodesPerEval?: number }; rf?: { lr?: number; gamma?: number } }
  /** Une génération (ES) ou quelques épisodes (REINFORCE), à la demande. */
  | { type: 'unit'; episodes: number };

export type FromWorker =
  | { type: 'ready'; runId: number; policy: PolicySpec }
  | { type: 'gen'; runId: number; generation: number; mean: number; best: number; champion: PolicySpec; episodes: number }
  | { type: 'episodes'; runId: number; steps: number[]; episode: number; policy: PolicySpec };
