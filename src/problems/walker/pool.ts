// Coordination des workers d'entraînement depuis la page (aucun calcul lourd ici).
import type { EpisodeResult, Objectives, WorldConfig } from './env';
import type { ESSettings } from './agent';
import type { FromWorker, Scored, ToWorker } from './protocol';

export interface GenerationSummary {
  generation: number;
  meanFitness: number;
  meanDistance: number;
  best: EpisodeResult;
  bestParams: number[];
  theta: EpisodeResult;
  thetaParams: number[];
  /** Durée de calcul de la génération (ms, mur). */
  ms: number;
}

export class TrainerPool {
  readonly workers: Worker[] = [];
  failed = false;
  private runId = 0;
  private running = false;
  private awaiting = false;
  private pendingFitness: number[] | null = null;
  private inbox: FromWorker[] = [];
  private t0 = 0;
  generation = 0;
  /** Nombre de workers qui calculent (les autres restent synchronisés sans évaluer). */
  private active = 1;

  constructor(
    count: number,
    private onGeneration: (s: GenerationSummary) => void,
    private onError: () => void,
  ) {
    try {
      for (let i = 0; i < count; i++) {
        const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (ev: MessageEvent<FromWorker>) => this.receive(ev.data);
        w.onerror = (e) => {
          e.preventDefault();
          this.fail();
        };
        this.workers.push(w);
      }
    } catch {
      this.fail();
    }
  }

  private fail() {
    if (this.failed) return;
    this.failed = true;
    this.running = false;
    this.onError();
  }

  get isRunning(): boolean {
    return this.running;
  }

  private send(m: ToWorker) {
    for (const w of this.workers) w.postMessage(m);
  }

  /** (Re)démarre une stratégie d'évolution à partir des paramètres init. */
  start(init: ArrayLike<number>, config: WorldConfig, objectives: Objectives, es: ESSettings, seed: number): void {
    this.runId++;
    this.awaiting = false;
    this.pendingFitness = null;
    this.inbox = [];
    this.generation = 0;
    const initArr = Array.from(init);
    this.workers.forEach((w, index) =>
      w.postMessage({
        type: 'init',
        runId: this.runId,
        index,
        seed,
        init: initArr,
        config: { ...config },
        objectives: { ...objectives },
        es: { ...es },
      } satisfies ToWorker),
    );
    if (this.running) this.dispatch();
  }

  setObjectives(o: Objectives): void {
    this.send({ type: 'objectives', objectives: { ...o } });
  }

  /** Curiosité, vitesse d'apprentissage, taille de population : pris en compte à la génération suivante. */
  setHyper(es: ESSettings): void {
    this.send({ type: 'hyper', es: { ...es } });
  }

  /** Arrête et oublie la génération en cours de calcul (son résultat sera ignoré). Il faudra un start() pour reprendre. */
  stop(): void {
    this.running = false;
    this.runId++;
    this.awaiting = false;
    this.inbox = [];
  }

  /** Nombre de workers mis au travail à partir de la génération suivante (1 … nombre de workers). */
  setActive(n: number): void {
    this.active = Math.max(1, Math.min(this.workers.length || 1, Math.round(n)));
  }

  get activeCount(): number {
    return Math.min(this.active, this.workers.length);
  }

  setRunning(on: boolean): void {
    this.running = on && !this.failed && this.workers.length > 0;
    if (this.running && !this.awaiting) this.dispatch();
  }

  private dispatch() {
    this.awaiting = true;
    this.inbox = [];
    this.t0 = performance.now();
    this.send({ type: 'gen', runId: this.runId, fitness: this.pendingFitness, active: this.activeCount });
  }

  private receive(m: FromWorker) {
    if (m.runId !== this.runId || !this.awaiting) return;
    this.inbox.push(m);
    if (this.inbox.length < this.workers.length) return;
    const scored: Scored[] = this.inbox.flatMap((x) => x.scored);
    scored.sort((a, b) => a.i - b.i);
    const fitness = scored.map((s) => s.r.fitness);
    let best = this.inbox[0];
    let bestR: EpisodeResult | null = null;
    for (const msg of this.inbox) {
      const s = msg.scored.find((x) => x.i === msg.bestI);
      if (s && (!bestR || s.r.fitness > bestR.fitness)) {
        bestR = s.r;
        best = msg;
      }
    }
    const theta = this.inbox.find((x) => x.theta)!.theta!;
    this.pendingFitness = fitness;
    this.awaiting = false;
    this.generation = m.generation;
    const n = scored.length;
    const summary: GenerationSummary = {
      generation: m.generation,
      meanFitness: fitness.reduce((a, b) => a + b, 0) / n,
      meanDistance: scored.reduce((a, s) => a + s.r.distance, 0) / n,
      best: bestR!,
      bestParams: best.bestParams,
      theta: theta.r,
      thetaParams: theta.params,
      ms: performance.now() - this.t0,
    };
    if (this.running) this.dispatch();
    this.onGeneration(summary);
  }

  dispose(): void {
    this.running = false;
    this.runId++;
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
  }
}
