import type { ProblemContent } from './types';

export const CONTENT: ProblemContent = {
  byProfile: {
    curieux: {
      intro:
        'Tenir un balai debout dans la paume de la main : c’est ce que le chariot doit apprendre, sans que personne lui explique comment. Il essaie, tombe, et garde ce qui a marché.',
      watch: [
        'Cliquez sur « Apprendre » et suivez la courbe « Pas tenus par génération » : elle part de presque rien et grimpe vers 500 pas, soit 10 secondes d’équilibre.',
        'Passez sur « À vous de jouer », cliquez sur « Commencer » et tenez le bâton avec les flèches ← → du clavier. Puis cliquez sur « Comparer avec l’agent ».',
        'Regardez « Le cerveau de l’agent, en direct » : les ronds changent de couleur dès que le bâton penche, et la décision bascule d’un côté à l’autre.',
        'Choisissez le scénario « Tempête », puis « Apprendre » : quand le vent se lève, l’agent qui tenait parfaitement se met à tomber.',
      ],
      takeaway:
        'L’agent ne sait bien faire que ce qu’il a déjà rencontré pendant son entraînement : changez le monde, et il doit réapprendre.',
    },
    etudiant: {
      intro:
        'L’état est continu (position, vitesse, angle, vitesse angulaire) : plus de tableau de valeurs, mais une politique paramétrée, ici un réseau 4 → 8 → 1. On cherche directement ses poids θ, sans estimer de fonction de valeur.',
      watch: [
        'Méthode « Évolution » : on évalue des variantes θ ± σ·ε, puis on déplace θ vers les mieux classées. Aucun gradient de la politique n’est calculé, seulement des scores d’épisodes.',
        'Passez « Méthode d’apprentissage » sur « REINFORCE » : w ← w + α · Σ Âₜ · ∇ log π(aₜ | sₜ). À vérifier : une courbe en dents de scie, car chaque mise à jour repose sur un seul épisode.',
        'Scénario « Cerveau trop petit ? » : 5 paramètres au lieu de 49. Prédisez si la politique linéaire atteint 500 pas, puis vérifiez ; près de la verticale, la dynamique est presque linéaire.',
        'Réglez « Audace des essais » sur « Prudente » puis « Audacieuse » : σ joue le rôle de l’exploration, faite ici dans l’espace des paramètres et non dans celui des actions.',
      ],
      takeaway:
        'Avec des états continus, on optimise une politique paramétrée : par perturbation des poids (évolution) ou par gradient de politique (REINFORCE), deux estimateurs bruités du même objectif.',
    },
    dev: {
      intro:
        'Côté code : un vecteur de 49 flottants (MLP 4 → 8 → 1, tanh), une boucle de simulation à 50 Hz intégrée par Euler, et un optimiseur sans rétropropagation qui tourne dans un Web Worker. « Paramètres experts » est déjà ouvert pour vous.',
      watch: [
        'Curseurs « Taille de la population » et « Épisodes par évaluation » : une génération coûte population × épisodes simulations (30 × 3 = 90 par défaut). Moins de variance, plus de calcul.',
        'Curseurs « σ (bruit d’exploration) » et « Taux d’apprentissage » (Adam) : σ trop petit, le classement des variantes n’est plus que du bruit ; trop grand, elles sont quasi aléatoires.',
        'Cochez « Commande progressive » : la sortie devient une force continue au lieu d’un signe. La politique et l’optimiseur ne changent pas, seule l’interprétation de la sortie change.',
        'Piège à observer avec « Rafales de vent » : le vent est absent des capteurs. L’observation ne décrit plus tout l’état, et la « Graine aléatoire » change sensiblement le résultat.',
      ],
      takeaway:
        'L’évolution se parallélise très bien et ne demande aucun gradient, mais consomme beaucoup d’épisodes : en production, on part plutôt de PPO ou SAC (Stable-Baselines3, par exemple) et on évalue toujours sur plusieurs graines.',
    },
    decideur: {
      intro:
        'C’est le cas d’école du pilotage automatique : maintenir un système instable dans sa plage de fonctionnement en corrigeant en continu. Ici, tout s’apprend dans un simulateur, où tomber ne coûte rien.',
      watch: [
        'Scénario « Tempête » : la performance chute dès que les conditions sortent de ce qui a été vu à l’entraînement. C’est le risque principal d’un déploiement réel.',
        'Statistique « Parties jouées (épisodes) » : des milliers d’essais, dont beaucoup d’échecs. Sans simulateur fidèle, ces essais se paieraient en matériel, en temps ou en sécurité.',
        'Scénario « Cerveau trop petit ? » : une règle à 5 nombres suffit ici. Sur un système aussi régulier, un régulateur classique (PID, LQR) fait le travail, avec des garanties en plus.',
      ],
      takeaway:
        'Envisagez le RL pour du pilotage seulement si vous avez un simulateur fidèle, un objectif mesurable et un système trop complexe pour l’automatique classique ; sinon, la méthode simple est plus sûre et moins chère.',
    },
  },
  realWorld: [
    {
      title: 'Stabilisation de systèmes instables',
      text: 'Gyropodes, drones ou fusées qui se posent résolvent le même problème d’équilibre. En pratique, ils reposent surtout sur l’automatique classique (PID, LQR, commande prédictive) ; le pendule inversé sert de banc d’essai commun aux deux approches.',
    },
    {
      title: 'Stratégies d’évolution à grande échelle',
      text: 'En 2017, OpenAI a montré (Salimans et al.) que cette méthode, répartie sur des centaines de processeurs, pouvait rivaliser avec des algorithmes de RL usuels sur des tâches de locomotion simulée et des jeux Atari.',
    },
    {
      title: 'Robotique : du simulateur au robot réel',
      text: 'Le scénario « Tempête » illustre pourquoi les équipes de robotique font varier masses, frottements et perturbations pendant l’entraînement (« randomisation de domaine ») : la politique doit avoir vu des conditions variées avant de quitter le simulateur.',
    },
  ],
};
