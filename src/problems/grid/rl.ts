// Cœur du reinforcement learning : environnement "grille" + agent tabulaire.
// Aucune dépendance au DOM : ce module est testé directement (voir tests/).

export type Cell = 'empty' | 'wall' | 'trap' | 'start' | 'goal';

/** Les 4 actions possibles, dans cet ordre : haut, droite, bas, gauche. */
export const ACTIONS = [
  { dr: -1, dc: 0, name: 'haut' },
  { dr: 0, dc: 1, name: 'droite' },
  { dr: 1, dc: 0, name: 'bas' },
  { dr: 0, dc: -1, name: 'gauche' },
] as const;
export const N_ACTIONS = ACTIONS.length;

export interface Rewards {
  /** Récompense en atteignant l'arrivée. */
  goal: number;
  /** Récompense (négative) en tombant dans un piège. */
  trap: number;
  /** Coût de chaque pas (généralement petit et négatif). */
  step: number;
}

export type Algorithm = 'qlearning' | 'sarsa';

export interface Params {
  algorithm: Algorithm;
  /** Taux d'apprentissage α ∈ ]0, 1]. */
  alpha: number;
  /** Facteur d'actualisation γ ∈ [0, 1[. */
  gamma: number;
  /** ε initial (probabilité d'action aléatoire). */
  epsilon: number;
  /** Multiplicateur appliqué à ε à la fin de chaque épisode. */
  epsilonDecay: number;
  /** Plancher de ε. */
  epsilonMin: number;
  /** Probabilité que l'action exécutée soit remplacée par une direction au hasard. */
  slip: number;
  rewards: Rewards;
  /** Nombre maximal de pas avant de couper un épisode. */
  maxSteps: number;
}

export const DEFAULT_PARAMS: Params = {
  algorithm: 'qlearning',
  alpha: 0.3,
  gamma: 0.95,
  epsilon: 1,
  epsilonDecay: 0.97,
  epsilonMin: 0.01,
  slip: 0,
  rewards: { goal: 10, trap: -10, step: -0.1 },
  maxSteps: 200,
};

/** Générateur pseudo-aléatoire déterministe (mulberry32), utile pour des tests reproductibles. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Transition {
  next: number;
  reward: number;
  done: boolean;
}

export class GridWorld {
  readonly size: number;
  cells: Cell[];

  constructor(size: number, cells?: Cell[]) {
    this.size = size;
    this.cells = cells ? cells.slice() : new Array<Cell>(size * size).fill('empty');
  }

  /**
   * Construit une grille à partir de lignes de texte :
   * `.` vide, `#` mur, `T` piège, `S` départ, `G` arrivée.
   */
  static fromStrings(rows: string[]): GridWorld {
    const map: Record<string, Cell> = { '.': 'empty', '#': 'wall', T: 'trap', S: 'start', G: 'goal' };
    const size = rows.length;
    const cells: Cell[] = [];
    for (const row of rows) {
      if (row.length !== size) throw new Error('La grille doit être carrée');
      for (const ch of row) {
        const c = map[ch];
        if (!c) throw new Error(`Caractère inconnu : ${ch}`);
        cells.push(c);
      }
    }
    return new GridWorld(size, cells);
  }

  get nStates(): number {
    return this.size * this.size;
  }

  index(row: number, col: number): number {
    return row * this.size + col;
  }

  rowCol(s: number): [number, number] {
    return [Math.floor(s / this.size), s % this.size];
  }

  /** Indice de la case de départ, ou -1 s'il n'y en a pas. */
  startState(): number {
    return this.cells.indexOf('start');
  }

  hasGoal(): boolean {
    return this.cells.includes('goal');
  }

  isTerminal(s: number): boolean {
    const c = this.cells[s];
    return c === 'goal' || c === 'trap';
  }

  /** Place une case. Il ne peut y avoir qu'un seul départ : l'ancien est effacé. */
  setCell(s: number, cell: Cell): void {
    if (cell === 'start') {
      const old = this.startState();
      if (old >= 0) this.cells[old] = 'empty';
    }
    this.cells[s] = cell;
  }

  /**
   * Applique une action (déterministe). Un mur ou un bord de grille bloque :
   * l'agent reste sur place et paie quand même le coût du pas.
   */
  step(s: number, a: number, rewards: Rewards): Transition {
    const [r, c] = this.rowCol(s);
    const { dr, dc } = ACTIONS[a];
    const nr = r + dr;
    const nc = c + dc;
    let next = s;
    if (nr >= 0 && nr < this.size && nc >= 0 && nc < this.size) {
      const candidate = this.index(nr, nc);
      if (this.cells[candidate] !== 'wall') next = candidate;
    }
    const cell = this.cells[next];
    if (cell === 'goal') return { next, reward: rewards.goal, done: true };
    if (cell === 'trap') return { next, reward: rewards.trap, done: true };
    return { next, reward: rewards.step, done: false };
  }
}

