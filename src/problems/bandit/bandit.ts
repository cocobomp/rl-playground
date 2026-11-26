// Bandit manchot à K bras (machines à sous de Bernoulli) et stratégies classiques.
// Code pur, sans DOM : utilisé par l'interface, les tests et les scripts hors ligne.
import { mulberry32, randn } from '../../shared/rng';

export type Rng = () => number;

// ---------------------------------------------------------------------------
// Outils statistiques
// ---------------------------------------------------------------------------

/** Tirage Gamma(shape, 1) par la méthode de Marsaglia & Tsang (2000). */
export function sampleGamma(rng: Rng, shape: number): number {
  if (!(shape > 0)) throw new Error('shape doit être > 0');
  if (shape < 1) {
    // Astuce classique : Gamma(a) = Gamma(a + 1) · U^(1/a)
    let u = rng();
    while (u === 0) u = rng();
    return sampleGamma(rng, shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = randn(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (u > 0 && Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Tirage Beta(a, b) = X / (X + Y) avec X ~ Gamma(a), Y ~ Gamma(b). */
export function sampleBeta(rng: Rng, a: number, b: number): number {
  const x = sampleGamma(rng, a);
  const y = sampleGamma(rng, b);
  return x / (x + y);
}

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(x) pour x > 0 (approximation de Lanczos, précision ~1e-13). */
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Densité de la loi Beta(a, b) en x ∈ ]0, 1[. */
export function betaPdf(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  const lnB = logGamma(a) + logGamma(b) - logGamma(a + b);
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lnB);
}

/** Moyenne et écart-type de Beta(a, b). */
export function betaMoments(a: number, b: number): { mean: number; sd: number } {
  const s = a + b;
  return { mean: a / s, sd: Math.sqrt((a * b) / (s * s * (s + 1))) };
}

/** Indice du maximum ; les ex æquo sont départagés au hasard (sinon le premier bras serait favorisé). */
export function argmaxRandom(values: ArrayLike<number>, rng: Rng): number {
  let best = -Infinity;
  let count = 0;
  let idx = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v > best) {
      best = v;
      idx = i;
      count = 1;
    } else if (v === best) {
      count++;
      if (rng() * count < 1) idx = i; // tirage uniforme parmi les ex æquo (réservoir)
    }
  }
  return idx;
}

/**
 * Score UCB : estimation + bonus d'optimisme c · √(ln t / n).
 * Avec c = √2 on retrouve UCB1 (Auer et al., 2002). Une machine jamais jouée vaut +∞.
 */
export function ucbScore(q: number, n: number, t: number, c: number): number {
  if (n <= 0) return Infinity;
  return q + c * Math.sqrt(Math.log(Math.max(t, 1)) / n);
}

// ---------------------------------------------------------------------------
// Environnement
// ---------------------------------------------------------------------------

export interface EnvSpec {
  /** Probabilités de gain de chaque machine (avant un éventuel changement). */
  before: number[];
  /** Probabilités après le changement de réglages (null = casino honnête, rien ne change). */
  after: number[] | null;
  /** Numéro du coup (0-indexé) à partir duquel `after` s'applique. */
  changeAt: number;
}

export class BanditEnv {
  readonly k: number;
  constructor(readonly spec: EnvSpec) {
    this.k = spec.before.length;
  }
  probs(t: number): number[] {
    return this.spec.after && t >= this.spec.changeAt ? this.spec.after : this.spec.before;
  }
  prob(arm: number, t: number): number {
    return this.probs(t)[arm];
  }
  bestProb(t: number): number {
    return Math.max(...this.probs(t));
  }
  bestArm(t: number): number {
    const p = this.probs(t);
    return p.indexOf(Math.max(...p));
  }
  /** Joue la machine `arm` au coup t : 1 = gagné, 0 = perdu. */
  pull(arm: number, t: number, rng: Rng): 0 | 1 {
    return rng() < this.prob(arm, t) ? 1 : 0;
  }
}

export type ScenarioKind = 'easy' | 'hard' | 'switch' | 'needle';

function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Probabilités cachées pour un scénario (déterministes pour une graine donnée). */
export function scenarioProbs(kind: ScenarioKind, k: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const lin = (lo: number, hi: number) =>
    Array.from({ length: k }, (_, i) => lo + ((hi - lo) * i) / Math.max(1, k - 1));
  let p: number[];
  if (kind === 'hard') {
    p = lin(0.42, 0.55);
  } else if (kind === 'needle') {
    p = Array.from({ length: k }, () => 0.1 + 0.15 * rng());
    p[0] = 0.6;
  } else {
    p = lin(0.1, 0.8).map((v) => v + (rng() - 0.5) * 0.04);
  }
  p = shuffle(p.map(round2), rng);
  // Garantit une meilleure machine unique (sinon « la meilleure » serait ambiguë).
  const max = Math.max(...p);
  if (p.filter((v) => v === max).length > 1) p[p.indexOf(max)] = round2(max + 0.01);
  return p;
}

/** Réglages après le changement : l'ordre est inversé (la meilleure machine devient la pire, etc.). */
export function reversedRanking(p: number[]): number[] {
  const order = p.map((_, i) => i).sort((a, b) => p[a] - p[b]); // du pire au meilleur
  const sorted = order.map((i) => p[i]);
  const out = new Array<number>(p.length);
  order.forEach((arm, rank) => (out[arm] = sorted[p.length - 1 - rank]));
  return out;
}

export function makeEnvSpec(probs: number[], change: boolean, horizon: number): EnvSpec {
  return { before: probs, after: change ? reversedRanking(probs) : null, changeAt: Math.floor(horizon / 2) };
}

// ---------------------------------------------------------------------------
// Stratégies
// ---------------------------------------------------------------------------

export type StrategyId = 'greedy' | 'egreedy' | 'ucb' | 'thompson';

export const STRATEGIES: Array<{ id: StrategyId; label: string }> = [
  { id: 'greedy', label: 'Glouton pur' },
  { id: 'egreedy', label: 'ε-greedy' },
  { id: 'ucb', label: 'UCB' },
  { id: 'thompson', label: 'Thompson' },
];

export interface AgentParams {
  /** Probabilité d'explorer au hasard (ε-greedy). */
  epsilon: number;
  /** Constante d'exploration de UCB (√2 ≈ 1,41 = UCB1). */
  c: number;
  /** A priori Beta(a₀, b₀) de Thompson : a₀ − 1 gains et b₀ − 1 pertes « imaginaires ». */
  priorA: number;
  priorB: number;
  /** Mémoire courte : pas constant α au lieu de la moyenne de tous les résultats. */
  shortMemory: boolean;
  /** Pas α de la mémoire courte (≈ ne retient que les 1/α derniers résultats de chaque machine). */
  stepSize: number;
  /** Estimation de départ Q₀ (glouton et ε-greedy). Une valeur haute = « optimisme initial ». */
  initialValue: number;
}

export const DEFAULT_PARAMS: AgentParams = {
  epsilon: 0.1,
  c: Math.SQRT2,
  priorA: 1,
  priorB: 1,
  shortMemory: false,
  stepSize: 0.1,
  initialValue: 0,
};

export class Agent {
  /** Nombre réel de parties jouées sur chaque machine. */
  counts: number[] = [];
  /** Nombre réel de gains sur chaque machine. */
  wins: number[] = [];
  /** Estimation Q de la probabilité de gain. */
  values: number[] = [];
  /** Gains / pertes « retenus » (égaux aux vrais comptes, ou oubliés progressivement en mémoire courte). */
  succ: number[] = [];
  fail: number[] = [];
  /** Nombre total de parties jouées. */
  t = 0;

  constructor(
    readonly strategy: StrategyId,
    readonly k: number,
    public params: AgentParams,
    readonly rng: Rng,
  ) {
    this.reset();
  }

  reset(): void {
    const z = () => new Array<number>(this.k).fill(0);
    this.counts = z();
    this.wins = z();
    this.succ = z();
    this.fail = z();
    this.values = new Array<number>(this.k).fill(this.params.initialValue);
    this.t = 0;
  }

  /** Quantité d'information retenue sur une machine (= nombre de parties en mémoire longue). */
  effectiveCount(arm: number): number {
    return this.succ[arm] + this.fail[arm];
  }

  /** Loi a posteriori Beta(a, b) de la probabilité de gain de la machine (a priori de Thompson). */
  posterior(arm: number, priorA = this.params.priorA, priorB = this.params.priorB): [number, number] {
    return [priorA + this.succ[arm], priorB + this.fail[arm]];
  }

  ucb(arm: number): number {
    return ucbScore(this.values[arm], this.effectiveCount(arm), this.t, this.params.c);
  }

  select(): number {
    const { rng, k } = this;
    switch (this.strategy) {
      case 'greedy':
        return argmaxRandom(this.values, rng);
      case 'egreedy':
        if (rng() < this.params.epsilon) return Math.floor(rng() * k);
        return argmaxRandom(this.values, rng);
      case 'ucb': {
        const s = new Array<number>(k);
        for (let i = 0; i < k; i++) s[i] = this.ucb(i);
        return argmaxRandom(s, rng);
      }
      case 'thompson': {
        const s = new Array<number>(k);
        for (let i = 0; i < k; i++) {
          const [a, b] = this.posterior(i);
          s[i] = sampleBeta(rng, a, b);
        }
        return argmaxRandom(s, rng);
      }
    }
  }

  update(arm: number, reward: number): void {
    this.t++;
    this.counts[arm]++;
    this.wins[arm] += reward;
    const p = this.params;
    if (p.shortMemory) {
      const g = 1 - p.stepSize;
      this.succ[arm] = g * this.succ[arm] + reward;
      this.fail[arm] = g * this.fail[arm] + (1 - reward);
    } else {
      this.succ[arm] += reward;
      this.fail[arm] += 1 - reward;
    }
    // Moyenne incrémentale Q ← Q + (r − Q)/n, ou pas constant Q ← Q + α (r − Q).
    const alpha = p.shortMemory ? p.stepSize : 1 / this.counts[arm];
    this.values[arm] += alpha * (reward - this.values[arm]);
  }

  /** Estimation affichée : moyenne a posteriori pour Thompson, Q pour les autres. */
  estimate(arm: number): number {
    if (this.strategy === 'thompson') {
      const [a, b] = this.posterior(arm);
      return a / (a + b);
    }
    return this.values[arm];
  }
}

/** Graine dérivée (hachage entier simple) pour des flux aléatoires indépendants. */
export function deriveSeed(seed: number, a: number, b = 0): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (a + 0x7f4a7c15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13) ^ (b + 0x165667b1), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------------------------------------------------------------------------
// Course : toutes les stratégies sur les mêmes machines
// ---------------------------------------------------------------------------

export const BEST_WINDOW = 50;

export class Race {
  agents: Agent[];
  rewardRngs: Rng[];
  t = 0;
  /** Regret cumulé (pseudo-regret : Σ p* − p du bras choisi) après chaque coup. */
  regret: number[][];
  /** % des BEST_WINDOW derniers coups joués sur la meilleure machine du moment. */
  bestShare: number[][];
  bestFlags: number[][];
  totalWins: number[];
  lastArm: number[];
  lastReward: number[];

  constructor(
    readonly env: BanditEnv,
    readonly strategies: StrategyId[],
    params: AgentParams,
    readonly seed: number,
  ) {
    this.agents = strategies.map((s, i) => new Agent(s, env.k, params, mulberry32(deriveSeed(seed, i, 1))));
    this.rewardRngs = strategies.map((_, i) => mulberry32(deriveSeed(seed, i, 2)));
    this.regret = strategies.map(() => []);
    this.bestShare = strategies.map(() => []);
    this.bestFlags = strategies.map(() => []);
    this.totalWins = strategies.map(() => 0);
    this.lastArm = strategies.map(() => -1);
    this.lastReward = strategies.map(() => 0);
  }

  step(): void {
    const t = this.t;
    const best = this.env.bestProb(t);
    const bestArm = this.env.bestArm(t);
    this.agents.forEach((agent, i) => {
      const arm = agent.select();
      const r = this.env.pull(arm, t, this.rewardRngs[i]);
      agent.update(arm, r);
      this.totalWins[i] += r;
      this.lastArm[i] = arm;
      this.lastReward[i] = r;
      const prev = this.regret[i].length ? this.regret[i][this.regret[i].length - 1] : 0;
      this.regret[i].push(prev + best - this.env.prob(arm, t));
      const flags = this.bestFlags[i];
      flags.push(arm === bestArm ? 1 : 0);
      const from = Math.max(0, flags.length - BEST_WINDOW);
      let s = 0;
      for (let j = from; j < flags.length; j++) s += flags[j];
      this.bestShare[i].push((100 * s) / (flags.length - from));
    });
    this.t++;
  }

  currentRegret(i: number): number {
    const r = this.regret[i];
    return r.length ? r[r.length - 1] : 0;
  }
}

/** Joue `plays` coups avec une stratégie ; renvoie gains et pseudo-regret final. */
export function simulate(env: BanditEnv, strategy: StrategyId, params: AgentParams, plays: number, seed: number) {
  const agent = new Agent(strategy, env.k, params, mulberry32(deriveSeed(seed, 11)));
  const rr = mulberry32(deriveSeed(seed, 12));
  let wins = 0;
  let regret = 0;
  for (let t = 0; t < plays; t++) {
    const arm = agent.select();
    const r = env.pull(arm, t, rr);
    agent.update(arm, r);
    wins += r;
    regret += env.bestProb(t) - env.prob(arm, t);
  }
  return { wins, regret };
}

/** Moyenne (et écart-type) des gains d'une stratégie sur `runs` parties simulées. */
export function averageWins(env: BanditEnv, strategy: StrategyId, params: AgentParams, plays: number, runs: number, seed: number) {
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < runs; i++) {
    const { wins } = simulate(env, strategy, params, plays, deriveSeed(seed, i, 7));
    s += wins;
    s2 += wins * wins;
  }
  const mean = s / runs;
  return { mean, sd: Math.sqrt(Math.max(0, s2 / runs - mean * mean)) };
}

/** Gains moyens attendus : toujours la meilleure machine (oracle) et au hasard. */
export function referenceWins(env: BanditEnv, plays: number): { oracle: number; random: number } {
  let oracle = 0;
  let random = 0;
  for (let t = 0; t < plays; t++) {
    const p = env.probs(t);
    oracle += Math.max(...p);
    random += p.reduce((a, b) => a + b, 0) / p.length;
  }
  return { oracle, random };
}
