import type { ProblemContent } from './types';

export const CONTENT: ProblemContent = {
  byProfile: {
    curieux: {
      intro:
        'Une voiture au moteur trop faible doit grimper une colline. Personne ne lui dit comment : elle perd un point à chaque instant, jusqu’au drapeau, et doit trouver seule l’astuce de la balançoire.',
      watch: [
        'Cliquez sur « Démarrer », puis réglez la vitesse sur « Turbo » : la courbe du bas chute quand la voiture a compris qu’il faut reculer pour prendre de l’élan.',
        'Cliquez sur « Tester » : la voiture rejoue ce qu’elle a appris, sans hasard. Regardez-la partir d’abord à gauche, à l’opposé du drapeau.',
        'Essayez le scénario « Récompense mal conçue » : on la paie pour aller vite, alors elle se balance sans fin et n’arrive plus jamais.',
        'Essayez le scénario « Moteur surpuissant » : avec un moteur plus fort, foncer à droite suffit, il n’y a plus d’astuce à découvrir.',
      ],
      takeaway:
        'Une machine qui apprend par essais fait exactement ce qu’on récompense, pas ce qu’on avait en tête.',
    },
    etudiant: {
      intro:
        'État continu (position, vitesse), trois actions, récompense de −1 par pas jusqu’au but : rien ne signale qu’on s’en approche. L’agent apprend Q(s, a) par Sarsa(λ) avec une approximation linéaire par tuiles.',
      watch: [
        'Mise à jour : δ = r + γ·Q(s′, a′) − Q(s, a), puis chaque poids actif reçoit (α / n)·δ·e, où e est la trace d’éligibilité et n le nombre de grilles.',
        'Scénario « Sans curiosité » (ε = 0) : prédisez l’échec, puis lancez. L’agent apprend quand même, car Q₀ = 0 est optimiste ; sur la carte « Coût restant », l’inexploré reste vert.',
        'Contre-épreuve : Curiosité « Méfiante » (Q₀ = −150, sous −1/(1−γ) = −100). Prédiction à vérifier : le drapeau n’est presque jamais atteint, malgré 5 % d’actions au hasard.',
        'Coup de pouce « Énergie (bien conçu) » puis « Vitesse (mal conçu) » : seul le premier, de la forme γ·Φ(s′) − Φ(s), conserve la politique optimale.',
      ],
      takeaway:
        'Quand la récompense ne guide pas vers le but, l’exploration et la propagation du mérite comptent autant que la règle de mise à jour.',
    },
    dev: {
      intro:
        'Sous le capot : un tableau de poids par action, indexé par un codage en tuiles (8 grilles décalées de 8 × 8 par défaut). Q(s, a) est la somme des poids actifs, donc une lecture et une mise à jour très bon marché.',
      watch: [
        '« Paramètres experts » est déjà ouvert pour ce profil. Passez λ de 0,9 à 0 : seul le dernier pas est corrigé, le mérite du drapeau remonte beaucoup plus lentement.',
        '« Nombre de grilles (tilings) » et « Cases par axe » règlent le compromis généralisation / résolution ; les modifier, comme Q₀, réinitialise les poids.',
        'Le pas effectif par poids est α / n : montez α vers 1,5 et regardez les estimations sauter sur la carte « Coût restant ».',
        'Piège classique : la limite de pas coupe l’essai sans but atteint. Baissez « Limite de pas par essai (épisode) » à 200 : l’agent ne voit presque jamais le drapeau.',
      ],
      takeaway:
        'Les tuiles suffisent en petite dimension ; au-delà, leur nombre explose et l’on passe à un réseau de neurones avec DQN, PPO ou SAC, via une bibliothèque éprouvée.',
    },
    decideur: {
      intro:
        'Ce cas ressemble aux projets où le résultat n’est mesurable qu’à la toute fin, et où il faut accepter de reculer un temps pour réussir. On y voit surtout le risque d’un objectif mal formulé.',
      watch: [
        'Scénario « Récompense mal conçue » : le « Score perçu (dernier essai) » s’envole pendant que la courbe du bas reste à la limite. L’indicateur est optimisé, pas l’objectif.',
        'Scénario « Prendre de l’élan » : les premiers essais échouent tous. Un tel apprentissage n’est acceptable que sur simulateur, pas sur des clients ou des machines réelles.',
        'Scénario « Moteur surpuissant » : quand le problème devient simple, une règle fixe (« foncer à droite ») suffit. Vérifiez toujours si une méthode plus simple fait l’affaire.',
      ],
      takeaway:
        'Avant tout projet de ce type, il faut un simulateur fiable et une mesure du vrai but, suivie séparément de la récompense donnée à l’agent.',
    },
  },
  realWorld: [
    {
      title: 'Robotique de manipulation',
      text: 'Saisir ou assembler une pièce ne « paie » qu’une fois la tâche réussie. Les équipes entraînent donc en simulation et ajoutent des récompenses intermédiaires, avec le même risque de détourner le robot du but.',
    },
    {
      title: 'Objectifs détournés',
      text: 'OpenAI a décrit en 2016 un agent du jeu de course de bateaux CoastRunners qui tournait en rond pour ramasser des bonus au lieu de finir la course : le scénario « Récompense mal conçue », en vrai.',
    },
    {
      title: 'Commande par apport d’énergie',
      text: 'Redresser un pendule dont le moteur est trop faible demande la même manœuvre : le balancer pour accumuler de l’énergie. C’est un exercice classique d’automatique, résolu là sans apprentissage.',
    },
  ],
};
