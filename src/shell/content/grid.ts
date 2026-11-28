import type { ProblemContent } from './types';

export const CONTENT: ProblemContent = {
  byProfile: {
    curieux: {
      intro:
        'Un petit rond orange cherche une étoile dans un labyrinthe, sans carte ni mode d’emploi. Comme un enfant qui joue à « chaud ou froid », il retient peu à peu quelles cases rapprochent du but.',
      watch: [
        'Cliquez sur « Démarrer » et regardez les cases : le vert part de l’étoile et remonte vers le départ, tentative après tentative.',
        'Dans « Scénarios », cliquez sur « La falaise », puis sur « Démarrer » : les pointillés bleus montrent le chemin préféré de l’agent, tout au bord des pièges.',
        'Dans « Personnalité de l’agent », passez Prudence sur « prudent », puis cliquez sur « Réinitialiser » et « Démarrer » : le chemin s’écarte du bord.',
        'Essayez « Deux trésors » : l’agent « myope » se contente du petit trésor tout proche. Augmentez « Vision à long terme » pour qu’il aille chercher le grand.',
      ],
      takeaway:
        'Personne ne montre le chemin à l’agent : il le découvre en essayant, et son caractère change le chemin qu’il finit par choisir.',
    },
    etudiant: {
      intro:
        'Un problème tabulaire de 64 états et 4 actions, à récompense retardée : l’agent apprend la valeur Q(s, a) par différence temporelle, avec une politique ε-greedy. Deux algorithmes : Q-learning (off-policy) et SARSA (on-policy).',
      watch: [
        'Mise à jour : Q(s, a) ← Q(s, a) + α [r + γ Q(s′, a′) − Q(s, a)]. Q-learning prend le maximum sur a′, SARSA l’action réellement jouée ensuite.',
        'Cochez « Valeurs » sous la grille et chargez « Pièce vide » : suivez la valeur qui se propage depuis l’étoile vers le départ, épisode après épisode.',
        'Expérience : chargez « La falaise », puis cliquez sur « Comparer ». Prédiction à vérifier : Q-learning longe le bord, SARSA s’en écarte et obtient un gain moyen plus élevé pendant l’apprentissage.',
        '« Deux trésors » : avec γ = 0,7, comparez 10 × 0,7⁵ ≈ 1,7 et 3 × 0,7 = 2,1. Prédisez le chemin, puis passez « Vision à long terme » sur « équilibré ».',
      ],
      takeaway:
        'Q-learning estime la valeur de la politique optimale, SARSA celle de la politique réellement suivie, exploration comprise : l’écart se voit dès qu’un faux pas coûte cher.',
    },
    dev: {
      intro:
        'Toute la connaissance de l’agent tient dans un Float64Array de 64 × 4 = 256 valeurs, mis à jour en O(1) à chaque pas. « Paramètres experts » est ouvert automatiquement pour ce profil : algorithme, α, γ, ε et récompenses.',
      watch: [
        'Expérience « Apprend trop vite » : α = 1 et ε qui s’éteint en quelques épisodes. L’agent se fige avant d’avoir trouvé l’étoile et tourne en rond jusqu’à la limite de 200 pas.',
        '« Décroissance de ε » : ε est multiplié par ce facteur après chaque épisode (0,97 par défaut, plancher à 0,01). Trop bas, l’agent se fige ; à 1, il n’exploite jamais.',
        'Piège classique, la récompense : modifiez « Coût par pas » ou « Pénalité de piège », puis « Réinitialiser ». Le chemin appris peut changer sans toucher à l’algorithme.',
        'Limite : un tableau ne tient plus dès que les états sont continus ou trop nombreux. En production, on passe à DQN, PPO ou SAC via une bibliothèque éprouvée (Stable-Baselines3, RLlib).',
      ],
      takeaway:
        'L’algorithme tient en quelques lignes ; le vrai travail est dans le choix des états, de la récompense et du rythme d’exploration.',
    },
    decideur: {
      intro:
        'Ce labyrinthe ressemble à tout problème où une suite de décisions ne paie qu’à la fin : trajet d’un robot, séquence de réglages, enchaînement d’étapes. Ici, l’agent peut échouer des centaines de fois sans rien casser.',
      watch: [
        'Chargez « La falaise », puis cliquez sur « Comparer » : deux méthodes, deux attitudes face au risque. Demandez-vous ce que coûte, chez vous, une erreur commise pendant l’apprentissage.',
        'Regardez « Gain total par tentative » : l’agent rate de nombreuses tentatives avant de réussir, sur une grille de 64 cases seulement. Sans simulateur fidèle, ces essais auraient lieu sur le terrain.',
        'Changez « Impatience » ou « Prudence », puis « Réinitialiser » : l’agent optimise exactement ce qu’on récompense. Une récompense mal définie donne un comportement que personne n’a voulu.',
        'Limite : quand la carte est connue et stable, un calcul classique de plus court chemin suffit et s’explique mieux. Le RL se justifie si les règles sont inconnues ou changeantes.',
      ],
      takeaway:
        'Avant de parler d’algorithme, vérifiez trois choses : une récompense mesurable, un simulateur ou un droit à l’erreur, et l’absence d’une méthode plus simple.',
    },
  },
  realWorld: [
    {
      title: 'Jeux Atari (DQN)',
      text: 'En 2015, DeepMind a publié DQN : la même règle de Q-learning, où un réseau de neurones remplace le tableau, a appris à jouer à des dizaines de jeux Atari à partir des pixels.',
    },
    {
      title: 'Robots mobiles en entrepôt',
      text: 'Rejoindre un rayonnage en évitant les obstacles est le même problème en grand. En pratique, la planification classique (A*) fait l’essentiel ; le RL est étudié pour les environnements mal connus ou changeants.',
    },
    {
      title: 'Apprentissage sur un système réel',
      text: 'Robot ou procédé industriel : quand chaque essai raté coûte, on retrouve le dilemme de la falaise. C’est l’objet du « RL sûr » (safe RL), qui encadre les risques pris pendant l’exploration.',
    },
  ],
};
