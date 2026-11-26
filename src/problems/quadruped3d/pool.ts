// Groupe de workers d'évaluation (sans DOM : seule l'API Worker est utilisée).
// Les candidats sont distribués un par un aux workers libres et les résultats rangés par index :
// le résultat d'une génération ne dépend ni du nombre de workers ni de l'ordre d'arrivée.
import type { EpisodeResult, RewardParams, WorldParams } from './env';
import type { FromWorker, ToWorker } from './protocol';

/** Nombre de workers conseillé : cœurs − 1 (un cœur pour la page), entre 1 et 6. */
export function defaultWorkerCount(hardwareConcurrency: number | undefined): number {
  return Math.max(1, Math.min(6, (hardwareConcurrency || 2) - 1));
}

interface Slot {
  worker: Worker;
  /** Index du candidat en cours (−1 : libre). */
  job: number;
  retire: boolean;
}

interface Batch {
  id: number;
  cands: Float64Array[];
  world: WorldParams;
  reward: RewardParams;
  results: (EpisodeResult | undefined)[];
  next: number;
  done: number;
  resolve: (r: EpisodeResult[] | null) => void;
}

export class EvalPool {
  private slots: Slot[] = [];
  private batch: Batch | null = null;
  private batchId = 0;
  private disposed = false;
  onError: (message: string) => void = () => {};

  constructor(private factory: () => Worker, size: number) {
    this.setSize(size);
  }

  get size(): number {
    return this.slots.filter((s) => !s.retire).length;
  }

  /** Change le nombre de workers (les workers en trop finissent leur essai puis s'arrêtent). */
  setSize(n: number): void {
    if (this.disposed) return;
    n = Math.max(1, Math.round(n));
    // Réactive d'abord des workers en cours de retrait.
    for (const s of this.slots) if (s.retire && this.size < n) s.retire = false;
    while (this.size < n) this.spawn();
    let extra = this.size - n;
    for (const s of [...this.slots].reverse()) {
      if (extra <= 0) break;
      if (s.retire) continue;
      s.retire = true;
      extra--;
      if (s.job < 0) this.kill(s);
    }
  }

  private spawn(): void {
    const worker = this.factory();
    const slot: Slot = { worker, job: -1, retire: false };
    worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(slot, ev.data);
    worker.onerror = (ev) => {
      ev.preventDefault?.();
      this.onError('Un worker d’évaluation a échoué.');
    };
    this.slots.push(slot);
    this.feed(slot);
  }

  private kill(s: Slot): void {
    s.worker.terminate();
    this.slots = this.slots.filter((x) => x !== s);
  }

  private onMessage(slot: Slot, m: FromWorker): void {
    if (m.type === 'error') {
      // Le worker reste utilisable : on le libère pour qu'une prochaine génération ne l'attende pas indéfiniment.
      slot.job = -1;
      this.onError(m.message);
      return;
    }
    if (m.type === 'result') {
      slot.job = -1;
      const b = this.batch;
      if (b && m.batch === b.id && b.results[m.index] === undefined) {
        b.results[m.index] = m.result;
        b.done++;
        if (b.done === b.cands.length) {
          this.batch = null;
          b.resolve(b.results as EpisodeResult[]);
        }
      }
    }
    if (slot.retire) {
      this.kill(slot);
      return;
    }
    this.feed(slot);
  }

  private feed(slot: Slot): void {
    const b = this.batch;
    if (!b || slot.job >= 0 || slot.retire) return;
    const index = b.next < b.cands.length ? b.next++ : -1;
    if (index < 0) return;
    slot.job = index;
    const msg: ToWorker = { type: 'eval', batch: b.id, index, params: b.cands[index], world: b.world, reward: b.reward };
    slot.worker.postMessage(msg);
  }

  /** Évalue tous les candidats ; renvoie null si l'évaluation a été annulée. */
  run(cands: Float64Array[], world: WorldParams, reward: RewardParams): Promise<EpisodeResult[] | null> {
    this.cancel();
    return new Promise((resolve) => {
      this.batch = {
        id: ++this.batchId,
        cands,
        world: { ...world },
        reward: { ...reward },
        results: new Array(cands.length),
        next: 0,
        done: 0,
        resolve,
      };
      for (const s of this.slots) this.feed(s);
    });
  }

  /** Abandonne la génération en cours (les résultats en vol seront ignorés). */
  cancel(): void {
    const b = this.batch;
    this.batch = null;
    b?.resolve(null);
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    for (const s of this.slots) s.worker.terminate();
    this.slots = [];
  }
}
