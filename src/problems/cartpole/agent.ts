// Agents du pendule inversé : stratégie d'évolution (réseau de neurones ou politique linéaire)
// et REINFORCE (politique linéaire « softmax » à deux actions). Aucun accès au DOM.
import { EvolutionStrategy, MLP } from '../../shared/nn';
import { mulberry32 } from '../../shared/rng';
import { CartPole, WorldParams, hashSeed, observe } from './env';

/** Cerveau de l'agent. */
export type Brain = 'mlp' | 'linear' | 'softmax';

/** Politique sérialisable (envoyée du worker à la page). */
export interface PolicySpec {
  brain: Brain;
  /** Tailles des couches, ex. [4, 8, 1] ; [4, 1] pour une politique linéaire. */
  sizes: number[];
  params: number[];
  /** true : force proportionnelle à la sortie ; false : tout-ou-rien (±force maximale). */
  continuous: boolean;
}

/**
 * Propagation avant qui garde les activations de toutes les couches (pour la visualisation).
 * Même rangement des paramètres que MLP : pour chaque couche, poids [sortie][entrée] puis biais.
 * Couches cachées en tanh ; la sortie en tanh (ES) ou en logistique σ (REINFORCE).
 */
export function forwardLayers(sizes: number[], params: ArrayLike<number>, input: ArrayLike<number>, output: 'tanh' | 'sigmoid' = 'tanh'): number[][] {
  const layers: number[][] = [Array.from({ length: sizes[0] }, (_, i) => input[i] ?? 0)];
  let k = 0;
  for (let l = 0; l + 1 < sizes.length; l++) {
    const x = layers[l];
    const nin = sizes[l];
    const nout = sizes[l + 1];
    const bStart = k + nin * nout;
    const y: number[] = [];
    const last = l + 2 === sizes.length;
    for (let o = 0; o < nout; o++) {
      let sum = params[bStart + o];
      for (let i = 0; i < nin; i++) sum += params[k + o * nin + i] * x[i];
      y.push(last && output === 'sigmoid' ? 1 / (1 + Math.exp(-sum)) : Math.tanh(sum));
    }
    layers.push(y);
    k = bStart + nout;
  }
  return layers;
}

/** Contrôleur prêt à l'emploi : renvoie une force en fraction de la force maximale, dans [−1, 1]. */
export interface Controller {
  act(obs: ArrayLike<number>): number;
}

export function makeController(spec: PolicySpec, rng: () => number): Controller {
  if (spec.brain === 'softmax') {
    const p = spec.params;
    return {
      act(o) {
        const z = p[0] * o[0] + p[1] * o[1] + p[2] * o[2] + p[3] * o[3] + p[4];
        return rng() < 1 / (1 + Math.exp(-z)) ? 1 : -1;
      },
    };
  }
  const net = new MLP(spec.sizes, 'tanh', spec.params);
  return {
    act(o) {
      const y = net.forward(o)[0];
      return spec.continuous ? y : y >= 0 ? 1 : -1;
    },
  };
}

/** Joue un épisode complet ; renvoie le nombre de pas tenus (au plus 500). */
export function runEpisode(ctrl: Controller, world: WorldParams, seed: number): number {
  const env = new CartPole(world, mulberry32(seed));
  env.reset();
  const obs = [0, 0, 0, 0];
  while (!env.done) env.step(ctrl.act(observe(env.state, obs)) * world.forceMag);
  return env.steps;
}

// ---------------------------------------------------------------------------
// Stratégie d'évolution
// ---------------------------------------------------------------------------

export interface EsOptions {
  brain: 'mlp' | 'linear';
  hidden: number;
  popSize: number;
  sigma: number;
  lr: number;
  /** Nombre d'épisodes joués par candidat pour l'évaluer (score = moyenne). */
  episodesPerEval: number;
  continuous: boolean;
  seed: number;
}

export const DEFAULT_ES: EsOptions = {
  brain: 'mlp',
  hidden: 8,
  popSize: 30,
  sigma: 0.1,
  lr: 0.05,
  episodesPerEval: 3,
  continuous: false,
  // Graine par défaut choisie pour que l'agent de départ soit franchement mauvais (certains tirages
  // au hasard tiennent déjà longtemps, ce qui brouillerait la démonstration).
  seed: 6,
};

export interface GenerationResult {
  generation: number;
  /** Score moyen de la population (pas tenus, moyenne sur ses épisodes d'évaluation). */
  mean: number;
  /** Score du meilleur individu de la génération. */
  best: number;
  /** Le meilleur individu (celui qu'on rejoue à l'écran). */
  champion: PolicySpec;
  /** Nombre total d'épisodes joués depuis le début. */
  episodes: number;
}

export class EsTrainer {
  readonly opts: EsOptions;
  readonly sizes: number[];
  readonly es: EvolutionStrategy;
  private net: MLP;
  episodes = 0;
  history: { mean: number; best: number }[] = [];
  champion: PolicySpec;

  constructor(opts: Partial<EsOptions> = {}) {
    this.opts = { ...DEFAULT_ES, ...opts };
    const o = this.opts;
    this.sizes = o.brain === 'linear' ? [4, 1] : [4, Math.max(1, Math.round(o.hidden)), 1];
    const rng = mulberry32(hashSeed(o.seed, 7919));
    // Politique linéaire : sign(w·o + b) ne dépend que de la direction de w ; de petits poids initiaux
    // rendent le bruit σ relativement grand, ce qui évite de rester bloqué sur un plateau (score ≈ 9 pas).
    this.net = new MLP(this.sizes, 'tanh').randomize(rng, o.brain === 'linear' ? 0.1 : 0.5);
    this.es = new EvolutionStrategy({ dim: this.net.params.length, popSize: o.popSize, sigma: o.sigma, lr: o.lr, rng, init: this.net.params });
    this.champion = this.spec(this.es.theta);
  }

