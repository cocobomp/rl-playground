// Scénarios et textes pédagogiques du problème « machines à sous ».
import type { ScenarioKind, StrategyId } from './bandit';

export interface Scenario {
  label: string;
  k: number;
  plays: number;
  change: boolean;
  /** Graphique le plus parlant pour ce scénario (sélectionné automatiquement). */
  metric: 'regret' | 'best';
  /** Ce qu'il faut observer (HTML court). */
  description: string;
}

export const SCENARIOS: Record<ScenarioKind, Scenario> = {
  easy: {
    label: 'Machines très différentes',
    k: 5,
    plays: 500,
    change: false,
    metric: 'regret',
    description:
      'Les chances de gain vont d’environ 10\u00a0% à 80\u00a0% : une machine se détache nettement. <strong>Regardez</strong> la courbe du <strong>glouton pur</strong> : souvent (environ deux courses sur trois), elle monte en ligne droite, parce qu’il s’accroche à la première machine qui lui a fait gagner une pièce et n’explore plus jamais. Les autres s’aplatissent : elles ont trouvé la bonne machine.',
  },
  hard: {
    label: 'Machines presque identiques',
    k: 5,
    plays: 1000,
    change: false,
    metric: 'best',
    description:
      'Toutes les machines gagnent entre 42\u00a0% et 55\u00a0% du temps : il faut des centaines de parties pour les départager. <strong>Regardez</strong> les barres d’incertitude des machines, qui se chevauchent longtemps, et le graphique « % meilleure machine » : les stratégies qui explorent finissent par jouer plus souvent la meilleure, le glouton pur reste figé sur une machine « pas mal ». Se tromper ne coûte que quelques points de pourcentage par coup : le regret départage mal les stratégies ici.',
  },
  switch: {
    label: 'Le casino change les réglages',
    k: 5,
    plays: 600,
    change: true,
    metric: 'best',
    description:
      'À mi-partie (trait vertical), le casino inverse le classement : la meilleure machine devient la pire. <strong>Regardez</strong> « % meilleure machine » juste après le trait : Glouton + hasard et Thompson s’accrochent longtemps à l’ancienne favorite (souvent plus de cent coups, parfois jusqu’à la fin), car leur moyenne de centaines de vieux résultats bouge lentement ; UCB, poussé par son bonus, réagit plus vite. Cochez ensuite « Mémoire courte » et cliquez sur « Recommencer » : ils lâchent l’ancienne favorite en quelques dizaines de coups, puis partent à la recherche de la nouvelle meilleure.',
  },
  needle: {
    label: 'Une seule bonne machine parmi 10',
    k: 10,
    plays: 500,
    change: false,
    metric: 'regret',
    description:
      'Neuf machines médiocres (10 à 25\u00a0%) et une seule à 60\u00a0%. <strong>Regardez</strong> les compteurs de parties sous chaque machine : UCB essaie d’abord chaque machine une fois, puis revient vers celles qu’il connaît mal ; Thompson concentre vite ses parties sur la bonne. Le glouton pur la rate souvent : s’il gagne tôt sur une machine médiocre, il ne la quitte plus.',
  },
};

export const STRATEGY_HELP: Record<StrategyId, string> = {
  greedy:
    'Glouton pur : joue toujours la machine qui a la meilleure moyenne jusqu’ici, sans jamais explorer. Contre-exemple instructif : il se fige souvent sur une machine moyenne.',
  egreedy:
    'Glouton + hasard (ε-greedy) : joue la meilleure machine connue, mais de temps en temps (une fois sur 10 avec la curiosité moyenne) en choisit une au hasard pour vérifier les autres. Simple et robuste, mais il continue d’explorer au hasard même quand c’est inutile.',
  ucb:
    'UCB (« borne de confiance haute ») : optimisme face à l’incertitude. Chaque machine reçoit un bonus d’autant plus grand qu’elle a été peu jouée (zone hachurée de la barre) ; il joue la plus haute estimation + bonus.',
  thompson:
    'Thompson (du nom de son inventeur) : tient pour chaque machine une loi de croyance (courbe Beta), en tire une valeur au hasard par machine et joue la plus haute. Une machine est donc jouée avec la probabilité qu’elle soit la meilleure, d’après ce qu’il a observé.',
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
