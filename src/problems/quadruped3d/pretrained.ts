// Cerveaux pré-entraînés hors ligne (scripts/quadruped3d/train.ts), importés tels quels dans le paquet.
import healthyRaw from './pretrained/healthy.json?raw';
import brokenRaw from './pretrained/broken.json?raw';
import storyRaw from './pretrained/story.json?raw';
import { PARAM_COUNT } from './agent';

export interface PretrainedBrain {
  sizes: number[];
  world: string;
  generation: number;
  distance: number;
  fitness: number;
  /** Généalogie de l'entraînement hors ligne. */
  history: string;
  params: number[];
}

/** Un moment clé de l'entraînement hors ligne (génération 0, premier essai sans chute, paliers…). */
export interface StoryMoment {
  generation: number;
  distance: number;
  fell: boolean;
  /** Raisons, séparées par des virgules : start, nofall, m1, m3…, final. */
  kind: string;
  params: number[];
}

function check(params: number[], what: string): void {
  if (params.length !== PARAM_COUNT) throw new Error(`${what} : cerveau pré-entraîné incompatible avec l’architecture actuelle`);
}

function parse(raw: string): PretrainedBrain {
  const b = JSON.parse(raw) as PretrainedBrain;
  check(b.params, b.world);
  return b;
}

/** Cerveau entraîné sur le robot intact. */
export const PRETRAINED_HEALTHY = parse(healthyRaw);
/** Cerveau adapté à la patte avant gauche cassée (entraîné à partir du précédent). */
export const PRETRAINED_BROKEN = parse(brokenRaw);
/** Quelques cerveaux intermédiaires de l'entraînement hors ligne du robot intact, du début à la fin. */
export const PRETRAINED_STORY: StoryMoment[] = (JSON.parse(storyRaw) as StoryMoment[]).filter((m) => {
  check(m.params, 'histoire');
  return true;
});

/** Titre lisible d'un moment de l'histoire hors ligne. */
export function storyLabel(m: StoryMoment): string {
  const d = `${m.distance.toFixed(1).replace('.', ',').replace('-', '−')} m`;
  const kinds = m.kind.split(',');
  const g = `Génération ${m.generation}`;
  if (kinds.includes('start')) return `${g} : ${m.fell ? 'il tombe' : 'il piétine'} (${d})`;
  if (kinds.includes('final')) return `${g} : cerveau final, ${d}`;
  const ms = kinds.filter((k) => /^m\d+$/.test(k)).map((k) => Number(k.slice(1)));
  if (kinds.includes('nofall')) return `${g} : premier essai sans chute, ${d}`;
  if (ms.length) return `${g} : cap des ${Math.max(...ms)} m franchi (${d})`;
  return `${g} : ${d}`;
}
