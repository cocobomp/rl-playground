import type { ProblemContent } from './types';

export const CONTENT: ProblemContent = {
  byProfile: {
    curieux: {
      intro:
        'Un robot à quatre pattes apprend à marcher sans professeur : on essaie des variantes de ses réglages, on garde celles qui vont le plus loin. Chaque patte a déjà son « métronome », comme un rythme de trot inné.',
      watch: [
        'Dans « Moments clés », cliquez sur « Génération 0 », puis sur les suivantes : vous revoyez le robot passer du piétinement à la marche.',
        'Cliquez sur « Casser une patte » : il boite et tombe. Cliquez sur « Réapprendre » et regardez « Distance (8 s) » remonter peu à peu.',
        'Cliquez sur « Comparer le début et la fin » : un robot gris, le « fantôme », marche dans le couloir voisin pour mesurer le progrès d’un coup d’œil.',
      ],
      takeaway:
        'Personne ne montre au robot comment marcher : il reçoit seulement une note à la fin de chaque essai, et le hasard trié par cette note fait le reste.',
    },
    etudiant: {
      intro:
        'Recherche directe de politique : un générateur de rythme par patte (CPG) plus un réseau correcteur, optimisés par stratégie d’évolution. La récompense n’arrive qu’en fin d’épisode de 8 s : distance moins énergie, inclinaison et chute.',
      watch: [
        'Mise à jour : paramètres perturbés par paires +bruit / −bruit, essais classés, puis déplacement vers les mieux classés. Aucune fonction de valeur, aucun gradient de la physique.',
        'Dans « Personnalité et objectifs », passez « Curiosité » de « timide » à « très curieux » : prédisez l’effet sur la courbe de « Progrès de l’apprentissage » (plus rapide, mais plus irrégulière ?), puis vérifiez.',
        'Lancez le scénario « Genou raide », puis « Réapprendre » : la politique repart des paramètres existants. Comparez le nombre de générations avec « Partir de zéro ».',
        'Cliquez plusieurs fois sur « Repartir de zéro » : certains tirages restent longtemps coincés sous 4 m. C’est un optimum local, pas une panne.',
      ],
      takeaway:
        'Une stratégie d’évolution traite l’épisode entier comme une boîte noire : simple et parallélisable, mais elle n’exploite pas la structure temporelle que les méthodes à différence temporelle utilisent.',
    },
    dev: {
      intro:
        'Politique : une trentaine de paramètres de métronomes et un réseau 20 → 8 → 8, optimisés par stratégie d’évolution (paires ±bruit, mise à jour Adam), essais répartis sur des workers. « Paramètres experts » s’ouvre automatiquement pour ce profil.',
      watch: [
        '« Taille de la population » : chaque variante coûte un essai de 480 pas de physique Rapier. Doublez-la : direction plus fiable, mais la « Vitesse » en générations par seconde chute d’autant.',
        '« Bruit d’exploration σ » et « Taux d’apprentissage » : trop de bruit, la courbe devient chaotique ; un pas trop grand, le cerveau oublie une démarche acquise. Testez après « Patte avant gauche cassée ».',
        '« Vitesse d’apprentissage » sur « Turbo » : le rendu three.js se met en pause. La simulation étant déterministe, le résultat ne dépend pas du nombre de workers.',
        'Piège visible avec « Repartir de zéro » : seul un tirage sur deux ou trois trouve une vraie démarche. Le CPG sert justement de structure a priori qui réduit l’espace de recherche.',
      ],
      takeaway:
        'En production, on entraîne plutôt avec PPO ou SAC sur des milliers d’environnements simulés en parallèle sur GPU, avec randomisation du simulateur avant le passage au vrai robot.',
    },
    decideur: {
      intro:
        'C’est le cas type « régler un système physique par essais simulés » : robot, machine, procédé. On ne programme pas le geste ; on définit une note mesurable et on laisse l’optimisation chercher.',
      watch: [
        'Lancez le scénario « Blessure et adaptation », puis « Réapprendre » : le système se réadapte à une panne sans reprogrammation, mais seulement parce que la panne est simulée fidèlement.',
        'Déplacez « Priorité : vitesse ↔ économie d’énergie » vers « économie », puis réapprenez : le comportement suit ce que la note récompense. Mal définir la note, c’est mal définir le produit.',
        'Lisez le bandeau « Expérimental » et lancez « Partir de zéro » : coût de calcul élevé et résultat variable d’un essai à l’autre. À prévoir dans un budget et un planning.',
      ],
      takeaway:
        'Sans simulateur fidèle ni objectif chiffrable, ce type de projet n’aboutit pas ; et si une commande classique réglée par un automaticien suffit, elle reste moins chère et plus facile à certifier.',
    },
  },
  realWorld: [
    {
      title: 'Robots quadrupèdes entraînés en simulation',
      text: 'Des laboratoires comme l’ETH Zurich (robot ANYmal) entraînent la marche en simulation par renforcement, puis la transfèrent sur le robot réel. Ils utilisent des méthodes à gradient de politique et bien plus d’essais qu’ici.',
    },
    {
      title: 'Générateurs de rythme (CPG) en robotique bio-inspirée',
      text: 'L’idée du métronome par patte vient de la biologie : des circuits de la moelle épinière produisent le rythme de la marche. Des équipes, notamment à l’EPFL, s’en servent pour des robots à pattes ou nageurs.',
    },
    {
      title: 'Stratégies d’évolution à grande échelle',
      text: 'OpenAI a montré en 2017 que des stratégies d’évolution, très faciles à paralléliser, peuvent concurrencer le renforcement classique sur des tâches de locomotion simulée. C’est la même famille d’algorithmes que celle de cette page.',
    },
  ],
};