  spec(params: ArrayLike<number>): PolicySpec {
    return { brain: this.opts.brain, sizes: this.sizes, params: Array.from(params), continuous: this.opts.continuous };
  }

  /** Réglages modifiables entre deux générations. */
  setHyper(h: { popSize?: number; sigma?: number; lr?: number; episodesPerEval?: number }): void {
    if (h.popSize !== undefined) this.es.popSize = Math.max(2, Math.round(h.popSize) & ~1);
    if (h.sigma !== undefined) this.es.sigma = h.sigma;
    if (h.lr !== undefined) this.es.lr = h.lr;
    if (h.episodesPerEval !== undefined) this.opts.episodesPerEval = Math.max(1, Math.round(h.episodesPerEval));
  }

  /** Évalue un vecteur de paramètres sur les épisodes de la génération g (mêmes départs et mêmes rafales pour tous). */
  evaluate(params: ArrayLike<number>, world: WorldParams, g: number): number {
    this.net.params.set(params);
    const net = this.net;
    const cont = this.opts.continuous;
    const ctrl: Controller = {
      act(o) {
        const y = net.forward(o)[0];
        return cont ? y : y >= 0 ? 1 : -1;
      },
    };
    let sum = 0;
    const k = this.opts.episodesPerEval;
    for (let e = 0; e < k; e++) sum += runEpisode(ctrl, world, hashSeed(this.opts.seed, g + 1, e));
    this.episodes += k;
    return sum / k;
  }

  /** Une génération : essayer la population, classer, déplacer θ. */
  generation(world: WorldParams): GenerationResult {
    const g = this.es.generation;
    const cands = this.es.ask();
    const scores = cands.map((c) => this.evaluate(c, world, g));
    let bi = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bi]) bi = i;
    this.champion = this.spec(cands[bi]);
    this.es.tell(scores);
    const res = { mean: this.es.lastMean, best: this.es.lastBest };
    this.history.push(res);
    return { generation: this.es.generation, ...res, champion: this.champion, episodes: this.episodes };
  }
}

// ---------------------------------------------------------------------------
// REINFORCE (gradient de politique, Williams 1992)
// ---------------------------------------------------------------------------

export interface ReinforceOptions {
  lr: number;
  gamma: number;
  seed: number;
}

export const DEFAULT_REINFORCE: ReinforceOptions = { lr: 0.01, gamma: 0.99, seed: 6 };

/** Probabilité de pousser à droite : σ(w·o + b). */
export function softmaxProb(w: ArrayLike<number>, o: ArrayLike<number>): number {
  const z = w[0] * o[0] + w[1] * o[1] + w[2] * o[2] + w[3] * o[3] + w[4];
  return 1 / (1 + Math.exp(-z));
}

/** Retours actualisés G_t = r_t + γ·G_{t+1}, puis centrés-réduits (la moyenne sert de ligne de base). */
export function normalizedReturns(rewards: number[], gamma: number): number[] {
  const n = rewards.length;
  const g = new Array<number>(n);
  let acc = 0;
  for (let t = n - 1; t >= 0; t--) {
    acc = rewards[t] + gamma * acc;
    g[t] = acc;
  }
  const mean = g.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = Math.sqrt(g.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n));
  return g.map((v) => (v - mean) / (sd + 1e-8));
}

/**
 * Gradient de log π(a|s) pour la politique logistique : (a − p)·[o, 1], avec a = 1 (droite) ou 0 (gauche).
 */
export function logProbGrad(w: ArrayLike<number>, o: ArrayLike<number>, a: 0 | 1): number[] {
  const p = softmaxProb(w, o);
  const d = a - p;
  return [d * o[0], d * o[1], d * o[2], d * o[3], d];
}

export class ReinforceTrainer {
  readonly opts: ReinforceOptions;
  /** Paramètres [w_position, w_vitesse, w_angle, w_vitesse_angulaire, biais]. */
  w = new Float64Array(5);
  episode = 0;
  history: number[] = [];
  private rng: () => number;

  constructor(opts: Partial<ReinforceOptions> = {}) {
    this.opts = { ...DEFAULT_REINFORCE, ...opts };
    this.rng = mulberry32(hashSeed(this.opts.seed, 104729));
  }

  spec(): PolicySpec {
    return { brain: 'softmax', sizes: [4, 1], params: Array.from(this.w), continuous: false };
  }

  /** Joue un épisode avec la politique actuelle (tirage au sort des actions), puis met w à jour. */
  runEpisode(world: WorldParams): number {
    const env = new CartPole(world, mulberry32(hashSeed(this.opts.seed, this.episode + 1, 99)));
    env.reset();
    const obsList: number[][] = [];
    const acts: (0 | 1)[] = [];
    const rewards: number[] = [];
    while (!env.done) {
      const o = observe(env.state);
      const a: 0 | 1 = this.rng() < softmaxProb(this.w, o) ? 1 : 0;
      env.step(a === 1 ? world.forceMag : -world.forceMag);
      obsList.push(o);
      acts.push(a);
      rewards.push(1); // +1 par pas tenu
    }
    const adv = normalizedReturns(rewards, this.opts.gamma);
    const grad = new Float64Array(5);
    for (let t = 0; t < obsList.length; t++) {
      const gl = logProbGrad(this.w, obsList[t], acts[t]);
      for (let i = 0; i < 5; i++) grad[i] += adv[t] * gl[i];
    }
    for (let i = 0; i < 5; i++) this.w[i] += this.opts.lr * grad[i];
    this.episode++;
    this.history.push(env.steps);
    return env.steps;
  }
}
