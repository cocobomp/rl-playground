// Le « cerveau » du robot et son entraînement par stratégie d'évolution.
// Sans DOM : utilisé par le worker, la page (rejeu), le script hors ligne et les tests.
import { EvolutionStrategy, MLP } from '../../shared/nn';
import { mulberry32 } from '../../shared/rng';
import { EpisodeResult, NUM_JOINTS, OBS_SIZE, Policy, RewardParams, WorldParams, runEpisode } from './env';

/** Architecture : entrées → 24 neurones cachés (tanh) → 8 consignes (tanh, donc dans [-1, 1]). */
export const HIDDEN = 24;
export const BRAIN_SIZES = [OBS_SIZE, HIDDEN, NUM_JOINTS];
export const PARAM_COUNT = MLP.paramCount(BRAIN_SIZES);

export interface BrainJSON {
  sizes: number[];
  params: number[];
}

/** Crée la politique associée à un vecteur de paramètres. */
export function makePolicy(params: ArrayLike<number>): Policy {
  const net = new MLP(BRAIN_SIZES, 'tanh', params);
  return (obs) => net.forward(obs);
}

/** Cerveau initial : petits poids aléatoires (le robot reste presque immobile). */
export function randomBrain(seed: number): Float64Array {
  return new MLP(BRAIN_SIZES, 'tanh').randomize(mulberry32(seed), 0.5).params;
}

export function evaluate(params: ArrayLike<number>, world: WorldParams, reward: RewardParams, steps?: number): EpisodeResult {
  return runEpisode(makePolicy(params), world, reward, steps);
}

export interface EsHyper {
  popSize: number;
  sigma: number;
  lr: number;
}

export const DEFAULT_HYPER: EsHyper = { popSize: 24, sigma: 0.06, lr: 0.03 };

export interface GenerationReport {
  generation: number;
  /** Note du cerveau courant (θ, sans bruit). */
  fitness: number;
  distance: number;
  energy: number;
  fell: boolean;
  /** Meilleure et moyenne des notes de la population. */
  popBest: number;
  popMean: number;
  episodes: number;
}

/**
 * Entraîneur : à chaque génération, essaie popSize variantes bruitées du cerveau,
 * déplace le cerveau vers les meilleures, puis note le nouveau cerveau.
 * L'évaluation des candidats peut être confiée à une fonction externe (parallélisme hors ligne).
 */
export class Trainer {
  es: EvolutionStrategy;
  world: WorldParams;
  reward: RewardParams;
  episodes = 0;
  constructor(init: ArrayLike<number>, world: WorldParams, reward: RewardParams, hyper: EsHyper, seed: number) {
    this.world = { ...world };
    this.reward = { ...reward };
    this.es = new EvolutionStrategy({
      dim: PARAM_COUNT,
      popSize: hyper.popSize,
      sigma: hyper.sigma,
      lr: hyper.lr,
      weightDecay: 0.002,
      rng: mulberry32(seed),
      init,
    });
  }

  setHyper(h: Partial<EsHyper>): void {
    if (h.popSize !== undefined) this.es.popSize = Math.max(2, h.popSize & ~1);
    if (h.sigma !== undefined) this.es.sigma = h.sigma;
    if (h.lr !== undefined) this.es.lr = h.lr;
  }

  get brain(): Float64Array {
    return this.es.theta;
  }

  /** Une génération complète (évaluations dans ce fil). */
  generation(): GenerationReport {
    const cands = this.es.ask();
    const scores = cands.map((c) => evaluate(c, this.world, this.reward).fitness);
    return this.finish(scores);
  }

  /** Termine une génération dont les notes ont été calculées ailleurs. */
  finish(scores: number[]): GenerationReport {
    this.es.tell(scores);
    this.episodes += scores.length + 1;
    const r = evaluate(this.es.theta, this.world, this.reward);
    return {
      generation: this.es.generation,
      fitness: r.fitness,
      distance: r.distance,
      energy: r.energy,
      fell: r.fell,
      popBest: this.es.lastBest,
      popMean: this.es.lastMean,
      episodes: this.episodes,
    };
  }
}
