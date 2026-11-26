// Réglages, traits « haut niveau », scénarios et curseurs experts. Sans DOM.
import { AgentConfig, DEFAULT_AGENT } from './agent';
import { DEFAULT_PHYSICS, PhysicsParams, Shaping, canClimbDirectly } from './env';

export type Speed = 'slow' | 'normal' | 'fast' | 'turbo';

export interface Settings {
  agent: AgentConfig;
  physics: PhysicsParams;
}

export function defaultSettings(): Settings {
  return { agent: { ...DEFAULT_AGENT }, physics: { ...DEFAULT_PHYSICS } };
}

/** Pas de simulation par image d’animation, selon la vitesse choisie (le turbo passe par le worker). */
export const STEPS_PER_FRAME: Record<Exclude<Speed, 'turbo'>, number> = { slow: 1, normal: 5, fast: 40 };

export const SPEEDS: Array<{ id: Speed; label: string }> = [
  { id: 'slow', label: 'Lent' },
  { id: 'normal', label: 'Normal' },
  { id: 'fast', label: 'Rapide' },
  { id: 'turbo', label: 'Turbo' },
];

const fr = (v: number, d = 2) => v.toFixed(d).replace('.', ',').replace('-', '−');
export const formatNumber = fr;

// ---------- Traits à niveaux (boutons segmentés) ----------

export interface Level {
  label: string;
  apply: (s: Settings) => void;
  matches: (s: Settings) => boolean;
}

