// Agent : approximation linéaire par tuiles (tile coding) + Sarsa(λ) ou Q(λ) de Watkins. Sans DOM.
import { mulberry32 } from '../../shared/rng';
import { MountainCar, N_ACTIONS, PhysicsParams, V_MAX, X_MAX, X_MIN } from './env';

/**
 * Codage en tuiles : `tilings` grilles de `tiles` × `tiles` cases, chacune décalée d’une fraction de case
 * (décalages asymétriques (1, 3) recommandés par Sutton & Barto). Chaque grille a une rangée et une colonne
 * de plus pour couvrir le décalage. Un état active exactement une tuile par grille.
 */
export class TileCoder {
  readonly side: number;
  readonly perTiling: number;
  readonly size: number;
  constructor(
    readonly tilings: number,
    readonly tiles: number,
  ) {
    this.side = tiles + 1;
    this.perTiling = this.side * this.side;
    this.size = tilings * this.perTiling;
  }

  /** Écrit dans `out` les `tilings` indices de tuiles actives pour (x, v). */
  indices(x: number, v: number, out: Int32Array): Int32Array {
    const n = this.tiles;
    const px = ((x - X_MIN) / (X_MAX - X_MIN)) * n;
    const pv = ((v + V_MAX) / (2 * V_MAX)) * n;
    const T = this.tilings;
    const side = this.side;
    for (let t = 0; t < T; t++) {
      let ix = Math.floor(px + t / T);
      let iv = Math.floor(pv + ((t * 3) % T) / T);
      if (ix < 0) ix = 0;
      else if (ix > n) ix = n;
      if (iv < 0) iv = 0;
      else if (iv > n) iv = n;
      out[t] = t * this.perTiling + ix * side + iv;
    }
    return out;
  }
}

export type Algorithm = 'sarsa' | 'qlearning';

export interface AgentConfig {
  algorithm: Algorithm;
  /** Pas d’apprentissage total (réparti entre les grilles : chaque poids bouge de α/tilings · δ). */
  alpha: number;
  gamma: number;
  epsilon: number;
  lambda: number;
  tilings: number;
  tiles: number;
  /** Valeur initiale de Q(s, a) pour tous les états. */
  qInit: number;
}

export const DEFAULT_AGENT: AgentConfig = {
  algorithm: 'sarsa',
  alpha: 0.5,
  gamma: 0.99,
  epsilon: 0.05,
  lambda: 0.9,
  tilings: 8,
  tiles: 8,
  qInit: 0,
};

const TRACE_MIN = 1e-3;

export class Agent {
  readonly coder: TileCoder;
  /** Poids, rangés par action : w[a · size + tuile]. */
  w: Float64Array;
  /** Traces d’éligibilité (même rangement), plus la liste des indices actifs. */
  private e: Float64Array;
  private active: Int32Array;
  private inList: Uint8Array;
  private nActive = 0;
  private feat: Int32Array;
  private qBuf = new Float64Array(N_ACTIONS);

  constructor(
    public cfg: AgentConfig,
    public rng: () => number,
  ) {
    this.coder = new TileCoder(cfg.tilings, cfg.tiles);
    const n = this.coder.size * N_ACTIONS;
    this.w = new Float64Array(n).fill(cfg.qInit / cfg.tilings);
    this.e = new Float64Array(n);
    this.active = new Int32Array(n);
    this.inList = new Uint8Array(n);
    this.feat = new Int32Array(cfg.tilings);
  }

  get size(): number {
    return this.coder.size;
  }

  features(x: number, v: number, out: Int32Array = new Int32Array(this.cfg.tilings)): Int32Array {
    return this.coder.indices(x, v, out);
  }

  /** Q(s, a) à partir d’indices de tuiles déjà calculés. */
  qFeat(feat: Int32Array, a: number): number {
    const off = a * this.coder.size;
    let s = 0;
    for (let i = 0; i < feat.length; i++) s += this.w[off + feat[i]];
    return s;
  }

  /** Remplit out[a] = Q(x, v, a). */
  qValues(x: number, v: number, out: Float64Array = this.qBuf): Float64Array {
    this.coder.indices(x, v, this.feat);
    for (let a = 0; a < N_ACTIONS; a++) out[a] = this.qFeat(this.feat, a);
    return out;
  }

