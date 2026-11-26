// Worker du mode turbo : entraîne des épisodes entiers hors du fil principal, puis renvoie les poids.
import { mulberry32 } from '../../shared/rng';
import { AgentConfig, EpisodeResult, Trainer } from './agent';
import { PhysicsParams } from './env';

export interface TurboRequest {
  gen: number;
  cfg: AgentConfig;
  physics: PhysicsParams;
  weights: Float64Array;
  seed: number;
  maxEpisodes: number;
  budgetMs: number;
}

export interface TurboReply {
  gen: number;
  weights: Float64Array;
  results: EpisodeResult[];
  /** Trajectoire du dernier épisode : x, v alternés. */
  traj: Float32Array;
}

export function runTurboBatch(req: TurboRequest): TurboReply {
  const tr = new Trainer(req.cfg, req.physics, mulberry32(req.seed));
  tr.agent.setWeights(req.weights);
  const t0 = performance.now();
  let traj: number[] = [];
  while (tr.history.length < req.maxEpisodes && performance.now() - t0 < req.budgetMs) {
    tr.runEpisode();
    traj = tr.traj;
  }
  return { gen: req.gen, weights: tr.agent.w, results: tr.history, traj: Float32Array.from(traj) };
}

// Uniquement dans un vrai worker (pas lors d’un import par les tests).
const scope = globalThis as unknown as { WorkerGlobalScope?: unknown; postMessage?: (m: unknown, t?: Transferable[]) => void; onmessage?: unknown };
if (typeof scope.WorkerGlobalScope !== 'undefined') {
  (self as unknown as { onmessage: (e: MessageEvent<TurboRequest>) => void }).onmessage = (e) => {
    const reply = runTurboBatch(e.data);
    (self as unknown as { postMessage: (m: unknown, t: Transferable[]) => void }).postMessage(reply, [reply.weights.buffer, reply.traj.buffer]);
  };
}
