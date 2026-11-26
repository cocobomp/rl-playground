import { DEFAULT_PARAMS, Params } from './rl';

/** Carte par défaut : un chemin court qui frôle les pièges, et un détour sûr. */
export const DEFAULT_MAP = [
  'S...#...',
  '.##.#.#.',
  '.#..T.#.',
  '.#.##...',
  '...#..T.',
  '.T.#.##.',
  '.#...T..',
  '...#...G',
];

export interface Settings extends Params {
  /** Vitesse d'animation de 1 (lent) à 10 (maximum). */
  speed: number;
  /** Nombre d'épisodes d'entraînement avant arrêt automatique. */
  episodes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  ...DEFAULT_PARAMS,
  rewards: { ...DEFAULT_PARAMS.rewards },
  speed: 6,
  episodes: 300,
};

export interface Preset {
  label: string;
  description: string;
  settings: Partial<Omit<Settings, 'rewards'>> & { rewards?: Partial<Settings['rewards']> };
}

export const PRESETS: Record<string, Preset> = {
  explore: {
    label: 'Explore trop',
    description:
      'ε = 1 et aucune décroissance : l’agent joue toujours au hasard. La courbe reste plate et basse, il ne profite jamais de ce qu’il sait. ' +
      'Avec Q-learning, regardez pourtant les flèches : elles finissent souvent par indiquer le bon chemin, car Q-learning apprend la meilleure stratégie même en se promenant au hasard.',
    settings: { alpha: 0.3, gamma: 0.95, epsilon: 1, epsilonDecay: 1, slip: 0, episodes: 300 },
  },
  fast: {
    label: 'Apprend trop vite',
    description:
      'α = 1 (chaque expérience écrase la précédente), ε chute en quelques épisodes, et le monde est glissant (20 % des actions partent au hasard). ' +
      'Les valeurs sautent d’un extrême à l’autre, l’agent se fige trop tôt sur un chemin et la courbe reste chaotique.',
    settings: { alpha: 1, gamma: 0.95, epsilon: 0.5, epsilonDecay: 0.8, slip: 0.2, episodes: 300 },
  },
  balanced: {
    label: 'Équilibré',
    description:
      'α modéré, γ élevé, beaucoup d’exploration au début qui diminue progressivement. ' +
      'La courbe monte puis se stabilise : l’agent a trouvé un chemin court et sûr.',
    settings: { alpha: 0.3, gamma: 0.95, epsilon: 1, epsilonDecay: 0.97, slip: 0, episodes: 300 },
  },
};

export interface SliderDef {
  id: string;
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  group?: string;
  get: (s: Settings) => number;
  set: (s: Settings, v: number) => void;
  format?: (v: number) => string;
}

const SPEED_LABELS = ['', 'très lent', 'lent', 'lent', 'moyen', 'moyen', 'rapide', 'rapide', 'très rapide', 'turbo', 'maximum'];

export const SLIDERS: SliderDef[] = [
  {
    id: 'alpha', label: 'Taux d’apprentissage (α)', min: 0.01, max: 1, step: 0.01,
    help: 'À quel point une nouvelle expérience remplace l’ancienne estimation. Haut : apprend vite mais instable. Bas : stable mais lent.',
    get: (s) => s.alpha, set: (s, v) => (s.alpha = v),
  },
  {
    id: 'gamma', label: 'Facteur d’actualisation (γ)', min: 0, max: 0.99, step: 0.01,
    help: 'Importance des récompenses futures. Proche de 1 : l’agent voit loin. Proche de 0 : il ne pense qu’au prochain pas.',
    get: (s) => s.gamma, set: (s, v) => (s.gamma = v),
  },
  {
    id: 'epsilon', label: 'Exploration (ε)', min: 0, max: 1, step: 0.01,
    help: 'Probabilité de tenter une direction au hasard au lieu de la meilleure connue. Sans exploration, l’agent ne découvre rien de nouveau.',
    get: (s) => s.epsilon, set: (s, v) => (s.epsilon = v),
  },
  {
    id: 'epsilonDecay', label: 'Décroissance de ε', min: 0.8, max: 1, step: 0.005,
    help: 'ε est multiplié par ce nombre après chaque épisode : on explore beaucoup au début, puis de moins en moins. 1 = ε ne baisse jamais.',
    get: (s) => s.epsilonDecay, set: (s, v) => (s.epsilonDecay = v), format: (v) => v.toFixed(3),
  },
  {
    id: 'slip', label: 'Glissance du sol', min: 0, max: 0.5, step: 0.01,
    help: 'Probabilité que l’agent parte dans une direction au hasard malgré lui : un monde imprévisible, où frôler un piège devient risqué.',
    get: (s) => s.slip, set: (s, v) => (s.slip = v), format: (v) => `${Math.round(v * 100)} %`,
  },
  {
    id: 'rGoal', label: 'Récompense d’arrivée', min: 0, max: 50, step: 1, group: 'Récompenses',
    help: 'Gain en atteignant ★. C’est l’objectif que l’agent cherche à maximiser.',
    get: (s) => s.rewards.goal, set: (s, v) => (s.rewards.goal = v), format: (v) => `+${v}`,
  },
  {
    id: 'rTrap', label: 'Pénalité de piège', min: -50, max: 0, step: 1,
    help: 'Perte en tombant dans un piège ✕ (l’épisode s’arrête). Plus elle est forte, plus l’agent s’en éloigne.',
    get: (s) => s.rewards.trap, set: (s, v) => (s.rewards.trap = v), format: (v) => `${v}`,
  },
  {
    id: 'rStep', label: 'Coût par pas', min: -2, max: 0, step: 0.05,
    help: 'Petite perte à chaque déplacement : pousse l’agent à trouver le chemin le plus court au lieu de flâner.',
    get: (s) => s.rewards.step, set: (s, v) => (s.rewards.step = v), format: (v) => v.toFixed(2),
  },
  {
    id: 'speed', label: 'Vitesse d’animation', min: 1, max: 10, step: 1, group: 'Simulation',
    help: 'Lent : on suit chaque pas. Rapide : des centaines de pas par seconde pour voir l’apprentissage global.',
    get: (s) => s.speed, set: (s, v) => (s.speed = v), format: (v) => SPEED_LABELS[v] ?? String(v),
  },
  {
    id: 'episodes', label: 'Nombre d’épisodes', min: 10, max: 2000, step: 10,
    help: 'Un épisode = une tentative, du départ jusqu’à l’arrivée, un piège ou 200 pas. L’entraînement s’arrête après ce nombre.',
    get: (s) => s.episodes, set: (s, v) => (s.episodes = v), format: (v) => String(v),
  },
];

/**
 * Vitesse → [délai entre deux pas en ms, nombre de pas par image].
 * Les vitesses basses animent chaque pas, les hautes en enchaînent beaucoup par image.
 */
export function speedToTiming(speed: number): { delay: number; stepsPerFrame: number } {
  const table: Array<[number, number]> = [
    [600, 1], [350, 1], [180, 1], [90, 1], [40, 1], [0, 1], [0, 4], [0, 20], [0, 100], [0, 600],
  ];
  const [delay, stepsPerFrame] = table[Math.min(Math.max(Math.round(speed), 1), 10) - 1];
  return { delay, stepsPerFrame };
}
