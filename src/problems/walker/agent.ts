// Cerveau du robot (MLP partagé) et boucle d'entraînement par stratégie d'évolution.
// Aucun accès au DOM : utilisé par le worker, les tests et le script hors ligne.
import { EvolutionStrategy, MLP } from '../../shared/nn';
import { mulberry32 } from '../../shared/rng';
import { DT, EpisodeResult, NET_SIZES, Objectives, Policy, WorldConfig, runEpisode } from './env';

export interface BrainJSON {
  sizes: number[];
  outputActivation?: 'tanh' | 'linear';
  params: number[];
}

/** Politique à partir de paramètres bruts (même rangement que MLP). */
export function policyFromParams(params: ArrayLike<number>): Policy & { net: MLP } {
  const net = new MLP(NET_SIZES, 'tanh', params);
  return { net, act: (o) => net.forward(o) };
}

export function policyFromJSON(b: BrainJSON): Policy & { net: MLP } {
  const net = MLP.fromJSON(b);
  return { net, act: (o) => net.forward(o) };
}

/** Évalue un vecteur de paramètres sur un épisode (déterministe). */
export function evaluate(params: ArrayLike<number>, config: WorldConfig, objectives: Objectives): EpisodeResult {
  return runEpisode(policyFromParams(params), config, objectives);
}

/** Paramètres initiaux aléatoires (petite échelle : le robot commence presque immobile). */
export function randomParams(seed: number, scale = 0.5): Float64Array {
  return new MLP(NET_SIZES).randomize(mulberry32(seed), scale).params;
}

export interface ESSettings {
  popSize: number;
  sigma: number;
  lr: number;
}

// Réglages mesurés avec scripts/walker/bench.ts : depuis un cerveau au hasard, un essai sans chute à plus de 10 m
// arrive en ~45 générations et ~0,5 M pas de simulation, contre ~134 générations et ~2,1 M pas avec l'ancien réglage (32, 0,08, 0,03).
export const DEFAULT_ES: ESSettings = { popSize: 24, sigma: 0.1, lr: 0.05 };

export function makeES(init: ArrayLike<number>, es: ESSettings, seed: number): EvolutionStrategy {
  return new EvolutionStrategy({
    dim: init.length,
    init,
    popSize: es.popSize,
    sigma: es.sigma,
    lr: es.lr,
    weightDecay: 0.001,
    rng: mulberry32(seed),
  });
}

export interface GenerationReport {
  generation: number;
  best: EpisodeResult;
  mean: number;
  /** Distance moyenne des variantes testées. */
  meanDistance: number;
  /** Pas de simulation calculés pour la population (mesure du coût). */
  steps: number;
  /** Résultat du cerveau « moyen » θ (celui que l'ES fait évoluer). */
  theta: EpisodeResult;
  bestParams: Float64Array;
}

/** Une génération complète en série (tests et script hors ligne). */
export function runGeneration(es: EvolutionStrategy, config: WorldConfig, objectives: Objectives): GenerationReport {
  const cands = es.ask();
  const results = cands.map((p) => evaluate(p, config, objectives));
  let bi = 0;
  results.forEach((r, i) => {
    if (r.fitness > results[bi].fitness) bi = i;
  });
  const bestParams = Float64Array.from(cands[bi]);
  es.tell(results.map((r) => r.fitness));
  const theta = evaluate(es.theta, config, objectives);
  const meanDistance = results.reduce((a, r) => a + r.distance, 0) / results.length;
  const steps = results.reduce((a, r) => a + Math.round(r.time / DT), 0);
  return { generation: es.generation, best: results[bi], mean: es.lastMean, meanDistance, steps, theta, bestParams };
}

/**
 * Part de la population évaluée par le worker n° index quand `active` workers calculent :
 * les candidats j tels que j % active === index. Chaque résultat ne dépend que du candidat (évaluation par indice),
 * donc l'ensemble des scores est le même quel que soit le nombre de workers.
 */
export function evaluateShare(
  cands: ArrayLike<number>[],
  index: number,
  active: number,
  config: WorldConfig,
  objectives: Objectives,
): { i: number; r: EpisodeResult }[] {
  const out: { i: number; r: EpisodeResult }[] = [];
  const count = Math.max(1, active);
  if (index >= count) return out;
  for (let i = index; i < cands.length; i += count) out.push({ i, r: evaluate(cands[i], config, objectives) });
  return out;
}
