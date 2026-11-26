// Textes et réglages de haut niveau du robot marcheur (aucun accès au DOM).
import { DEFAULT_OBJECTIVES, HEALTHY, Objectives, WorldConfig } from './env';
import { DEFAULT_ES, ESSettings } from './agent';

export type InterventionKey = keyof WorldConfig;

export interface Intervention {
  key: InterventionKey;
  label: string;
  /** Ce que ça change, en une ou deux phrases. */
  help: string;
  /** Libellé court pour les tableaux de mesures. */
  short: string;
}

export const INTERVENTIONS: Intervention[] = [
  {
    key: 'lockLeftKnee',
    label: 'Bloquer le genou gauche',
    short: 'genou G bloqué',
    help: 'Le genou gauche ne plie plus : il est figé presque tendu, comme dans une attelle, et son moteur est coupé. Le cerveau actuel continue d’envoyer des ordres à ce genou… qui ne répond plus.',
  },
  {
    key: 'weakRightLeg',
    label: 'Affaiblir la jambe droite',
    short: 'jambe D affaiblie',
    help: 'Les moteurs de la hanche et du genou droits ne gardent que 30 % de leur force : la jambe bouge encore, mais peine à porter le robot.',
  },
  {
    key: 'shortLeftLeg',
    label: 'Jambe gauche plus courte',
    short: 'jambe G courte',
    help: 'Le tibia gauche perd 30 % de sa longueur : le robot devient bancal, comme avec une seule chaussure à talon.',
  },
  {
    key: 'slippery',
    label: 'Sol glissant',
    short: 'sol glissant',
    help: 'Le frottement du sol passe de 0,9 à 0,1, comme sur de la glace : un pied qui pousse trop fort vers l’arrière dérape.',
  },
  {
    key: 'heavyBackpack',
    label: 'Sac à dos lourd',
    short: 'sac lourd',
    help: 'Le torse devient deux fois plus lourd (environ 6 kg de plus) sans que les moteurs soient plus puissants : lever une jambe et garder l’équilibre devient plus dur.',
  },
  {
    key: 'slope',
    label: 'Pente montante',
    short: 'pente 6°',
    help: 'Le sol monte de 6° : chaque pas doit aussi soulever le robot. La distance est toujours mesurée à l’horizontale.',
  },
];

export function worldLabel(c: WorldConfig): string {
  const parts = INTERVENTIONS.filter((i) => c[i.key]).map((i) => i.short);
  return parts.length ? parts.join(', ') : 'robot intact';
}

export function isHealthy(c: WorldConfig): boolean {
  return INTERVENTIONS.every((i) => !c[i.key]);
}

// ---------------------------------------------------------------------------
// Objectifs (« ce que le robot cherche »)
// ---------------------------------------------------------------------------

export interface Level<T> {
  label: string;
  value: T;
}

/** Priorité vitesse ↔ économie : poids de l'énergie dans le score (par 100 J). */
export const PRIORITY_LEVELS: Level<number>[] = [
  { label: 'Vitesse à tout prix', value: 0 },
  { label: 'Plutôt vite', value: DEFAULT_OBJECTIVES.energy },
  { label: 'Équilibré', value: 0.15 },
  { label: 'Plutôt économe', value: 0.3 },
  { label: 'Économie maximale', value: 0.6 },
];

export const FALL_LEVELS: Level<number>[] = [
  { label: 'Peu importe', value: 0 },
  { label: 'Normal', value: DEFAULT_OBJECTIVES.fall },
  { label: 'Jamais !', value: 15 },
];

export const UPRIGHT_LEVELS: Level<number>[] = [
  { label: 'Peu importe', value: 0 },
  { label: 'Normal', value: DEFAULT_OBJECTIVES.upright },
  { label: 'Bien droit', value: 5 },
];

