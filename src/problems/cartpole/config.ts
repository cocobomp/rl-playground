// Réglages du pendule inversé : boutons « haut niveau », scénarios et paramètres experts.
import { DEFAULT_ES, DEFAULT_REINFORCE, EsOptions, ReinforceOptions } from './agent';
import { DEFAULT_WORLD, WorldParams } from './env';

export type Algo = 'es' | 'reinforce';

export interface Settings {
  world: WorldParams;
  algo: Algo;
  es: EsOptions;
  rf: ReinforceOptions;
  /** Épisodes simulés par seconde pendant l'entraînement (0 = maximum). */
  pace: number;
}

export function defaultSettings(): Settings {
  return { world: { ...DEFAULT_WORLD }, algo: 'es', es: { ...DEFAULT_ES }, rf: { ...DEFAULT_REINFORCE }, pace: 150 };
}

/** Effet d'un réglage : 'world' = s'applique tout de suite, même pendant l'apprentissage ; 'reset' = il faut repartir de zéro. */
export type Effect = 'world' | 'live' | 'reset';

export interface KnobLevel {
  label: string;
  apply: (s: Settings) => void;
  is: (s: Settings) => boolean;
}

export interface Knob {
  id: string;
  label: string;
  help: string;
  effect: Effect;
  levels: KnobLevel[];
  /** Ce que le réglage change techniquement (affiché sous le bouton). */
  describe: (s: Settings) => string;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const fr = (v: number, d = 2) => {
  const t = v.toFixed(d);
  return (t.includes('.') ? t.replace(/\.?0+$/, '') : t).replace('.', ',');
};

/** Le monde (physique). */
export const WORLD_KNOBS: Knob[] = [
  {
    id: 'length',
    label: 'Longueur du bâton',
    help: 'Un bâton court tombe plus vite (le temps de chute varie comme √longueur) : il faut réagir plus tôt. Essayez-le vous-même dans « À vous de jouer ».',
    effect: 'world',
    levels: [
      { label: 'Très court', apply: (s) => (s.world.halfLength = 0.15), is: (s) => near(s.world.halfLength, 0.15) },
      { label: 'Normal', apply: (s) => (s.world.halfLength = 0.5), is: (s) => near(s.world.halfLength, 0.5) },
      { label: 'Long', apply: (s) => (s.world.halfLength = 1), is: (s) => near(s.world.halfLength, 1) },
    ],
    describe: (s) => `bâton de ${fr(2 * s.world.halfLength * 100, 0)} cm (demi-longueur ${fr(s.world.halfLength)} m)`,
  },
  {
    id: 'polemass',
    label: 'Poids du bâton',
    help: 'Un bâton lourd répond un peu moins à chaque poussée du chariot, mais les rafales de vent le dérangent beaucoup moins.',
    effect: 'world',
    levels: [
      { label: 'Léger', apply: (s) => (s.world.massPole = 0.1), is: (s) => near(s.world.massPole, 0.1) },
      { label: 'Lourd', apply: (s) => (s.world.massPole = 0.5), is: (s) => near(s.world.massPole, 0.5) },
      { label: 'Très lourd', apply: (s) => (s.world.massPole = 1), is: (s) => near(s.world.massPole, 1) },
    ],
    describe: (s) => `masse du bâton : ${fr(s.world.massPole)} kg`,
  },
  {
    id: 'cartmass',
    label: 'Poids du chariot',
    help: 'Avec la même force, un chariot lourd accélère moins : les corrections deviennent lentes et molles.',
    effect: 'world',
    levels: [
      { label: 'Normal', apply: (s) => (s.world.massCart = 1), is: (s) => near(s.world.massCart, 1) },
      { label: 'Lourd', apply: (s) => (s.world.massCart = 3), is: (s) => near(s.world.massCart, 3) },
    ],
    describe: (s) => `masse du chariot : ${fr(s.world.massCart)} kg`,
  },
  {
    id: 'motor',
    label: 'Moteur',
    help: 'Plus le moteur est faible, plus il faut anticiper : au-delà d’une certaine inclinaison, même à pleine puissance, il ne peut plus rattraper le bâton.',
    effect: 'world',
    levels: [
      { label: 'Normal', apply: (s) => (s.world.forceMag = 10), is: (s) => near(s.world.forceMag, 10) },
      { label: 'Faible', apply: (s) => (s.world.forceMag = 5), is: (s) => near(s.world.forceMag, 5) },
      { label: 'Très faible', apply: (s) => (s.world.forceMag = 2), is: (s) => near(s.world.forceMag, 2) },
    ],
    describe: (s) => `poussée de ±${fr(s.world.forceMag)} N à chaque pas`,
  },
  {
    id: 'wind',
    label: 'Rafales de vent',
    help: 'Des coups de vent imprévisibles poussent le bâton (0,5 à 1,5 s chacun). L’agent ne « voit » pas le vent : il ne le sent qu’à travers ses effets.',
    effect: 'world',
    levels: [
      { label: 'Aucune', apply: (s) => (s.world.windForce = 0), is: (s) => near(s.world.windForce, 0) },
      { label: 'Légères', apply: (s) => (s.world.windForce = 0.2), is: (s) => near(s.world.windForce, 0.2) },
      { label: 'Fortes', apply: (s) => (s.world.windForce = 0.35), is: (s) => near(s.world.windForce, 0.35) },
    ],
    describe: (s) =>
      s.world.windForce > 0
        ? `rafales jusqu’à ${fr(s.world.windForce)} N sur le bâton, environ une toutes les ${fr(1 / (s.world.windRate * 50) + 1, 0)} s`
        : 'pas de vent',
  },
];

/** L'agent (cerveau, méthode, caractère). */
export const AGENT_KNOBS: Knob[] = [
  {
    id: 'algo',
    label: 'Méthode d’apprentissage',
    help: 'Évolution : on essaie toute une population de variantes et on garde la direction des meilleures. REINFORCE : un seul agent qui renforce, épisode après épisode, les actions suivies d’une longue survie.',
    effect: 'reset',
    levels: [
      { label: 'Évolution', apply: (s) => (s.algo = 'es'), is: (s) => s.algo === 'es' },
      { label: 'REINFORCE', apply: (s) => (s.algo = 'reinforce'), is: (s) => s.algo === 'reinforce' },
    ],
    describe: (s) =>
      s.algo === 'es'
        ? `stratégie d’évolution : ${s.es.popSize} variantes par génération, ${s.es.episodesPerEval} épisodes chacune`
        : `REINFORCE, politique linéaire à deux actions, un épisode par mise à jour (taux ${fr(s.rf.lr, 3)})`,
  },
  {
    id: 'brain',
    label: 'Cerveau',
    help: 'Simple : la décision est une somme pondérée des 4 capteurs. Réseau : 4 capteurs → neurones cachés → décision, capable de règles plus tordues. (REINFORCE utilise toujours le cerveau simple.)',
    effect: 'reset',
    levels: [
      { label: 'Simple (linéaire)', apply: (s) => (s.es.brain = 'linear'), is: (s) => s.es.brain === 'linear' },
      { label: 'Réseau de neurones', apply: (s) => (s.es.brain = 'mlp'), is: (s) => s.es.brain === 'mlp' },
    ],
    describe: (s) =>
      s.algo === 'reinforce'
        ? 'REINFORCE : 4 poids + 1 biais → probabilité de pousser à droite'
        : s.es.brain === 'linear'
          ? '4 poids + 1 biais = 5 nombres à régler'
          : `réseau 4 → ${s.es.hidden} → 1 : ${4 * s.es.hidden + s.es.hidden + s.es.hidden + 1} nombres à régler`,
  },
  {
    id: 'boldness',
    label: 'Audace des essais',
    help: 'À quel point les variantes essayées s’écartent de l’agent actuel. Trop prudent : il progresse à petits pas ; trop audacieux : les variantes sont presque aléatoires.',
    effect: 'live',
    levels: [
      { label: 'Prudente', apply: (s) => (s.es.sigma = 0.03), is: (s) => near(s.es.sigma, 0.03) },
      { label: 'Normale', apply: (s) => (s.es.sigma = 0.1), is: (s) => near(s.es.sigma, 0.1) },
      { label: 'Audacieuse', apply: (s) => (s.es.sigma = 0.4), is: (s) => near(s.es.sigma, 0.4) },
    ],
    describe: (s) => (s.algo === 'es' ? `bruit d’exploration σ = ${fr(s.es.sigma)}` : 'sans effet avec REINFORCE (qui explore en tirant ses actions au sort)'),
  },
  {
    id: 'pace',
    label: 'Rythme d’apprentissage',
    help: 'Combien d’épisodes l’ordinateur simule par seconde, en coulisses. Ne change pas ce que l’agent apprend, seulement la vitesse à laquelle vous le voyez.',
    effect: 'live',
    levels: [
      { label: 'Posé', apply: (s) => (s.pace = 150), is: (s) => s.pace === 150 },
      { label: 'Rapide', apply: (s) => (s.pace = 800), is: (s) => s.pace === 800 },
      { label: 'Maximum', apply: (s) => (s.pace = 0), is: (s) => s.pace === 0 },
    ],
    describe: (s) => (s.pace > 0 ? `${s.pace} épisodes simulés par seconde` : 'aussi vite que le processeur le permet'),
  },
];

export interface Scenario {
  label: string;
  description: string;
  apply: (s: Settings) => void;
  /** Histoire scriptée : le vent se lève quand l'agent maîtrise le calme. */
  storm?: boolean;
}

export const SCENARIOS: Record<string, Scenario> = {
  balance: {
    label: 'Apprendre à tenir en équilibre',
    description:
      'Le problème classique, avec un réseau de neurones aux poids tirés au hasard : au départ, le bâton tombe en une fraction de seconde. ' +
      'Regardez la courbe : elle grimpe vers 500 pas (10 s, le maximum) en une vingtaine de générations, parce qu’à chaque génération on garde la direction des meilleures variantes. ' +
      'Regardez aussi le réseau pendant le rejeu : la décision bascule de ← à → dès que le bâton commence à pencher.',
    apply: () => {},
  },
  storm: {
    label: 'Tempête',
    description:
      'Regardez la courbe en trois actes. 1) Par temps calme, l’agent apprend jusqu’à tenir 500 pas. 2) Le vent se lève tout seul (trait vertical) : ' +
      'la courbe chute (vers 300 pas environ), parce que l’agent n’a jamais rencontré de rafales. 3) L’apprentissage continue avec le vent : la courbe remonte en partie, ' +
      'en dents de scie (selon les rafales tirées). À retenir : un comportement appris ne vaut que pour les situations vues à l’entraînement.',
    apply: () => {},
    storm: true,
  },
  linear: {
    label: 'Cerveau trop petit ?',
    description:
      'Cerveau simple : la décision est le signe de a·position + b·vitesse + c·angle + d·vitesse de rotation + e, soit 5 nombres à régler. ' +
      'Regardez la courbe : elle monte plus lentement, mais atteint 500 pas elle aussi. Près de la verticale, le pendule se comporte presque comme un système linéaire, ' +
      'et une règle linéaire bien réglée suffit à le stabiliser. Le réseau de neurones devient indispensable sur des problèmes moins réguliers (comme le robot marcheur).',
    apply: (s) => {
      s.es.brain = 'linear';
    },
  },
  short: {
    label: 'Bâton très court',
    description:
      'Bâton de 30 cm au lieu de 1 m : sans aide, il passe de 0,6° à 12° en 0,56 s au lieu de 0,98 s. Essayez d’abord « À vous de jouer » : ' +
      'pour un humain, c’est presque injouable. Puis lancez l’apprentissage et regardez la courbe : l’agent, qui décide 50 fois par seconde, y arrive à peu près aussi vite qu’avec le bâton normal. ' +
      'Ce qui est dur pour nos réflexes ne l’est pas forcément pour une machine rapide.',
    apply: (s) => {
      s.world.halfLength = 0.15;
    },
  },
};

export interface ExpertSlider {
  id: string;
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  effect: Effect;
  get: (s: Settings) => number;
  set: (s: Settings, v: number) => void;
  format?: (v: number) => string;
  group?: string;
}

export const EXPERT_SLIDERS: ExpertSlider[] = [
  {
    id: 'pop', group: 'Stratégie d’évolution', label: 'Taille de la population',
    help: 'Nombre de variantes essayées à chaque génération (par paires ±bruit). Plus grand = direction plus fiable, mais génération plus longue.',
    min: 6, max: 100, step: 2, effect: 'live', get: (s) => s.es.popSize, set: (s, v) => (s.es.popSize = v), format: (v) => String(v),
  },
  {
    id: 'sigma', label: 'σ (bruit d’exploration)',
    help: 'Écart-type du bruit ajouté aux poids pour créer les variantes (le bouton « Audace » règle la même chose).',
    min: 0.01, max: 0.6, step: 0.01, effect: 'live', get: (s) => s.es.sigma, set: (s, v) => (s.es.sigma = v),
  },
  {
    id: 'eslr', label: 'Taux d’apprentissage',
    help: 'Taille du pas fait vers les meilleures variantes (optimiseur Adam).',
    min: 0.005, max: 0.3, step: 0.005, effect: 'live', get: (s) => s.es.lr, set: (s, v) => (s.es.lr = v), format: (v) => v.toFixed(3),
  },
  {
    id: 'epe', label: 'Épisodes par évaluation',
    help: 'Chaque variante est notée sur la moyenne de plusieurs épisodes (mêmes départs pour toutes) : moins de chance, plus de calcul.',
    min: 1, max: 6, step: 1, effect: 'live', get: (s) => s.es.episodesPerEval, set: (s, v) => (s.es.episodesPerEval = v), format: (v) => String(v),
  },
  {
    id: 'hidden', label: 'Neurones cachés',
    help: 'Taille de la couche cachée du réseau. Modifier ce réglage relance l’apprentissage de zéro.',
    min: 1, max: 16, step: 1, effect: 'reset', get: (s) => s.es.hidden, set: (s, v) => (s.es.hidden = v), format: (v) => String(v),
  },
  {
    id: 'rflr', group: 'REINFORCE', label: 'Taux d’apprentissage',
    help: 'Taille du pas de gradient après chaque épisode. Trop grand : l’agent s’effondre régulièrement ; trop petit : il traîne.',
    min: 0.001, max: 0.1, step: 0.001, effect: 'live', get: (s) => s.rf.lr, set: (s, v) => (s.rf.lr = v), format: (v) => v.toFixed(3),
  },
  {
    id: 'gamma', label: 'γ (actualisation)',
    help: 'Poids des pas futurs dans le « retour » de chaque action. Proche de 1 : une action est jugée sur toute la survie qui suit.',
    min: 0.9, max: 0.999, step: 0.001, effect: 'live', get: (s) => s.rf.gamma, set: (s, v) => (s.rf.gamma = v), format: (v) => v.toFixed(3),
  },
  {
    id: 'seed', group: 'Divers', label: 'Graine aléatoire',
    help: 'Change le tirage (poids de départ, variantes, départs des épisodes). Même graine = même apprentissage. Relance l’apprentissage.',
    min: 1, max: 50, step: 1, effect: 'reset', get: (s) => s.es.seed, set: (s, v) => { s.es.seed = v; s.rf.seed = v; }, format: (v) => String(v),
  },
];
