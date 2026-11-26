// Messages échangés entre la page et les workers d'entraînement.
import type { EpisodeResult, Objectives, WorldConfig } from './env';
import type { ESSettings } from './agent';

export type ToWorker =
  | {
      type: 'init';
      runId: number;
      /** Numéro de ce worker et nombre total : chacun évalue les candidats i tels que i % count === index. */
      index: number;
      count: number;
      seed: number;
      init: number[];
      config: WorldConfig;
      objectives: Objectives;
      es: ESSettings;
    }
  /** Une génération : on transmet d'abord les scores de la précédente (null au début). */
  | { type: 'gen'; runId: number; fitness: number[] | null }
  | { type: 'objectives'; objectives: Objectives }
  | { type: 'hyper'; es: ESSettings };

export interface Scored {
  /** Indice du candidat dans la population. */
  i: number;
  r: EpisodeResult;
}

export type FromWorker = {
  type: 'scores';
  runId: number;
  generation: number;
  index: number;
  scored: Scored[];
  /** Paramètres du meilleur candidat évalué par ce worker. */
  bestI: number;
  bestParams: number[];
  /** Worker 0 seulement : le cerveau courant θ (avant variations) et son résultat. */
  theta?: { r: EpisodeResult; params: number[] };
  ms: number;
};
