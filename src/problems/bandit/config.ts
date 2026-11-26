// Scénarios et textes pédagogiques du problème « machines à sous ».
import type { ScenarioKind, StrategyId } from './bandit';

export interface Scenario {
  label: string;
  k: number;
  plays: number;
  change: boolean;
  /** Ce qu'il faut observer (HTML court). */
  description: string;
}

export const SCENARIOS: Record<ScenarioKind, Scenario> = {
  easy: {
    label: 'Machines très différentes',
    k: 5,
    plays: 500,
    change: false,
    description:
      'Les vraies probabilités vont d’environ 10 % à 80 % : une machine se détache nettement. La plupart des stratégies la trouvent vite… sauf parfois le <strong>glouton pur</strong>, qui s’accroche à la première machine qui lui a fait gagner une pièce. Sa courbe de regret qui monte en ligne droite signifie qu’il joue sans arrêt une machine moins bonne.',
  },
  hard: {
    label: 'Machines presque identiques',
    k: 5,
    plays: 1000,
    change: false,
    description:
      'Toutes les machines gagnent entre 42 % et 55 % du temps : il faut des centaines de parties pour les départager. Observez les barres d’incertitude qui se chevauchent longtemps et les courbes de croyance qui restent larges. Ici l’exploration compte : sans elle, on se fige sur une machine « pas mal ». Se tromper coûte peu par coup, suivez donc plutôt « % meilleure machine ».',
  },
  switch: {
    label: 'Le casino change les réglages',
    k: 5,
    plays: 600,
    change: true,
    description:
      'À mi-partie (trait vertical sur le graphique), le casino inverse le classement : la meilleure machine devient la pire. Avec la mémoire longue, une moyenne de centaines de vieux résultats bouge très lentement : les stratégies continuent de jouer l’ancienne favorite. Cochez « Mémoire courte », cliquez sur « Recommencer » et comparez : la réaction est bien plus rapide.',
  },
  needle: {
    label: 'Une seule bonne machine parmi 10',
    k: 10,
    plays: 500,
    change: false,
    description:
      'Neuf machines médiocres (10 à 25 %) et une seule à 60 %. Le glouton pur la rate souvent : s’il gagne tôt sur une machine médiocre, il ne la quitte plus. UCB commence par essayer chaque machine une fois, puis revient vers celles qu’il connaît mal. Thompson concentre rapidement ses parties sur la bonne machine.',
  },
};

export const STRATEGY_HELP: Record<StrategyId, string> = {
  greedy:
    'Glouton pur : joue toujours la machine qui a la meilleure moyenne jusqu’ici, sans jamais explorer. Contre-exemple instructif : il se fige souvent sur une machine moyenne.',
  egreedy:
    'ε-greedy : joue la meilleure machine connue, mais une fois sur 1/ε (environ) en choisit une au hasard pour vérifier les autres. Simple et robuste, mais il continue d’explorer au hasard même quand c’est inutile.',
  ucb:
    'UCB : « optimisme face à l’incertitude ». Chaque machine reçoit un bonus d’autant plus grand qu’elle a été peu jouée (zone hachurée de la barre) ; il joue la plus haute estimation + bonus.',
  thompson:
    'Thompson : tient pour chaque machine une loi de croyance (courbe Beta), en tire une valeur au hasard par machine et joue la plus haute. Une machine est donc jouée avec la probabilité qu’elle soit la meilleure, d’après ce qu’il a observé.',
};

/** Niveaux de vitesse : coups par seconde. */
export const SPEEDS = [1, 2, 4, 8, 15, 30, 60, 120, 250, 600];

/** Curiosité 0–10 → ε et c. Niveau 5 = valeurs classiques (ε = 0,10 ; c ≈ 1,4 ≈ √2 de UCB1). */
export function curiosityToParams(level: number): { epsilon: number; c: number } {
  return { epsilon: 0.02 * level, c: 0.28 * level };
}

export function curiosityWord(level: number): string {
  if (level === 0) return 'nulle';
  if (level <= 2) return 'faible';
  if (level <= 6) return 'moyenne';
  if (level <= 8) return 'forte';
  return 'très forte';
}

/** Formatage à la française. */
export const fr = (v: number, digits = 2) => v.toFixed(digits).replace('.', ',');
export const pct = (v: number) => `${Math.round(v * 100)} %`;