  q(x: number, v: number, a: number): number {
    this.coder.indices(x, v, this.feat);
    return this.qFeat(this.feat, a);
  }

  /** Meilleure action (égalités tranchées au hasard). */
  greedyFeat(feat: Int32Array): number {
    let best = -Infinity;
    let arg = 0;
    let ties = 0;
    for (let a = 0; a < N_ACTIONS; a++) {
      const q = this.qFeat(feat, a);
      if (q > best + 1e-12) {
        best = q;
        arg = a;
        ties = 1;
      } else if (Math.abs(q - best) <= 1e-12) {
        ties++;
        if (this.rng() * ties < 1) arg = a;
      }
    }
    return arg;
  }

  maxQFeat(feat: Int32Array): number {
    let best = -Infinity;
    for (let a = 0; a < N_ACTIONS; a++) best = Math.max(best, this.qFeat(feat, a));
    return best;
  }

  /** Choix ε-greedy. */
  actFeat(feat: Int32Array, epsilon = this.cfg.epsilon): number {
    if (epsilon > 0 && this.rng() < epsilon) return Math.floor(this.rng() * N_ACTIONS);
    return this.greedyFeat(feat);
  }

  clearTraces(): void {
    for (let k = 0; k < this.nActive; k++) {
      const i = this.active[k];
      this.e[i] = 0;
      this.inList[i] = 0;
    }
    this.nActive = 0;
  }

  /** Traces « remplaçantes » : les tuiles de (s, a) passent à 1, celles des autres actions à 0. */
  private markTraces(feat: Int32Array, a: number): void {
    const size = this.coder.size;
    for (let i = 0; i < feat.length; i++) {
      for (let b = 0; b < N_ACTIONS; b++) {
        const idx = b * size + feat[i];
        if (b === a) {
          this.e[idx] = 1;
          if (!this.inList[idx]) {
            this.inList[idx] = 1;
            this.active[this.nActive++] = idx;
          }
        } else {
          this.e[idx] = 0;
        }
      }
    }
  }

  /** w ← w + (α/n)·δ·e, puis e ← γλ·e (ou e ← 0 si cut). Retire les traces devenues négligeables. */
  private applyDelta(delta: number, decay: number): void {
    const step = (this.cfg.alpha / this.cfg.tilings) * delta;
    let k = 0;
    while (k < this.nActive) {
      const i = this.active[k];
      this.w[i] += step * this.e[i];
      const ne = this.e[i] * decay;
      if (ne < TRACE_MIN) {
        this.e[i] = 0;
        this.inList[i] = 0;
        this.active[k] = this.active[--this.nActive];
      } else {
        this.e[i] = ne;
        k++;
      }
    }
  }

  /**
   * Une mise à jour TD(λ) pour la transition (s, a) → r, s′.
   * featNext / aNext : état et action suivants (ignorés si terminal).
   * Renvoie δ, l’erreur de prédiction.
   */
  update(feat: Int32Array, a: number, r: number, featNext: Int32Array | null, aNext: number): number {
    const { gamma, lambda, algorithm } = this.cfg;
    this.markTraces(feat, a);
    let delta = r - this.qFeat(feat, a);
    if (featNext === null) {
      this.applyDelta(delta, 0);
      return delta;
    }
    if (algorithm === 'qlearning') {
      const maxNext = this.maxQFeat(featNext);
      delta += gamma * maxNext;
      // Q(λ) de Watkins : on coupe les traces après une action exploratoire.
      const exploratory = this.qFeat(featNext, aNext) < maxNext - 1e-12;
      this.applyDelta(delta, exploratory ? 0 : gamma * lambda);
    } else {
      delta += gamma * this.qFeat(featNext, aNext);
      this.applyDelta(delta, gamma * lambda);
    }
    return delta;
  }

  /** Recopie des poids (pour le worker) ; vide les traces. */
  setWeights(w: Float64Array): void {
    if (w.length === this.w.length) this.w.set(w);
    this.clearTraces();
  }
}

