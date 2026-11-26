// Boucle d'entraînement de la page : la stratégie d'évolution (ask/tell) tourne ici, les essais
// sont joués en parallèle par les workers du groupe (pool.ts). Sans DOM.
import { EsHyper, GenerationReport, Trainer } from './agent';
import type { RewardParams, WorldParams } from './env';
import type { EvalPool } from './pool';

export class TrainingLoop {
  trainer: Trainer | null = null;
  running = false;
  private looping = false;
  /** Incrémenté à chaque changement de monde ou de note : les résultats en vol sont alors jetés. */
  private version = 0;
  private stamps: number[] = [];
  onGeneration: (r: GenerationReport, params: Float64Array, world: WorldParams) => void = () => {};

  constructor(private pool: EvalPool, private now: () => number = () => performance.now()) {}

  reset(brain: ArrayLike<number>, world: WorldParams, reward: RewardParams, hyper: EsHyper, seed: number): void {
    this.version++;
    this.pool.cancel();
    this.trainer = new Trainer(brain, world, reward, hyper, seed);
    this.stamps = [];
  }

  setWorld(w: WorldParams): void {
    if (!this.trainer) return;
    this.trainer.world = { ...w };
    this.version++;
    this.pool.cancel();
  }

  setReward(r: RewardParams): void {
    if (!this.trainer) return;
    this.trainer.reward = { ...r };
    this.version++;
    this.pool.cancel();
  }

  setHyper(h: Partial<EsHyper>): void {
    this.trainer?.setHyper(h);
  }

  start(): void {
    this.running = true;
    this.stamps = [];
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.pool.cancel();
  }

  /** Générations par seconde (moyenne glissante sur les dernières générations). */
  gensPerSecond(): number {
    const s = this.stamps;
    if (s.length < 2) return 0;
    const dt = (s[s.length - 1] - s[0]) / 1000;
    return dt > 0 ? (s.length - 1) / dt : 0;
  }

  private async loop(): Promise<void> {
    if (this.looping) return;
    this.looping = true;
    try {
      while (this.running && this.trainer) {
        const tr = this.trainer;
        const ver = this.version;
        const cands = tr.ask();
        const results = await this.pool.run(cands, tr.world, tr.reward);
        if (!results || ver !== this.version || tr !== this.trainer || !this.running) continue;
        const report = tr.finish(results);
        this.stamps.push(this.now());
        if (this.stamps.length > 12) this.stamps.shift();
        this.onGeneration(report, cands[0], { ...tr.world });
      }
    } finally {
      this.looping = false;
    }
  }
}
