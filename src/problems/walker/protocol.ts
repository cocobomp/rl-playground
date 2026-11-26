// Messages échangés entre la page et les workers d'entraînement.
import type { EpisodeResult, Objectives, WorldConfig } from './env';
import type { ESSettings } from './agent';

export type ToWorker =
  | {
      type: 'init';
      runId: number;
      /** Numéro de ce worker. */
      index: number;
      seed: number;
      init: number[];
      config: WorldConfig;
      objectives: Objectives;
      es: ESSettings;
    }
  /**
   * Une génération : on transmet d'abord les scores de la précédente (null au début).
   * `active` : nombre de workers qui calculent cette génération (les autres tiennent seulement leur copie à jour).
   * Le worker i < active évalue les candidats j tels que j % active === i : le résultat ne dépend pas de ce nombre.
   */
  | { type: 'gen'; runId: number; fitness: number[] | null; active: number }
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