/** Curiosité = amplitude des variations essayées autour du cerveau actuel (σ). */
export const CURIOSITY_LEVELS: Level<number>[] = [
  { label: 'Prudente', value: 0.03 },
  { label: 'Normale', value: DEFAULT_ES.sigma },
  { label: 'Aventureuse', value: 0.2 },
];

export interface Settings {
  objectives: Objectives;
  es: ESSettings;
  /** Vitesse de lecture de la rediffusion. */
  replaySpeed: number;
  ghost: boolean;
}

export function defaultSettings(): Settings {
  return { objectives: { ...DEFAULT_OBJECTIVES }, es: { ...DEFAULT_ES }, replaySpeed: 1, ghost: true };
}

// ---------------------------------------------------------------------------
// Scénarios
// ---------------------------------------------------------------------------

export type BrainSource = 'healthy' | 'injured' | 'random';

export interface Scenario {
  label: string;
  description: string;
  config: WorldConfig;
  brain: BrainSource;
  /** Lance l'apprentissage tout de suite. */
  autoTrain: boolean;
}

export const SCENARIOS: Record<string, Scenario> = {
  healthy: {
    label: 'Robot en bonne santé',
    config: { ...HEALTHY },
    brain: 'healthy',
    autoTrain: false,
    description:
      'Un cerveau entraîné à l’avance (800 générations de 48 essais) sur le robot intact. Regardez la démarche : elle n’a rien d’humain (torse penché, pas rapides), mais elle avance vite, environ 28 m en 10 s, sans tomber. Elle respecte pourtant le score à la lettre : aller loin sans tomber, personne n’a demandé de marcher « joliment ». Ouvrez les « Moments clés » pour revoir son apprentissage : à la génération 0, il tombe tout de suite.',
  },
  injuredBefore: {
    label: 'Blessure au genou : avant adaptation',
    config: { ...HEALTHY, lockLeftKnee: true },
    brain: 'healthy',
    autoTrain: false,
    description:
      'Même cerveau, mais le genou gauche est bloqué (cadenas rouge). Le réseau n’a jamais connu cette situation : ses ordres au genou ne servent plus à rien et son rythme ne colle plus. Comparez la distance avec celle du fantôme (le robot intact), puis cliquez sur « Réapprendre » pour le voir s’adapter.',
  },
  injuredAfter: {
    label: 'Après adaptation',
    config: { ...HEALTHY, lockLeftKnee: true },
    brain: 'injured',
    autoTrain: false,
    description:
      'Le cerveau a été réentraîné avec le genou bloqué, en partant du cerveau sain. Il a trouvé une nouvelle démarche qui compense la jambe raide. Comparez avec « avant adaptation » dans le tableau des mesures : on passe d’environ 11 m à environ 27 m, presque autant que le robot intact. Les « Moments clés » montrent la blessure puis l’adaptation : deux générations suffisent déjà pour dépasser 20 m. Dans ce monde simplifié, une bonne démarche n’avait pas vraiment besoin de ce genou ! Essayez ensuite « Tout réparer » : ce cerveau spécialisé fait nettement moins bien sur le robot intact.',
  },
  scratch: {
    label: 'À vous de l’entraîner',
    config: { ...HEALTHY },
    brain: 'random',
    autoTrain: true,
    description:
      'Un cerveau tiré au hasard : au début, le robot s’effondre en une ou deux secondes. L’apprentissage démarre tout de suite. Regardez la courbe, le robot et les « Moments clés » : en général, il tient debout dès les premières générations, dépasse 10 m après quelques dizaines de générations (une dizaine de secondes en vitesse Rapide), puis avance de plus en plus loin (souvent une vingtaine de mètres après 300 générations). Sa démarche ne ressemblera sans doute pas à celle du cerveau pré-entraîné : le score dit quoi atteindre, pas comment marcher. Ajoutez une blessure quand vous voulez.',
  },
};

/** Formatage français : 3,42 */
export function fmt(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '–';
  return v.toFixed(digits).replace('.', ',').replace('-', '−');
}