export interface StepInfo {
  state: number;
  action: number;
  next: number;
  reward: number;
  done: boolean;
  /** Vrai si cet appel a clos l'épisode (arrivée, piège ou limite de pas). */
  episodeEnded: boolean;
  /** Récompense totale de l'épisode, renseignée seulement si episodeEnded. */
  episodeReward?: number;
}

/**
 * Agent tabulaire (Q-learning ou SARSA) qui apprend pas à pas.
 * Q[s * 4 + a] = estimation de la récompense cumulée (actualisée) si l'on fait `a` depuis `s`.
 */
export class Trainer {
  world: GridWorld;
  params: Params;
  q: Float64Array;
  epsilon: number;
  /** Nombre d'épisodes terminés. */
  episode = 0;
  totalSteps = 0;
  stepInEpisode = 0;
  episodeReward = 0;
  state = -1;
  /** Action déjà choisie pour l'état courant (nécessaire pour SARSA). */
  private pendingAction = -1;
  /** Cases visitées pendant l'épisode en cours. */
  path: number[] = [];
  /** Récompense totale de chaque épisode terminé. */
  history: number[] = [];
  private rng: () => number;

  constructor(world: GridWorld, params: Params, rng: () => number = Math.random) {
    this.world = world;
    this.params = { ...params, rewards: { ...params.rewards } };
    this.rng = rng;
    this.q = new Float64Array(world.nStates * N_ACTIONS);
    this.epsilon = params.epsilon;
    this.startEpisode();
  }

  /** Oublie tout ce qui a été appris. */
  reset(): void {
    this.q.fill(0);
    this.epsilon = this.params.epsilon;
    this.episode = 0;
    this.totalSteps = 0;
    this.history = [];
    this.startEpisode();
  }

  /** Recommence un épisode depuis la case départ (sans toucher à Q). */
  startEpisode(): void {
    this.state = this.world.startState();
    this.stepInEpisode = 0;
    this.episodeReward = 0;
    this.pendingAction = -1;
    this.path = this.state >= 0 ? [this.state] : [];
  }

  /** L'environnement est-il jouable (un départ et au moins une arrivée) ? */
  canRun(): boolean {
    return this.world.startState() >= 0 && this.world.hasGoal();
  }

  qValue(s: number, a: number): number {
    return this.q[s * N_ACTIONS + a];
  }

  /** V(s) = max_a Q(s, a) : « à quel point cette case est bonne ». */
  value(s: number): number {
    let best = -Infinity;
    for (let a = 0; a < N_ACTIONS; a++) best = Math.max(best, this.qValue(s, a));
    return best;
  }

  /** L'agent a-t-il déjà une estimation non nulle pour cette case ? */
  visited(s: number): boolean {
    for (let a = 0; a < N_ACTIONS; a++) if (this.qValue(s, a) !== 0) return true;
    return false;
  }

  /** Meilleure action selon Q (première en cas d'égalité, pour un affichage stable). */
  greedyAction(s: number): number {
    let best = 0;
    for (let a = 1; a < N_ACTIONS; a++) if (this.qValue(s, a) > this.qValue(s, best)) best = a;
    return best;
  }

