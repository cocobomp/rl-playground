// Petit réseau de neurones (perceptron multicouche) et stratégie d'évolution (OpenAI-ES).
// Sans dépendance : utilisable dans le navigateur, un Web Worker ou Node (pré-entraînement).
import { randn } from './rng';

export type Activation = 'tanh' | 'linear';

export class MLP {
  readonly sizes: number[];
  readonly outputActivation: Activation;
  params: Float64Array;
  private buffers: Float64Array[];

  /** sizes = [entrées, cachée1, …, sorties]. Couches cachées en tanh. */
  constructor(sizes: number[], outputActivation: Activation = 'tanh', params?: ArrayLike<number>) {
    if (sizes.length < 2) throw new Error('Il faut au moins une couche d’entrée et une de sortie');
    this.sizes = sizes.slice();
    this.outputActivation = outputActivation;
    const n = MLP.paramCount(sizes);
    this.params = params ? Float64Array.from(params) : new Float64Array(n);
    if (this.params.length !== n) throw new Error(`Attendu ${n} paramètres, reçu ${this.params.length}`);
    this.buffers = sizes.map((s) => new Float64Array(s));
  }

  /** Nombre de poids + biais. */
  static paramCount(sizes: number[]): number {
    let n = 0;
    for (let i = 0; i + 1 < sizes.length; i++) n += sizes[i] * sizes[i + 1] + sizes[i + 1];
    return n;
  }

  /** Initialisation aléatoire (échelle ~ 1/√entrées). */
  randomize(rng: () => number, scale = 1): this {
    let k = 0;
    for (let l = 0; l + 1 < this.sizes.length; l++) {
      const nin = this.sizes[l];
      const nout = this.sizes[l + 1];
      const s = scale / Math.sqrt(nin);
      for (let i = 0; i < nin * nout; i++) this.params[k++] = randn(rng) * s;
      for (let i = 0; i < nout; i++) this.params[k++] = 0;
    }
    return this;
  }

  /** Propagation avant. Le tableau renvoyé est réutilisé à l'appel suivant : copiez-le si besoin. */
  forward(input: ArrayLike<number>): Float64Array {
    const x0 = this.buffers[0];
    for (let i = 0; i < x0.length; i++) x0[i] = input[i] ?? 0;
    let k = 0;
    const last = this.sizes.length - 2;
    for (let l = 0; l <= last; l++) {
      const x = this.buffers[l];
      const y = this.buffers[l + 1];
      const nin = this.sizes[l];
      const nout = this.sizes[l + 1];
      const wStart = k;
      const bStart = k + nin * nout;
      for (let o = 0; o < nout; o++) {
        let sum = this.params[bStart + o];
        const row = wStart + o * nin;
        for (let i = 0; i < nin; i++) sum += this.params[row + i] * x[i];
        y[o] = l < last || this.outputActivation === 'tanh' ? Math.tanh(sum) : sum;
      }
      k = bStart + nout;
    }
    return this.buffers[this.buffers.length - 1];
  }

  clone(): MLP {
    return new MLP(this.sizes, this.outputActivation, this.params);
  }

  toJSON(): { sizes: number[]; outputActivation: Activation; params: number[] } {
    return { sizes: this.sizes, outputActivation: this.outputActivation, params: Array.from(this.params, (p) => +p.toFixed(5)) };
  }

  static fromJSON(o: { sizes: number[]; outputActivation?: Activation; params: number[] }): MLP {
    return new MLP(o.sizes, o.outputActivation ?? 'tanh', o.params);
  }
}

export interface ESOptions {
  /** Dimension (nombre de paramètres optimisés). */
  dim: number;
  /** Taille de population (paire : échantillonnage antithétique ±ε). */
  popSize?: number;
  /** Amplitude du bruit d'exploration. */
  sigma?: number;
  /** Taux d'apprentissage (Adam). */
  lr?: number;
  /** Décroissance des poids (régularisation L2). */
  weightDecay?: number;
  rng: () => number;
  init?: ArrayLike<number>;
}

