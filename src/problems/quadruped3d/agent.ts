// Le « cerveau » du robot et son entraînement par stratégie d'évolution.
// Sans DOM : utilisé par les workers, la page (rejeu), le script hors ligne et les tests.
//
// Cerveau = générateur de rythme (un « métronome » par patte, décalés comme un trot)
//         + petit réseau de neurones correcteur (équilibre, direction), borné à ±RESIDUAL_SCALE.
// Tous les nombres réglables sont rangés dans un seul vecteur θ, optimisé par la stratégie d'évolution.
import { EvolutionStrategy, MLP } from '../../shared/nn';
import { mulberry32, randn } from '../../shared/rng';
import { EpisodeResult, GAIT_HZ, NUM_JOINTS, NUM_LEGS, OBS_SIZE, Policy, RewardParams, WorldParams, runEpisode } from './env';

/**
 * Bloc « rythme » de θ (nombres bruts, multipliés par un gain pour que le bruit d'exploration σ
 * corresponde à des changements visibles) :
 *  - 5 réglages communs aux 4 pattes (biais et amplitude de la hanche, biais et amplitude du genou, retard du genou),
 *  - 1 tempo,
 *  - pour chaque patte, 6 écarts propres (les 5 mêmes réglages + son décalage de phase).
 * Les réglages communs font apprendre vite une démarche cohérente ; les écarts propres permettent
 * à une patte de faire autrement (blessure, genou raide…).
 */
export const SHARED_PARAMS = 5;
export const LEG_PARAMS = 6;
export const TEMPO_INDEX = SHARED_PARAMS;
export const LEG_START = SHARED_PARAMS + 1;
export const CPG_SIZE = LEG_START + NUM_LEGS * LEG_PARAMS;
/** Gains des nombres bruts du rythme. */
export const SHARED_GAIN = 6;
export const LEG_GAIN = 1.5;
/** Réseau correcteur : entrées → 8 neurones cachés (tanh) → 8 corrections. */
export const HIDDEN = 8;
export const BRAIN_SIZES = [OBS_SIZE, HIDDEN, NUM_JOINTS];
export const RESIDUAL_COUNT = MLP.paramCount(BRAIN_SIZES);
export const PARAM_COUNT = CPG_SIZE + RESIDUAL_COUNT;
/** Amplitude maximale des corrections du réseau (en fraction du débattement). */
export const RESIDUAL_SCALE = 0.3;
/** Décalage de base des métronomes (trot) : avant gauche et arrière droite ensemble, l'autre diagonale à π. */
export const TROT_OFFSETS = [0, Math.PI, Math.PI, 0];
/** Retard de base du genou sur la hanche (π/2 : le genou plie quand la patte revient vers l'avant). */
export const KNEE_LAG = Math.PI / 2;
/** Plage du tempo : GAIT_HZ × e^(±TEMPO_RANGE), soit environ 1,5 à 3,3 Hz. */
export const TEMPO_RANGE = 0.4;

export interface BrainJSON {
  sizes: number[];
  params: number[];
}

/** Réglages lisibles d'une patte (consignes en fraction du débattement, angles en radians). */
export interface LegGait {
  hipBias: number;
  hipAmp: number;
  kneeBias: number;
  kneeAmp: number;
  kneeLag: number;
  phase: number;
}

/**
 * Bornes douces des réglages (fraction du débattement) : L·tanh(x/L) ≈ x pour les petites valeurs.
 * Sans elles, l'évolution pousse parfois les biais au-delà des butées : le robot se fige replié et
 * plus aucune variante ne change rien (plus de progrès possible).
 */
export const LIMITS = { hipBias: 0.55, hipAmp: 0.7, kneeBias: 0.75, kneeAmp: 0.7 };
const soft = (x: number, l: number) => l * Math.tanh(x / l);

/** Lecture des réglages du générateur de rythme contenus dans θ. */
export function gaitOf(params: ArrayLike<number>): { hz: number; legs: LegGait[] } {
  const legs: LegGait[] = [];
  const sh = (k: number) => SHARED_GAIN * params[k];
  for (let i = 0; i < NUM_LEGS; i++) {
    const k = LEG_START + i * LEG_PARAMS;
    const d = (m: number) => LEG_GAIN * params[k + m];
    legs.push({
      hipBias: soft(sh(0) + d(0), LIMITS.hipBias),
      hipAmp: soft(sh(1) + d(1), LIMITS.hipAmp),
      kneeBias: soft(sh(2) + d(2), LIMITS.kneeBias),
      kneeAmp: soft(sh(3) + d(3), LIMITS.kneeAmp),
      kneeLag: KNEE_LAG + sh(4) + d(4),
      phase: TROT_OFFSETS[i] + d(5),
    });
  }
  return { hz: GAIT_HZ * Math.exp(TEMPO_RANGE * Math.tanh(2 * params[TEMPO_INDEX])), legs };
}

/** Ce que le cerveau produit à un instant : part du rythme, part de la correction, consigne finale. */
export interface BrainOutput {
  rhythm: Float64Array;
  correction: Float64Array;
  action: Float64Array;
}

