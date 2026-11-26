// Glossaire du parcours : des mots simples, une phrase chacun.

export interface GlossaryTerm {
  /** Ancre stable : #/glossaire/<id> */
  id: string;
  term: string;
  definition: string;
  /** Problèmes (ids du registre) où l'on voit la notion à l'œuvre. */
  seeIn?: string[];
}

export const GLOSSARY: GlossaryTerm[] = [
  {
    id: 'agent',
    term: 'Agent',
    definition:
      'Celui qui décide et qui apprend : ici, un petit programme qui choisit une action, observe le résultat et ajuste ses choix.',
    seeIn: ['bandit'],
  },
  {
    id: 'environnement',
    term: 'Environnement',
    definition:
      'Tout ce qui n’est pas l’agent : le monde qui réagit à chaque action en renvoyant une nouvelle situation et une récompense.',
    seeIn: ['grid'],
  },
  {
    id: 'etat',
    term: 'État',
    definition:
      'La description de la situation à un instant : la case où se trouve l’agent, ou la position et la vitesse du chariot et du bâton.',
    seeIn: ['grid', 'cartpole'],
  },
  {
    id: 'action',
    term: 'Action',
    definition:
      'Un des choix possibles de l’agent à un instant : tirer telle machine, aller à gauche, pousser le chariot, actionner un moteur.',
    seeIn: ['bandit', 'grid'],
  },
  {
    id: 'recompense',
    term: 'Récompense',
    definition:
      'Le nombre renvoyé après chaque action (positif si c’est bien, négatif sinon) ; l’agent cherche à maximiser leur somme sur la durée, pas seulement la prochaine.',
    seeIn: ['grid', 'mountaincar'],
  },
  {
    id: 'episode',
    term: 'Épisode',
    definition:
      'Une partie complète, du départ jusqu’à une fin (arrivée atteinte, bâton tombé, temps écoulé) ; l’agent apprend en enchaînant des centaines d’épisodes.',
    seeIn: ['grid', 'cartpole'],
  },
  {
    id: 'politique',
    term: 'Politique',
    definition:
      'La règle de conduite de l’agent : pour chaque état, quelle action choisir. C’est elle qu’on cherche à améliorer.',
    seeIn: ['grid'],
  },
  {
    id: 'valeur',
    term: 'Valeur (V et Q)',
    definition:
      'Une estimation de la somme des récompenses futures qu’on peut espérer : V(s) depuis l’état s, Q(s, a) si l’on commence par l’action a dans l’état s, puis qu’on suit la politique.',
    seeIn: ['grid'],
  },
  {
    id: 'exploration',
    term: 'Exploration / exploitation',
    definition:
      'Exploiter, c’est choisir ce qui semble le meilleur d’après ce qu’on sait ; explorer, c’est essayer autre chose pour en apprendre plus. Il faut doser les deux.',
    seeIn: ['bandit'],
  },
  {
    id: 'epsilon-greedy',
    term: 'ε-greedy',
    definition:
      'Une façon simple de doser : avec une probabilité ε (epsilon), l’agent choisit une action au hasard ; le reste du temps, la meilleure qu’il connaisse.',
    seeIn: ['bandit', 'grid'],
  },
  {
    id: 'alpha',
    term: 'Taux d’apprentissage α',
    definition:
      'La part de l’erreur corrigée à chaque nouvelle expérience : avec α proche de 0 l’agent change très peu d’avis, avec α = 1 il ne retient que la dernière observation.',
    seeIn: ['grid'],
  },
  {
    id: 'gamma',
    term: 'Facteur d’actualisation γ',
    definition:
      'Un nombre entre 0 et 1 qui dit combien comptent les récompenses lointaines : une récompense obtenue k pas plus tard est multipliée par γ puissance k. γ petit = agent pressé, γ proche de 1 = agent patient.',
    seeIn: ['grid'],
  },
  {
    id: 'regret',
    term: 'Regret',
    definition:
      'Ce que l’agent a perdu, au total, par rapport à quelqu’un qui aurait joué la meilleure action dès le début ; un bon algorithme fait grandir son regret de plus en plus lentement.',
    seeIn: ['bandit'],
  },
  {
    id: 'q-learning',
    term: 'Q-learning',
    definition:
      'Corrige Q(s, a) vers « récompense reçue + γ × la meilleure valeur Q de l’état suivant », comme si l’agent allait ensuite jouer parfaitement, même s’il explore encore.',
    seeIn: ['grid', 'mountaincar'],
  },
  {
    id: 'sarsa',
    term: 'SARSA',
    definition:
      'Comme Q-learning, mais avec la valeur de l’action réellement choisie ensuite, hasard compris : l’agent tient compte de ses propres faux pas et préfère des chemins plus prudents, loin du bord de la falaise.',
    seeIn: ['grid'],
  },
  {
    id: 'reseau-de-neurones',
    term: 'Réseau de neurones',
    definition:
      'Une fonction de calcul dotée de nombreux réglages (les « poids ») qui transforme des nombres d’entrée, l’état, en nombres de sortie, l’action ; il remplace le tableau quand les états sont trop nombreux ou continus.',
    seeIn: ['cartpole', 'walker'],
  },
  {
    id: 'evolution',
    term: 'Stratégie d’évolution (population, génération)',
    definition:
      'Au lieu de corriger l’agent pas à pas, on crée une population de variantes légèrement modifiées de ses poids, on les fait toutes jouer et on se rapproche des meilleures ; chaque tour s’appelle une génération.',
    seeIn: ['cartpole', 'walker'],
  },
  {
    id: 'reward-shaping',
    term: 'Récompense mal conçue (reward shaping)',
    definition:
      'Ajouter des petites récompenses intermédiaires peut guider l’agent, mais s’il est plus facile de gagner le bonus que d’atteindre le vrai but, l’agent optimise le bonus : il fait ce qu’on a récompensé, pas ce qu’on voulait.',
    seeIn: ['mountaincar'],
  },
  {
    id: 'simulation',
    term: 'Simulation physique',
    definition:
      'Un programme qui calcule pas à pas le mouvement des objets (gravité, frottements, chocs) ; l’agent peut s’y entraîner des milliers de fois sans abîmer de vrai robot.',
    seeIn: ['walker', 'quadruped3d'],
  },
];
