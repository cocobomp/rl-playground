// Réglages, interventions et scénarios du robot 3D (textes de l'interface, sans DOM).
import { DEFAULT_HYPER, EsHyper } from './agent';
import { DEFAULT_WORLD, RewardParams, WorldParams } from './env';
import { HEAVY_MASS, SLIPPERY_FRICTION, WEAK_STRENGTH } from './worlds';

export interface Settings {
  world: WorldParams;
  /** 0 = tout pour la vitesse … 4 = tout pour l'économie d'énergie. */
  priority: number;
  /** 0 = casse-cou … 4 = très prudent. */
  prudence: number;
  /** 0 = timide … 4 = très curieux (amplitude des essais). */
  curiosity: number;
  hyper: EsHyper;
  /** Vitesse du rejeu à l'écran (1 = temps réel). */
  replaySpeed: number;
}

export const ENERGY_LEVELS = [0, 0.0005, 0.001, 0.004, 0.01];
export const STABILITY_LEVELS = [0, 0.1, 0.2, 0.8, 2];
export const FALL_LEVELS = [0.5, 0.75, 1, 2.5, 5];
export const SIGMA_LEVELS = [0.02, 0.04, 0.06, 0.09, 0.13];

export function defaultSettings(): Settings {
  return { world: { ...DEFAULT_WORLD }, priority: 2, prudence: 2, curiosity: 2, hyper: { ...DEFAULT_HYPER }, replaySpeed: 1 };
}

/** Récompense correspondant aux traits « Priorité » et « Prudence ». */
export function rewardOf(s: Settings): RewardParams {
  return {
    energyWeight: ENERGY_LEVELS[s.priority],
    stabilityWeight: STABILITY_LEVELS[s.prudence],
    fallPenalty: FALL_LEVELS[s.prudence],
  };
}

