import { DEFAULT_PARAMS, DEFAULT_SMALL_REWARD, Params } from './rl';
import { applyPersonality } from './personality';

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

/** Remet des réglages à leurs valeurs par défaut (en place). */
export function resetSettings(s: Settings): void {
  Object.assign(s, structuredClone(DEFAULT_SETTINGS));
}

export interface Scenario {
  label: string;
  /** L’histoire racontée, et ce qu’il faut observer. */
  description: string;
  map: string[];
  /** Niveaux des traits de personnalité (indices, voir personality.ts). */
  personality: Partial<Record<string, number>>;
  episodes: number;
  /** Ajustements techniques supplémentaires. */
  extra?: Partial<Omit<Settings, 'rewards'>> & { rewards?: Partial<Settings['rewards']> };
}

/**
 * Cartes « histoires ». Les comportements annoncés sont vérifiés par tests/grid-scenarios.test.ts.
 * Rappel des niveaux : curiosity 0 faible / 1 moyenne / 2 forte ; vision 0..4 (γ 0,5 → 0,99) ;
 * prudence 0 téméraire / 1 mesuré / 2 prudent ; impatience 0..4 (coût 0 → −1) ; memory 0..4 (α 0,05 → 1) ; world 0..3.
 */
export const SCENARIOS: Record<string, Scenario> = {
  cliff: {
    label: 'La falaise',
    description:
      'Le chemin le plus court longe le bord d’une falaise (les pièges du bas). L’agent garde 10 % de pas au hasard. ' +
      'En « mesuré » (Q-learning), le meilleur chemin en pointillés colle au bord : Q-learning évalue le chemin comme s’il ne faisait jamais d’écart. ' +
      'Passez Prudence sur « prudent » (SARSA, même pénalité) puis réinitialisez : il apprend à marcher un ou deux rangs plus haut, car il sait qu’un écart au hasard le ferait tomber. ' +
      'Lancez « Comparer » (sous le graphique) pour voir les deux en même temps : pendant l’apprentissage, SARSA gagne en moyenne davantage, car Q-learning tombe plus souvent de la falaise en explorant.',
    map: ['........', '........', '........', '........', '........', '........', '........', 'STTTTTTG'],
    personality: { curiosity: 0, vision: 4, prudence: 1, impatience: 4, memory: 2, world: 0 },
    episodes: 500,
  },
  detour: {
    label: 'Le grand détour',
    description:
      'Un couloir de 7 pas bordé de pièges, ou un détour de 13 pas loin de tout danger. En « téméraire », l’agent fonce dans le couloir et y tombe parfois quand il explore. ' +
      'Passez Prudence sur « prudent » et réinitialisez : il choisit le détour. ' +
      'Autre expérience : restez « téméraire » mais rendez le monde « un peu glissant » : même Q-learning finit par préférer le détour, car le sol peut le pousser dans un piège.',
    map: ['........', '.######.', '.#....#.', '.#TTTT#.', 'S......G', '.#TTTT#.', '.######.', '........'],
    personality: { curiosity: 0, vision: 3, prudence: 0, impatience: 2, memory: 2, world: 0 },
    episodes: 300,
  },
  treasures: {
    label: 'Deux trésors',
    description:
      'Un petit trésor (+3) à 2 pas, un grand (+10) à 6 pas. L’agent « myope » (γ = 0,7) prend le petit : pour lui, +10 dans 6 pas vaut 10 × 0,7⁵ ≈ 1,7, moins que +3 dans 2 pas (3 × 0,7 = 2,1). ' +
      'Passez la Vision à long terme sur « équilibré » ou « prévoyant » et réinitialisez : il fait le chemin jusqu’au grand trésor. ' +
      'La curiosité est forte : il faut avoir déjà découvert le grand trésor pour pouvoir le préférer.',
    map: ['........', '........', '..#.....', '.g.S....', '..#.....', '........', '......G.', '........'],
    personality: { curiosity: 2, vision: 1, prudence: 0, impatience: 0, memory: 2, world: 0 },
    episodes: 400,
  },
  empty: {
    label: 'Pièce vide',
    description:
      'Une pièce sans obstacle : l’agent apprend en quelques dizaines d’épisodes. Les cases visitées virent d’abord au rouge (chaque pas coûte), ' +
      'puis le vert se propage depuis l’arrivée vers le départ, épisode après épisode : la récompense « remonte » le chemin, case par case.',
    map: ['S.......', '........', '........', '........', '........', '........', '........', '.......G'],
    personality: { curiosity: 1, vision: 3, prudence: 0, impatience: 2, memory: 3, world: 0 },
    episodes: 100,
  },
};

/** Réglages complets d’un scénario (à partir des valeurs par défaut). */
export function scenarioSettings(sc: Scenario, base: Settings = DEFAULT_SETTINGS): Settings {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.speed = base.speed;
  applyPersonality(s, sc.personality);
  s.episodes = sc.episodes;
  if (sc.extra) {
    const { rewards, ...rest } = sc.extra;
    Object.assign(s, rest);
    Object.assign(s.rewards, rewards);
  }
  return s;
}

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
    help: 'Gain en atteignant le grand trésor ★ (l’arrivée). C’est l’objectif que l’agent cherche à maximiser.',
    get: (s) => s.rewards.goal, set: (s, v) => (s.rewards.goal = v), format: (v) => `+${v}`,
  },
  {
    id: 'rSmall', label: 'Récompense du petit trésor', min: 0, max: 50, step: 1,
    help: 'Gain en atteignant un petit trésor (case verte ronde, l’épisode s’arrête aussi). Utile pour comparer un gain proche et un gain lointain.',
    get: (s) => s.rewards.small ?? DEFAULT_SMALL_REWARD, set: (s, v) => (s.rewards.small = v), format: (v) => `+${v}`,
  },
  {
    id: 'rTrap', label: 'Pénalité de piège', min: -100, max: 0, step: 1,
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
    help: 'Un épisode = une tentative, du départ jusqu’à un trésor, un piège ou 200 pas. L’entraînement s’arrête après ce nombre.',
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