export type BrainPolicy = Policy & { gaitHz: number; last: BrainOutput };

/** Crée la politique associée à un vecteur de paramètres. */
export function makePolicy(params: ArrayLike<number>): BrainPolicy {
  const { hz, legs } = gaitOf(params);
  const net = new MLP(BRAIN_SIZES, 'tanh', Array.prototype.slice.call(params, CPG_SIZE, PARAM_COUNT));
  const last: BrainOutput = {
    rhythm: new Float64Array(NUM_JOINTS),
    correction: new Float64Array(NUM_JOINTS),
    action: new Float64Array(NUM_JOINTS),
  };
  // sin(φ + o) = sin φ cos o + cos φ sin o : on précalcule les cosinus et sinus des décalages.
  const hc = legs.map((l) => Math.cos(l.phase));
  const hs = legs.map((l) => Math.sin(l.phase));
  const kc = legs.map((l) => Math.cos(l.phase + l.kneeLag));
  const ks = legs.map((l) => Math.sin(l.phase + l.kneeLag));
  const policy = ((obs: Float64Array) => {
    const s = obs[0];
    const c = obs[1];
    const r = net.forward(obs);
    for (let i = 0; i < NUM_LEGS; i++) {
      const l = legs[i];
      const hip = l.hipBias + l.hipAmp * (s * hc[i] + c * hs[i]);
      const knee = l.kneeBias + l.kneeAmp * (s * kc[i] + c * ks[i]);
      last.rhythm[2 * i] = hip;
      last.rhythm[2 * i + 1] = knee;
    }
    for (let j = 0; j < NUM_JOINTS; j++) {
      const corr = RESIDUAL_SCALE * r[j];
      last.correction[j] = corr;
      last.action[j] = Math.max(-1, Math.min(1, last.rhythm[j] + corr));
    }
    return last.action;
  }) as unknown as BrainPolicy;
  policy.gaitHz = hz;
  policy.last = last;
  return policy;
}

/** Amplitude initiale commune des métronomes (hanche et genou), en fraction du débattement. */
export const INITIAL_AMP = 0.48;

/**
 * Cerveau initial : petits réglages aléatoires du rythme et réseau correcteur aléatoire.
 * Le robot piétine ou s'agite sans avancer.
 */
export function randomBrain(seed: number): Float64Array {
  const rng = mulberry32(seed);
  const p = new Float64Array(PARAM_COUNT);
  for (let i = 0; i < CPG_SIZE; i++) p[i] = 0.03 * randn(rng);
  // Les métronomes battent déjà (amplitude modeste) : sans cela, le départ serait un point mort
  // (amplitude nulle : rien à gagner à l'augmenter dans un sens plutôt que l'autre).
  p[1] += INITIAL_AMP / SHARED_GAIN;
  p[3] += INITIAL_AMP / SHARED_GAIN;
  const net = new MLP(BRAIN_SIZES, 'tanh').randomize(rng, 0.2);
  p.set(net.params, CPG_SIZE);
  return p;
}

export function evaluate(params: ArrayLike<number>, world: WorldParams, reward: RewardParams, steps?: number): EpisodeResult {
  return runEpisode(makePolicy(params), world, reward, steps);
}

export interface EsHyper {
  popSize: number;
  sigma: number;
  lr: number;
}

export const DEFAULT_HYPER: EsHyper = { popSize: 24, sigma: 0.06, lr: 0.05 };

export interface GenerationReport {
  generation: number;
  /** Note du cerveau de cette génération (θ, sans bruit). */
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
 * Entraîneur : à chaque génération, essaie popSize variantes bruitées du cerveau θ (et θ lui-même),
 * puis déplace θ vers les meilleures variantes.
 * Le rapport d'une génération décrit le cerveau θ essayé pendant cette génération.
 * Les évaluations peuvent être faites ailleurs (workers) : ask() puis finish(résultats).
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

  /** Numéro de la génération en cours (celle du cerveau θ actuel). */
  get generationIndex(): number {
    return this.es.generation;
  }

  /**
   * Prépare une génération : la liste des cerveaux à essayer.
   * L'élément 0 est le cerveau actuel θ (copie), les suivants les variantes.
   */
  ask(): Float64Array[] {
    const theta = Float64Array.from(this.es.theta);
    return [theta, ...this.es.ask()];
  }

  /** Termine la génération préparée par ask() à partir des résultats (même ordre). */
  finish(results: EpisodeResult[]): GenerationReport {
    const self = results[0];
    const generation = this.es.generation;
    this.es.tell(results.slice(1).map((r) => r.fitness));
    this.episodes += results.length;
    return {
      generation,
      fitness: self.fitness,
      distance: self.distance,
      energy: self.energy,
      fell: self.fell,
      popBest: this.es.lastBest,
      popMean: this.es.lastMean,
      episodes: this.episodes,
    };
  }

  /** Une génération complète, évaluée dans ce fil. */
  generation(): GenerationReport {
    const cands = this.ask();
    return this.finish(cands.map((c) => evaluate(c, this.world, this.reward)));
  }
}