  /** Meilleure action, égalités départagées au hasard (évite que l'agent tourne en rond au début). */
  private greedyActionRandomTies(s: number): number {
    const v = this.value(s);
    const ties: number[] = [];
    for (let a = 0; a < N_ACTIONS; a++) if (this.qValue(s, a) === v) ties.push(a);
    return ties[Math.floor(this.rng() * ties.length)];
  }

  /** Politique ε-greedy : explorer avec probabilité ε, sinon exploiter. */
  chooseAction(s: number): number {
    if (this.rng() < this.epsilon) return Math.floor(this.rng() * N_ACTIONS);
    return this.greedyActionRandomTies(s);
  }

  /**
   * Mise à jour d'une valeur Q.
   * Q-learning (off-policy) : cible = r + γ · max_a' Q(s', a')
   * SARSA     (on-policy)  : cible = r + γ · Q(s', a') où a' est l'action réellement choisie ensuite.
   */
  update(s: number, a: number, r: number, next: number, done: boolean, nextAction: number): void {
    let future = 0;
    if (!done) {
      future = this.params.algorithm === 'sarsa' ? this.qValue(next, nextAction) : this.value(next);
    }
    const target = r + this.params.gamma * future;
    const i = s * N_ACTIONS + a;
    this.q[i] += this.params.alpha * (target - this.q[i]);
  }

  /** Exécute un pas d'apprentissage. Renvoie null si la grille n'est pas jouable. */
  step(): StepInfo | null {
    if (!this.canRun()) return null;
    if (this.state < 0 || this.world.cells[this.state] === 'wall' || this.world.isTerminal(this.state)) {
      this.startEpisode();
    }
    const s = this.state;
    const action = this.pendingAction >= 0 ? this.pendingAction : this.chooseAction(s);

    // Glissance : le monde n'obéit pas toujours.
    const executed = this.rng() < this.params.slip ? Math.floor(this.rng() * N_ACTIONS) : action;
    const { next, reward, done } = this.world.step(s, executed, this.params.rewards);

    const nextAction = done ? -1 : this.chooseAction(next);
    this.update(s, action, reward, next, done, nextAction);

    this.state = next;
    this.pendingAction = this.params.algorithm === 'sarsa' ? nextAction : -1;
    this.path.push(next);
    this.stepInEpisode++;
    this.totalSteps++;
    this.episodeReward += reward;

    const info: StepInfo = { state: s, action, next, reward, done, episodeEnded: false };
    if (done || this.stepInEpisode >= this.params.maxSteps) {
      info.episodeEnded = true;
      info.episodeReward = this.episodeReward;
      this.endEpisode();
    }
    return info;
  }

  private endEpisode(): void {
    this.history.push(this.episodeReward);
    this.episode++;
    this.epsilon = Math.max(this.params.epsilonMin, this.epsilon * this.params.epsilonDecay);
    this.startEpisode();
  }

  /** Joue un épisode complet (utile pour les tests ou l'entraînement rapide). */
  runEpisode(): number {
    if (!this.canRun()) return 0;
    for (;;) {
      const info = this.step();
      if (!info) return 0;
      if (info.episodeEnded) return info.episodeReward ?? 0;
    }
  }

  /**
   * Chemin obtenu en suivant toujours la meilleure action depuis le départ (sans hasard).
   * S'arrête sur une case terminale, une boucle, ou une case encore inconnue.
   */
  greedyPath(maxLen = this.world.nStates * 2): number[] {
    let s = this.world.startState();
    if (s < 0) return [];
    const path = [s];
    const seen = new Set([s]);
    for (let i = 0; i < maxLen && !this.world.isTerminal(s); i++) {
      if (!this.visited(s)) break;
      const { next } = this.world.step(s, this.greedyAction(s), this.params.rewards);
      path.push(next);
      if (seen.has(next)) break;
      seen.add(next);
      s = next;
    }
    return path;
  }
}