export interface Intervention {
  id: 'broken' | 'locked' | 'heavy' | 'slippery' | 'weak';
  label: string;
  help: string;
  get: (w: WorldParams) => boolean;
  set: (w: WorldParams, on: boolean) => void;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

export const INTERVENTIONS: Intervention[] = [
  {
    id: 'broken',
    label: 'Patte avant gauche cassée',
    help: 'Le tibia avant gauche disparaît : il ne reste qu’un moignon de cuisse. Le robot doit trouver un équilibre sur trois appuis.',
    get: (w) => w.brokenFrontLeft,
    set: (w, on) => (w.brokenFrontLeft = on),
  },
  {
    id: 'locked',
    label: 'Genou arrière droit bloqué',
    help: 'Ce genou reste tendu quoi que demande le cerveau : la patte devient une béquille raide qu’il faut balancer depuis la hanche.',
    get: (w) => w.lockedRearRightKnee,
    set: (w, on) => (w.lockedRearRightKnee = on),
  },
  {
    id: 'heavy',
    label: 'Corps plus lourd',
    help: `Le tronc pèse ${HEAVY_MASS} fois plus (comme un sac à dos) : les mêmes moteurs soulèvent moins facilement le corps, qui s’affaisse : la démarche apprise perd une bonne partie de son efficacité.`,
    get: (w) => w.bodyMass > 1,
    set: (w, on) => (w.bodyMass = on ? HEAVY_MASS : 1),
  },
  {
    id: 'slippery',
    label: 'Sol glissant',
    help: `Le frottement passe de 1 à ${String(SLIPPERY_FRICTION).replace('.', ',')} (presque de la glace) : les pieds dérapent au lieu de pousser, une démarche « en force » n’avance plus.`,
    get: (w) => w.friction < 1,
    set: (w, on) => (w.friction = on ? SLIPPERY_FRICTION : 1),
  },
  {
    id: 'weak',
    label: 'Moteurs affaiblis',
    help: `Le couple maximal des 8 moteurs tombe à ${pct(WEAK_STRENGTH)} : les gestes amples et rapides deviennent impossibles, il faut une démarche plus économe.`,
    get: (w) => w.motorStrength < 1,
    set: (w, on) => (w.motorStrength = on ? WEAK_STRENGTH : 1),
  },
];

export interface Trait {
  id: 'priority' | 'prudence' | 'curiosity';
  label: string;
  ends: [string, string];
  levels: string[];
  help: string;
  describe: (s: Settings) => string;
}

const fr = (v: number, d = 3) => String(+v.toFixed(d)).replace('.', ',');

export const TRAITS: Trait[] = [
  {
    id: 'priority',
    label: 'Priorité : vitesse ↔ économie d’énergie',
    ends: ['vitesse', 'économie'],
    levels: ['tout pour la vitesse', 'plutôt la vitesse', 'équilibré', 'plutôt économe', 'très économe'],
    help: 'Combien chaque joule dépensé par les moteurs coûte dans la note. Côté économie, le robot apprend peu à peu des gestes plus petits et plus rares, quitte à avancer moins vite.',
    describe: (s) => `note = distance − ${fr(ENERGY_LEVELS[s.priority], 4)} × énergie (J)`,
  },
  {
    id: 'prudence',
    label: 'Prudence : casse-cou ↔ stable',
    ends: ['casse-cou', 'prudent'],
    levels: ['casse-cou', 'audacieux', 'normal', 'prudent', 'très prudent'],
    help: 'Pénalise l’inclinaison du tronc et les chutes. Un robot prudent garde le dos plat et évite de tomber ; un casse-cou accepte de tanguer s’il gagne quelques centimètres.',
    describe: (s) =>
      `− ${fr(STABILITY_LEVELS[s.prudence], 2)} × inclinaison moyenne (rad), − ${fr(FALL_LEVELS[s.prudence], 1)} en cas de chute`,
  },
  {
    id: 'curiosity',
    label: 'Curiosité',
    ends: ['timide', 'curieux'],
    levels: ['timide', 'réservé', 'normal', 'curieux', 'très curieux'],
    help: 'Amplitude des variations essayées autour du cerveau actuel. Timide : progrès lents mais réguliers ; curieux : découvertes plus rapides mais apprentissage plus chaotique.',
    describe: (s) => `σ = ${fr(SIGMA_LEVELS[s.curiosity])} (bruit ajouté à chaque poids)`,
  },
];

export interface Scenario {
  id: string;
  label: string;
  /** Interventions actives. */
  world: Partial<WorldParams>;
  /** Cerveau de départ. */
  brain: 'healthy' | 'broken' | 'random';
  /** Démarre l'apprentissage automatiquement. */
  autoTrain: boolean;
  description: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'demo',
    label: 'Le robot en forme',
    world: {},
    brain: 'healthy',
    autoTrain: false,
    description:
      'Cerveau pré-entraîné, corps intact. Regardez le rythme régulier des pattes (1,6 cycles de marche par seconde, donnés par une horloge interne) et la distance : environ 9 m en 8 s. C’est le résultat de 2 439 générations d’apprentissage faites à l’avance.',
  },
  {
    id: 'injury',
    label: 'Blessure et adaptation',
    world: { brokenFrontLeft: true },
    brain: 'healthy',
    autoTrain: false,
    description:
      'On casse la patte avant gauche, mais le cerveau reste celui du robot intact : il boite et n’avance plus qu’à peine 1 m en 8 s. Cliquez sur « Réapprendre » et regardez la courbe : en 20 à 50 générations (moins d’une minute), la distance remonte en général vers 5 à 7 m, parce que l’évolution garde les variantes qui compensent la patte manquante. Elle part d’un cerveau qui sait déjà presque marcher : c’est bien plus rapide que de tout réapprendre. Pressé ? Une fois la patte cassée, « Cerveau pré-entraîné » charge un cerveau déjà adapté hors ligne.',
  },
  {
    id: 'knee',
    label: 'Genou raide',
    world: { lockedRearRightKnee: true },
    brain: 'healthy',
    autoTrain: false,
    description:
      'Le genou arrière droit est bloqué tendu. Le cerveau envoie les mêmes consignes qu’avant, mais une patte ne plie plus : le robot bascule et tombe presque aussitôt (environ 15 cm). Lancez « Réapprendre » et regardez la courbe : elle monte, mais très lentement. Les générations défilent vite (les essais s’arrêtent dès la chute), mais même après plusieurs centaines, le robot tombe souvent encore avant la fin des 8 s : il va seulement un peu plus loin (1 à 2 m). C’est une vraie limite de la méthode : quand la bonne démarche est très différente de celle qu’on connaît, essayer des variantes au hasard progresse lentement.',
  },
  {
    id: 'scratch',
    label: 'Partir de zéro',
    world: {},
    brain: 'random',
    autoTrain: true,
    description:
      'Cerveau aléatoire : le robot gigote sans but. L’apprentissage démarre tout de suite. Regardez la courbe : elle reste plate un bon moment, puis monte lentement. Il faut souvent plus d’une centaine de générations (plusieurs minutes) avant de voir une vraie démarche, parfois bien plus : le résultat varie d’une fois à l’autre, et la démarche trouvée diffère de celle du cerveau pré-entraîné. C’est la limite de la 3D : apprendre de zéro coûte cher.',
  },
];

export interface ExpertSlider {
  id: keyof EsHyper | 'replaySpeed';
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
}

export const EXPERT_SLIDERS: ExpertSlider[] = [
  {
    id: 'popSize',
    label: 'Taille de la population',
    help: 'Nombre de variantes du cerveau essayées à chaque génération (par paires ±). Plus grand : direction de progrès plus fiable, mais chaque génération est plus longue.',
    min: 8,
    max: 64,
    step: 2,
  },
  {
    id: 'sigma',
    label: 'Bruit d’exploration σ',
    help: 'Écart type du bruit ajouté aux poids pour créer les variantes (réglé aussi par « Curiosité »).',
    min: 0.01,
    max: 0.2,
    step: 0.01,
    format: (v) => fr(v, 2),
  },
  {
    id: 'lr',
    label: 'Taux d’apprentissage',
    help: 'Taille du pas fait vers les meilleures variantes (optimiseur Adam). Trop grand : le cerveau oublie ce qu’il savait.',
    min: 0.005,
    max: 0.1,
    step: 0.005,
    format: (v) => fr(v, 3),
  },
  {
    id: 'replaySpeed',
    label: 'Vitesse du rejeu',
    help: 'Vitesse d’affichage de la simulation 3D (n’influence pas l’apprentissage).',
    min: 0.25,
    max: 3,
    step: 0.25,
    format: (v) => `× ${fr(v, 2)}`,
  },
];
