import type { ProblemContent } from './types';

export const CONTENT: ProblemContent = {
  byProfile: {
    curieux: {
      intro:
        'Un enfant apprend à marcher sans mode d’emploi : il essaie, tombe, garde ce qui marche. Ce robot fait pareil, avec pour seule indication une note à la fin de chaque essai.',
      watch: [
        'Choisissez le scénario « Robot en bonne santé » et lisez « Distance (essai affiché) » : environ 28 m en 10 s, avec une démarche qui n’a rien d’humain.',
        'Cochez « Bloquer le genou gauche » : le robot reste loin derrière son fantôme, environ 11 m. Son « cerveau » n’a pas changé, son corps si.',
        'Cliquez sur « Réapprendre » et suivez la courbe « Progrès et moments clés » : en quelques générations (tours d’essais), il invente une autre démarche.',
        'Dans « Moments clés », cliquez sur le tout premier moment : à la génération 0, il tombait tout de suite. Personne ne lui a montré la suite.',
      ],
      takeaway:
        'On ne lui dit jamais comment marcher, seulement ce qui compte : il trouve seul une solution, souvent inattendue.',
    },
    etudiant: {
      intro:
        'Recherche directe de politique : un réseau 17 → 16 → 4 (356 paramètres) associe l’état aux angles visés des quatre moteurs. Une stratégie d’évolution l’optimise à partir du seul retour de chaque épisode de 10 s, sans fonction de valeur.',
      watch: [
        'Mise à jour : θ ← θ + pas × moyenne des bruits ε pondérés par le rang de leur score ; les variantes θ ± σε sont testées par paires.',
        'Scénario « Blessure au genou : avant adaptation » : prédisez en combien de générations « Réapprendre » dépasse 20 m, puis comparez avec « Repartir de zéro ».',
        'Réglez « Curiosité » (c’est σ) sur « Aventureuse » avant d’apprendre : prédisez l’écart entre la courbe moyenne et celle de la meilleure variante, puis vérifiez.',
        'Après « Après adaptation », cliquez sur « Tout réparer » : la politique spécialisée généralise-t-elle au robot intact ? Lisez la réponse dans le « Tableau des mesures ».',
      ],
      takeaway:
        'Une stratégie d’évolution estime une direction d’amélioration à partir des seuls retours d’épisodes : simple et parallélisable, mais gourmande en essais.',
    },
    dev: {
      intro:
        'Un vecteur de 356 flottants, pas de rétropropagation : chaque génération coûte « Taille de la population » × 600 pas de physique, répartis sur des Web Workers. « Paramètres experts » s’ouvre automatiquement pour ce profil.',
      watch: [
        '« Taille de la population » (24 par défaut) : plus grande, la direction estimée est moins bruitée, mais la génération dure plus longtemps. Suivez les générations par seconde affichées.',
        '« Bruit σ (curiosité) » et « Taux d’apprentissage » (pas d’Adam) vont ensemble : σ trop faible, plus de signal ; pas trop grand, le score oscille.',
        '« Vitesse d’apprentissage » ne change que le nombre de workers : résultat identique en « Normale », « Rapide » ou « Turbo ». Ce déterminisme facilite le débogage.',
        'Piège : le score est optimisé à la lettre. Avec « Ne jamais tomber » sur « Peu importe », guettez le plongeon final. En production : PPO ou SAC, et une physique perturbée au hasard.',
      ],
      takeaway:
        'L’évolution se code en quelques dizaines de lignes et se parallélise sans effort, mais son coût en épisodes la réserve aux petits réseaux et aux simulateurs rapides.',
    },
    decideur: {
      intro:
        'Cas type : un système à régler (machine, robot, procédé) dont vous savez noter le résultat sans savoir écrire la règle. Ici la note combine distance, énergie et chutes, et tout l’apprentissage se fait en simulation.',
      watch: [
        'Scénarios « Blessure au genou : avant adaptation » puis « Après adaptation » : d’environ 11 m à 27 m. Réadapter un contrôleur existant coûte moins que repartir de zéro.',
        'Dans « Ce que le robot cherche », glissez « Priorité » vers « Économiser l’énergie » puis réapprenez : le comportement suit l’objectif chiffré, y compris ses oublis.',
        'Après adaptation, « Tout réparer » : le cerveau spécialisé fait moins bien sur le robot intact. Chaque changement de conditions appelle un réentraînement, donc un budget.',
        'Lisez « Limites honnêtes » dans « Comment ça marche ? » : sans simulateur fidèle, rien ne se transpose au réel. Un régulateur classique suffit souvent quand le modèle est connu.',
      ],
      takeaway:
        'Avant d’investir, vérifiez trois choses : un simulateur crédible, un score qui dit vraiment ce que vous voulez, et le coût d’un réentraînement à chaque changement.',
    },
  },
  realWorld: [
    {
      title: 'Robots à pattes entraînés en simulation',
      text: 'Des quadrupèdes comme ANYmal (ETH Zurich) apprennent leur allure en simulation, puis la politique est transférée sur le robot réel. La méthode est en général un gradient de politique (PPO, par exemple), pas l’évolution.',
    },
    {
      title: 'Robots qui s’adaptent à une panne',
      text: 'En 2015, une équipe a montré dans Nature un hexapode qui retrouve une démarche en moins de deux minutes après une patte cassée, par essais guidés par un répertoire de démarches calculé en simulation.',
    },
    {
      title: 'Stratégies d’évolution à grande échelle',
      text: 'En 2017, OpenAI a montré que cette même famille d’algorithmes, répartie sur des centaines de cœurs de calcul, rivalise avec le RL classique sur des tâches de locomotion simulée.',
    },
  ],
};
