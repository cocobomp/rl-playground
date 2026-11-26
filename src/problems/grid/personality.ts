// Couche « haut niveau » : des traits de caractère en français courant, traduits en paramètres techniques.
// Aucune dépendance au DOM (testé directement).
import type { Settings } from './config';

export interface Level {
  /** Nom affiché (ex. « prévoyant »). */
  label: string;
  /** Applique ce niveau aux réglages techniques. */
  apply: (s: Settings) => void;
  /** Les réglages techniques correspondent-ils exactement à ce niveau ? */
  matches: (s: Settings) => boolean;
}

export interface Trait {
  id: string;
  label: string;
  /** Une ligne : ce que ce trait change dans le comportement, et quoi observer. */
  help: string;
  /** « segmented » : quelques boutons ; « range » : curseur à crans. */
  kind: 'segmented' | 'range';
  /** Étiquettes des deux extrémités d’un curseur. */
  ends?: [string, string];
  levels: Level[];
  /** Valeurs techniques actuelles, lisibles (ex. « γ = 0,95 »). */
  describe: (s: Settings) => string;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
/** Nombre à la française : virgule décimale. */
export const fr = (v: number, digits = 2) => v.toFixed(digits).replace('.', ',').replace('-', '−');

/** Fabrique des niveaux qui ne règlent qu’un seul nombre. */
function numberLevels(
  labels: string[],
  values: number[],
  get: (s: Settings) => number,
  set: (s: Settings, v: number) => void,
): Level[] {
  return values.map((v, i) => ({
    label: labels[i],
    apply: (s) => set(s, v),
    matches: (s) => near(get(s), v),
  }));
}

export const GAMMA_LEVELS = [0.5, 0.7, 0.85, 0.95, 0.99];
export const STEP_LEVELS = [0, -0.05, -0.1, -0.5, -1];
export const ALPHA_LEVELS = [0.05, 0.1, 0.3, 0.6, 1];
export const SLIP_LEVELS = [0, 0.1, 0.2, 0.35];

export const TRAITS: Trait[] = [
  {
    id: 'curiosity',
    label: 'Curiosité',
    kind: 'segmented',
    help: 'À quel point l’agent essaie des directions au hasard pour découvrir le monde, au lieu de suivre ce qu’il croit être le meilleur chemin.',
    levels: [
      {
        label: 'faible',
        apply: (s) => { s.epsilon = 0.1; s.epsilonDecay = 1; },
        matches: (s) => near(s.epsilon, 0.1) && near(s.epsilonDecay, 1),
      },
      {
        label: 'moyenne',
        apply: (s) => { s.epsilon = 1; s.epsilonDecay = 0.97; },
        matches: (s) => near(s.epsilon, 1) && near(s.epsilonDecay, 0.97),
      },
      {
        label: 'forte',
        apply: (s) => { s.epsilon = 1; s.epsilonDecay = 0.997; },
        matches: (s) => near(s.epsilon, 1) && near(s.epsilonDecay, 0.997),
      },
    ],
    describe: (s) =>
      s.epsilonDecay >= 1
        ? `ε = ${fr(s.epsilon)} en permanence (${Math.round(s.epsilon * 100)} % de pas au hasard, toujours)`
        : `ε part de ${fr(s.epsilon)} et est multiplié par ${fr(s.epsilonDecay, 3)} à chaque épisode (minimum ${fr(s.epsilonMin)})`,
  },
  {
    id: 'vision',
    label: 'Vision à long terme',
    kind: 'range',
    ends: ['myope', 'prévoyant'],
    help: 'Myope : une récompense lointaine ne compte presque pas, il se contente de ce qui est proche. Prévoyant : il accepte un long trajet pour un meilleur gain.',
    levels: numberLevels(['très myope', 'myope', 'équilibré', 'prévoyant', 'très prévoyant'], GAMMA_LEVELS, (s) => s.gamma, (s, v) => (s.gamma = v)),
    describe: (s) => `γ = ${fr(s.gamma)} : une récompense 10 pas plus loin ne compte que pour ${Math.round(Math.pow(s.gamma, 10) * 100)} %`,
  },
  {
    id: 'prudence',
    label: 'Prudence',
    kind: 'segmented',
    help: 'Le prudent tient compte de ses propres faux pas (ses moments d’exploration) et redoute les pièges : il garde ses distances avec eux, quitte à faire un détour.',
    levels: [
      {
        label: 'téméraire',
        apply: (s) => { s.algorithm = 'qlearning'; s.rewards.trap = -10; },
        matches: (s) => s.algorithm === 'qlearning' && near(s.rewards.trap, -10),
      },
      {
        label: 'mesuré',
        apply: (s) => { s.algorithm = 'qlearning'; s.rewards.trap = -100; },
        matches: (s) => s.algorithm === 'qlearning' && near(s.rewards.trap, -100),
      },
      {
        label: 'prudent',
        apply: (s) => { s.algorithm = 'sarsa'; s.rewards.trap = -100; },
        matches: (s) => s.algorithm === 'sarsa' && near(s.rewards.trap, -100),
      },
    ],
    describe: (s) =>
      `${s.algorithm === 'sarsa' ? 'SARSA (apprend en comptant ses propres écarts)' : 'Q-learning (suppose qu’il jouera parfaitement)'}, piège = ${fr(s.rewards.trap, 0)}`,
  },
  {
    id: 'impatience',
    label: 'Impatience',
    kind: 'range',
    ends: ['flâneur', 'pressé'],
    help: 'Chaque pas coûte un peu : un agent pressé cherche le chemin le plus court et préfère un petit gain rapide à un long voyage.',
    levels: numberLevels(['flâneur', 'détendu', 'normal', 'pressé', 'très pressé'], STEP_LEVELS, (s) => s.rewards.step, (s, v) => (s.rewards.step = v)),
    describe: (s) => (s.rewards.step === 0 ? 'coût par pas = 0 (marcher est gratuit)' : `coût par pas = ${fr(s.rewards.step)}`),
  },
  {
    id: 'memory',
    label: 'Mémoire',
    kind: 'range',
    ends: ['retient lentement', 'change d’avis vite'],
    help: 'Lentement : chaque expérience ne corrige qu’un peu ses estimations (stable mais long). Vite : la dernière expérience écrase tout (rapide mais instable, surtout si le sol glisse).',
    levels: numberLevels(['très lente', 'lente', 'modérée', 'rapide', 'instantanée'], ALPHA_LEVELS, (s) => s.alpha, (s, v) => (s.alpha = v)),
    describe: (s) => `α = ${fr(s.alpha)} : chaque expérience corrige ${Math.round(s.alpha * 100)} % de l’écart entre attente et réalité`,
  },
  {
    id: 'world',
    label: 'Monde imprévisible',
    kind: 'range',
    ends: ['sol stable', 'sol très glissant'],
    help: 'Sur un sol glissant, l’agent part parfois dans une direction au hasard malgré lui : frôler un piège devient vraiment dangereux, même pour Q-learning.',
    levels: numberLevels(['stable', 'un peu glissant', 'glissant', 'très glissant'], SLIP_LEVELS, (s) => s.slip, (s, v) => (s.slip = v)),
    describe: (s) => `glissance = ${Math.round(s.slip * 100)} % des actions remplacées par une direction au hasard`,
  },
];

/** Indice du niveau correspondant aux réglages, ou -1 (« personnalisé »). */
export function detectLevel(trait: Trait, s: Settings): number {
  return trait.levels.findIndex((l) => l.matches(s));
}

/** Niveau de chaque trait pour ces réglages (-1 = personnalisé). */
export function detectAll(s: Settings): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of TRAITS) out[t.id] = detectLevel(t, s);
  return out;
}

/** Applique une personnalité complète : { curiosity: 0, vision: 4, … } (indices de niveaux). */
export function applyPersonality(s: Settings, levels: Partial<Record<string, number>>): void {
  for (const t of TRAITS) {
    const i = levels[t.id];
    if (i !== undefined) t.levels[i].apply(s);
  }
}