export interface Trait {
  id: string;
  label: string;
  /** Ce que ça change, en une phrase. */
  help: string;
  levels: Level[];
  /** Traduction technique de l’état courant. */
  describe: (s: Settings) => string;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const curiosity = (label: string, epsilon: number, qInit: number): Level => ({
  label,
  apply: (s) => {
    s.agent.epsilon = epsilon;
    s.agent.qInit = qInit;
  },
  matches: (s) => near(s.agent.epsilon, epsilon) && near(s.agent.qInit, qInit),
});

const shaping = (label: string, kind: Shaping): Level => ({
  label,
  apply: (s) => {
    s.physics.shaping = kind;
  },
  matches: (s) => s.physics.shaping === kind,
});

const memory = (label: string, alpha: number): Level => ({
  label,
  apply: (s) => {
    s.agent.alpha = alpha;
  },
  matches: (s) => near(s.agent.alpha, alpha),
});

export const TRAITS: Trait[] = [
  {
    id: 'curiosity',
    label: 'Curiosité',
    help:
      'Deux sources d’exploration : des actions au hasard (ε) et l’optimisme des estimations de départ (Q₀). ' +
      'Observez la carte « Coût restant » : les zones jamais visitées gardent leur valeur de départ.',
    levels: [
      curiosity('Méfiante', 0.05, -150),
      curiosity('Optimiste', 0, 0),
      curiosity('Optimiste + hasard', 0.05, 0),
      curiosity('Tête brûlée', 0.3, 0),
    ],
    describe: (s) => {
      const { epsilon, qInit, gamma } = s.agent;
      let mood: string;
      if (s.physics.shaping !== 'none') mood = 'avec un coup de pouce, les vraies valeurs changent : l’effet de Q₀ est moins prévisible';
      else if (gamma >= 1) mood = 'avec γ = 1, chaque essai fait baisser l’estimation de ce qui a été essayé : l’inconnu paraît toujours meilleur';
      else if (qInit > -1 / (1 - gamma))
        mood = `au-dessus de −1/(1−γ) = ${fr(-1 / (1 - gamma), 0)} : chaque essai fait baisser l’estimation de ce qui a été essayé, l’inconnu paraît prometteur`;
      else
        mood = `en dessous de −1/(1−γ) = ${fr(-1 / (1 - gamma), 0)} : chaque essai fait monter l’estimation de ce qui a été essayé, le déjà-vu paraît meilleur que l’inconnu`;
      return `ε = ${fr(epsilon)} (${Math.round(epsilon * 100)} % d’actions au hasard), Q₀ = ${fr(qInit, 0)} : ${mood}`;
    },
  },
  {
    id: 'shaping',
    label: 'Coup de pouce',
    help:
      'Une récompense en plus du −1 par pas, pour guider l’apprentissage. Elle peut aider… ou détourner l’agent du vrai but.',
    levels: [shaping('Aucun', 'none'), shaping('Énergie (bien conçu)', 'energy'), shaping('Vitesse (mal conçu)', 'speed')],
    describe: (s) => {
      switch (s.physics.shaping) {
        case 'none':
          return 'seulement −1 par pas jusqu’au drapeau : la récompense ne dit rien tant qu’on n’est pas arrivé';
        case 'energy':
          return 'bonus = γ·Φ(après) − Φ(avant), où Φ = énergie (hauteur + vitesse²) : récompense le gain d’énergie sans changer la meilleure stratégie';
        case 'speed':
          return 'bonus = 60 × |vitesse| à chaque pas (jusqu’à +4,2) : se balancer vite rapporte plus que −1, arriver coupe les bonus…';
      }
    },
  },
  {
    id: 'memory',
    label: 'Mémoire',
    help: 'À quel point chaque nouvelle expérience corrige l’ancienne estimation (le pas d’apprentissage α).',
    levels: [memory('Tenace', 0.1), memory('Équilibrée', 0.5), memory('Impulsive', 1)],
    describe: (s) =>
      `α = ${fr(s.agent.alpha)} : chaque erreur de prédiction est corrigée à ${Math.round(Math.min(1, s.agent.alpha) * 100)} %` +
      (s.agent.alpha < 0.2 ? ' — très stable mais lent : les premiers épisodes durent longtemps' : s.agent.alpha >= 1 ? ' — rapide, mais les estimations sautent davantage' : ''),
  },
];

export function detectLevel(trait: Trait, s: Settings): number {
  return trait.levels.findIndex((l) => l.matches(s));
}

/** Phrase sur le moteur et la gravité (montée directe possible ou non). */
export function describeEngine(p: PhysicsParams): string {
  const engine = 0.001 * p.force;
  const pull = 0.0025 * p.gravity;
  const cmp = `poussée ${fr(engine * 1000, 2)} contre une pente qui tire jusqu’à ${fr(pull * 1000, 2)} (×10⁻³)`;
  return canClimbDirectly(p.force, p.gravity)
    ? `${cmp} : le moteur gagne partout, foncer à droite suffit — plus besoin d’élan.`
    : `${cmp} : impossible de monter d’une traite, il faut prendre de l’élan.`;
}

// ---------- Scénarios ----------

export interface Scenario {
  id: string;
  label: string;
  description: string;
  apply: (s: Settings) => void;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'momentum',
    label: 'Prendre de l’élan',
    description:
      'Le moteur est trop faible pour gravir la pente d’une traite. La seule solution est contre-intuitive : reculer sur la pente de gauche, ' +
      'puis redescendre pour prendre de l’élan. La récompense ne l’aide pas : −1 à chaque pas, rien d’autre jusqu’au drapeau. ' +
      'Au début, la voiture tâtonne des centaines de pas. Regardez la carte des phases : la trajectoire dessine une spirale qui s’élargit ' +
      '(chaque aller-retour gagne de l’énergie) jusqu’au bord droit. En général, après une cinquantaine d’épisodes, 100 à 150 pas suffisent.',
    apply: () => {},
  },
  {
    id: 'strong',
    label: 'Moteur surpuissant',
    description:
      'Moteur ×3 : sa poussée (0,003) dépasse la plus forte traction de la pente (0,0025). Foncer vers la droite suffit, sans élan. ' +
      'L’apprentissage est bien plus rapide (environ 35 pas par épisode au bout de quelques dizaines d’épisodes) et la carte « Action choisie » devient ' +
      'presque entièrement « droite ». Morale : la difficulté venait des contraintes du monde, pas de l’algorithme.',
    apply: (s) => {
      s.physics.force = 3;
    },
  },
  {
    id: 'nocuriosity',
    label: 'Sans curiosité',
    description:
      'ε = 0 : jamais d’action au hasard. On pourrait croire qu’elle va répéter sa première idée sans fin… et pourtant elle apprend, ' +
      'souvent même un peu mieux. Pourquoi ? Les estimations partent de 0 alors que chaque pas coûte −1 : 0 est trop optimiste. ' +
      'Chaque essai fait baisser l’estimation de ce qu’elle a fait ; ce qu’elle n’a pas essayé paraît donc meilleur, et elle va voir. ' +
      'Sur la carte « Coût restant », les zones jamais visitées restent vertes jusqu’à son passage. ' +
      'Pour voir l’inverse, choisissez ensuite Curiosité « Méfiante » : même avec un peu de hasard, elle n’atteint presque jamais le drapeau.',
    apply: (s) => {
      s.agent.epsilon = 0;
      s.agent.qInit = 0;
    },
  },
  {
    id: 'badreward',
    label: 'Récompense mal conçue',
    description:
      'Pour « aider », on donne un bonus proportionnel à la vitesse (jusqu’à +4,2 par pas, contre −1 de coût). Selon les essais, elle atteint ' +
      'd’abord le drapeau quelques dizaines de fois, ou jamais. Car arriver met fin aux bonus : se balancer sans fin rapporte plus. ' +
      'Les épisodes finissent par durer 1000 pas (la limite) : la courbe remonte, alors que le « score perçu », bonus compris, est excellent. ' +
      'L’agent ne se trompe pas : il optimise exactement ce qu’on lui a demandé. Comparez avec le coup de pouce « Énergie ».',
    apply: (s) => {
      s.physics.shaping = 'speed';
    },
  },
];