export interface StepInfo {
  x: number;
  v: number;
  action: number;
  reward: number;
  delta: number;
  /** Fin d’épisode (drapeau ou limite de pas). */
  episodeEnded: boolean;
  goal: boolean;
}

export interface EpisodeResult {
  steps: number;
  /** Somme des récompenses perçues (coup de pouce compris). */
  ret: number;
  goal: boolean;
}

/** Relie l’agent et l’environnement : un pas d’apprentissage à la fois (ou un épisode entier). */
export class Trainer {
  agent: Agent;
  env: MountainCar;
  episode = 0;
  totalSteps = 0;
  ret = 0;
  history: EpisodeResult[] = [];
  /** Trajectoire de l’épisode en cours (x, v alternés). */
  traj: number[] = [];
  /** Action en cours (choisie, pas encore jouée). */
  action = 1;
  private feat: Int32Array;
  private featNext: Int32Array;
  private started = false;
  /** Enregistrer la trajectoire (inutile pendant le turbo hors-ligne). */
  recordTrajectory = true;

  constructor(
    cfg: AgentConfig,
    physics: PhysicsParams,
    public rng: () => number = mulberry32(1),
  ) {
    this.agent = new Agent(cfg, rng);
    this.env = new MountainCar(physics);
    this.feat = new Int32Array(cfg.tilings);
    this.featNext = new Int32Array(cfg.tilings);
  }

  get stepInEpisode(): number {
    return this.env.t;
  }

  /** Abandonne l’épisode en cours (sans le compter) et en démarre un nouveau au prochain pas. */
  restartEpisode(): void {
    this.started = false;
  }

  private beginEpisode(): void {
    this.env.reset(this.rng);
    this.agent.clearTraces();
    this.agent.features(this.env.x, this.env.v, this.feat);
    this.action = this.agent.actFeat(this.feat);
    this.ret = 0;
    this.traj = this.recordTrajectory ? [this.env.x, this.env.v] : [];
    this.started = true;
  }

  step(): StepInfo {
    if (!this.started) this.beginEpisode();
    const a = this.action;
    const res = this.env.step(a, this.agent.cfg.gamma);
    this.ret += res.reward;
    this.totalSteps++;
    if (this.recordTrajectory) this.traj.push(res.x, res.v);
    let delta: number;
    if (res.goal) {
      delta = this.agent.update(this.feat, a, res.reward, null, 0);
    } else {
      this.agent.features(res.x, res.v, this.featNext);
      const aNext = this.agent.actFeat(this.featNext);
      delta = this.agent.update(this.feat, a, res.reward, this.featNext, aNext);
      const tmp = this.feat;
      this.feat = this.featNext;
      this.featNext = tmp;
      this.action = aNext;
    }
    const ended = res.goal || res.truncated;
    if (ended) {
      this.history.push({ steps: this.env.t, ret: this.ret, goal: res.goal });
      this.episode++;
      this.started = false;
    }
    return { x: res.x, v: res.v, action: a, reward: res.reward, delta, episodeEnded: ended, goal: res.goal };
  }

  runEpisode(): EpisodeResult {
    for (;;) {
      const info = this.step();
      if (info.episodeEnded) return this.history[this.history.length - 1];
    }
  }
}

/** Épisode de test sans apprentissage ni exploration (stratégie gloutonne actuelle). */
export function greedyRollout(
  agent: Agent,
  physics: PhysicsParams,
  startX: number,
  startV = 0,
  maxSteps = physics.maxSteps,
): { steps: number; goal: boolean; traj: number[]; actions: number[] } {
  const env = new MountainCar({ ...physics, maxSteps });
  env.x = startX;
  env.v = startV;
  const feat = new Int32Array(agent.cfg.tilings);
  const traj = [env.x, env.v];
  const actions: number[] = [];
  for (;;) {
    agent.features(env.x, env.v, feat);
    const a = agent.greedyFeat(feat);
    actions.push(a);
    const r = env.step(a);
    traj.push(r.x, r.v);
    if (r.goal || r.truncated) return { steps: env.t, goal: r.goal, traj, actions };
  }
}