/**
 * Stratégie d'évolution « OpenAI-ES » :
 * on essaie popSize variantes bruitées de θ, on classe leurs scores,
 * et on déplace θ dans la direction des meilleures variantes (gradient estimé + Adam).
 * Usage : const cands = es.ask(); … évaluer chaque candidat … ; es.tell(scores).
 */
export class EvolutionStrategy {
  theta: Float64Array;
  popSize: number;
  sigma: number;
  lr: number;
  weightDecay: number;
  generation = 0;
  /** Meilleur score observé dans la dernière génération. */
  lastBest = -Infinity;
  /** Score moyen de la dernière génération. */
  lastMean = -Infinity;
  private rng: () => number;
  private noise: Float64Array[] = [];
  private m: Float64Array;
  private v: Float64Array;

  constructor(o: ESOptions) {
    this.popSize = Math.max(2, (o.popSize ?? 32) & ~1);
    this.sigma = o.sigma ?? 0.1;
    this.lr = o.lr ?? 0.03;
    this.weightDecay = o.weightDecay ?? 0.005;
    this.rng = o.rng;
    this.theta = o.init ? Float64Array.from(o.init) : new Float64Array(o.dim);
    this.m = new Float64Array(o.dim);
    this.v = new Float64Array(o.dim);
  }

  /** Génère la population de candidats (θ + σε et θ − σε). */
  ask(): Float64Array[] {
    const dim = this.theta.length;
    this.noise = [];
    const out: Float64Array[] = [];
    for (let p = 0; p < this.popSize / 2; p++) {
      const eps = new Float64Array(dim);
      for (let i = 0; i < dim; i++) eps[i] = randn(this.rng);
      this.noise.push(eps);
      const plus = new Float64Array(dim);
      const minus = new Float64Array(dim);
      for (let i = 0; i < dim; i++) {
        plus[i] = this.theta[i] + this.sigma * eps[i];
        minus[i] = this.theta[i] - this.sigma * eps[i];
      }
      out.push(plus, minus);
    }
    return out;
  }

  /** Reçoit les scores (même ordre que ask()) et met θ à jour. Plus haut = meilleur. */
  tell(fitness: number[]): void {
    const n = fitness.length;
    if (n !== this.noise.length * 2) throw new Error('tell() doit recevoir un score par candidat de ask()');
    // Rangs centrés dans [-0.5, 0.5] : robuste aux échelles de récompense.
    const order = fitness.map((f, i) => [f, i] as const).sort((a, b) => a[0] - b[0]);
    const ranks = new Float64Array(n);
    order.forEach(([, i], r) => (ranks[i] = n > 1 ? r / (n - 1) - 0.5 : 0));
    const dim = this.theta.length;
    const grad = new Float64Array(dim);
    for (let p = 0; p < this.noise.length; p++) {
      const w = ranks[2 * p] - ranks[2 * p + 1];
      const eps = this.noise[p];
      for (let i = 0; i < dim; i++) grad[i] += w * eps[i];
    }
    const scale = 1 / (n * this.sigma);
    const b1 = 0.9, b2 = 0.999;
    this.generation++;
    for (let i = 0; i < dim; i++) {
      const g = grad[i] * scale - this.weightDecay * this.theta[i];
      this.m[i] = b1 * this.m[i] + (1 - b1) * g;
      this.v[i] = b2 * this.v[i] + (1 - b2) * g * g;
      const mh = this.m[i] / (1 - Math.pow(b1, this.generation));
      const vh = this.v[i] / (1 - Math.pow(b2, this.generation));
      this.theta[i] += (this.lr * mh) / (Math.sqrt(vh) + 1e-8);
    }
    let best = -Infinity, sum = 0;
    for (const f of fitness) {
      best = Math.max(best, f);
      sum += f;
    }
    this.lastBest = best;
    this.lastMean = sum / n;
  }
}