export function scenarioSettings(id: string): Settings {
  const s = defaultSettings();
  SCENARIOS.find((sc) => sc.id === id)?.apply(s);
  return s;
}

// ---------- Curseurs experts ----------

export interface ExpertSlider {
  id: string;
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  get: (s: Settings) => number;
  set: (s: Settings, v: number) => void;
  format?: (v: number) => string;
  /** Changer ce réglage oblige à tout réapprendre (taille ou valeur de départ de la table). */
  needsReset?: boolean;
  group?: string;
}

export const EXPERT_SLIDERS: ExpertSlider[] = [
  {
    id: 'alpha',
    group: 'Apprentissage',
    label: 'α (pas d’apprentissage)',
    help: 'Part de l’erreur de prédiction corrigée à chaque pas (répartie entre les grilles de tuiles).',
    min: 0.05, max: 1.5, step: 0.05,
    get: (s) => s.agent.alpha, set: (s, v) => (s.agent.alpha = v),
  },
  {
    id: 'gamma',
    label: 'γ (horizon)',
    help: 'Poids du futur. Avec γ = 0,99 la pire valeur possible est −1/(1−γ) = −100 ; avec γ = 1 aucun Q₀ constant n’est pessimiste.',
    min: 0.9, max: 1, step: 0.005,
    get: (s) => s.agent.gamma, set: (s, v) => (s.agent.gamma = v), format: (v) => fr(v, 3),
  },
  {
    id: 'epsilon',
    label: 'ε (actions au hasard)',
    help: 'Probabilité de jouer une action au hasard plutôt que la meilleure connue.',
    min: 0, max: 0.5, step: 0.01,
    get: (s) => s.agent.epsilon, set: (s, v) => (s.agent.epsilon = v),
  },
  {
    id: 'lambda',
    label: 'λ (traces d’éligibilité)',
    help: 'Jusqu’où remonte le mérite : avec λ = 0, seul le dernier pas est corrigé ; avec λ = 0,9, les dizaines de pas précédents aussi.',
    min: 0, max: 0.99, step: 0.01,
    get: (s) => s.agent.lambda, set: (s, v) => (s.agent.lambda = v),
  },
  {
    id: 'qInit',
    label: 'Q₀ (estimation de départ)',
    help: 'Valeur de départ de toutes les estimations. Modifier ce réglage recommence l’apprentissage.',
    min: -200, max: 50, step: 10,
    get: (s) => s.agent.qInit, set: (s, v) => (s.agent.qInit = v), format: (v) => fr(v, 0), needsReset: true,
  },
  {
    id: 'tilings',
    group: 'Approximation par tuiles',
    label: 'Nombre de grilles (tilings)',
    help: 'Grilles superposées et décalées. Plus il y en a, plus la généralisation est fine. Recommence l’apprentissage.',
    min: 1, max: 16, step: 1,
    get: (s) => s.agent.tilings, set: (s, v) => (s.agent.tilings = v), format: (v) => String(v), needsReset: true,
  },
  {
    id: 'tiles',
    label: 'Cases par axe',
    help: 'Résolution de chaque grille (cases × cases). Peu de cases : généralise trop ; beaucoup : apprend lentement. Recommence l’apprentissage.',
    min: 2, max: 16, step: 1,
    get: (s) => s.agent.tiles, set: (s, v) => (s.agent.tiles = v), format: (v) => `${v} × ${v}`, needsReset: true,
  },
  {
    id: 'maxSteps',
    group: 'Épisodes',
    label: 'Limite de pas par épisode',
    help: 'Au-delà, l’épisode est interrompu (et compté comme un échec dans la courbe).',
    min: 200, max: 3000, step: 100,
    get: (s) => s.physics.maxSteps, set: (s, v) => (s.physics.maxSteps = v), format: (v) => String(v),
  },
];
