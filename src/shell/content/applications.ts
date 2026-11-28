import type { Application } from './types';

// Projets réels de la page « Dans la vraie vie ». Chaque fiche s'appuie sur des travaux publiés ;
// les projets de recherche sont signalés comme tels. Pas de chiffres de gains : ils dépendent du contexte.
export const APPLICATIONS: Application[] = [
  {
    id: 'recommandation-contenus',
    title: 'Choisir quel contenu montrer',
    sector: 'Médias et commerce en ligne',
    story:
      'Une page d’accueil doit choisir quel article, quelle vignette ou quelle offre afficher à chaque visiteur, sans savoir d’avance ce qui plaira. Yahoo! l’a documenté pour ses actualités, Netflix pour ses vignettes.',
    agent: 'Le système de recommandation, qui décide à chaque affichage.',
    actions: 'Afficher une variante parmi quelques-unes (titre, image, offre).',
    reward: 'Un clic, une lecture ou un achat ; rien sinon.',
    limits:
      'Le clic se mesure bien, pas la satisfaction : optimiser le clic favorise les titres racoleurs. Les goûts changent, donc il faut continuer d’explorer, et chaque essai raté est montré à un vrai visiteur.',
    problemIds: ['bandit'],
    angle: {
      curieux:
        'C’est le problème des machines à sous : pour savoir quelle vignette plaît, il faut en montrer plusieurs, puis montrer plus souvent celle qui marche.',
      etudiant:
        'C’est un bandit contextuel : l’action n’influence pas l’état suivant, mais la récompense attendue dépend du contexte (visiteur, heure), d’où LinUCB ou l’échantillonnage de Thompson.',
      dev:
        'En production, on journalise la probabilité de chaque affichage pour évaluer une nouvelle politique hors ligne (pondération par l’inverse de la propension) avant de l’exposer au trafic.',
      decideur:
        'Rentable si vous avez beaucoup de trafic et un objectif mesurable en quelques secondes ; avec deux variantes et peu de visites, un test A/B classique suffit.',
    },
  },
  {
    id: 'tarification-stocks',
    title: 'Fixer un prix, réapprovisionner un stock',
    sector: 'Commerce et logistique',
    story:
      'Un commerçant doit choisir un prix ou une quantité à commander sans connaître la demande à venir. Commander trop immobilise de l’argent, commander trop peu fait perdre des ventes.',
    agent: 'Le logiciel de tarification ou de réapprovisionnement.',
    actions: 'Choisir un prix dans une grille, ou une quantité à commander pour chaque produit.',
    reward: 'La marge réalisée, moins les coûts de stockage et de rupture.',
    limits:
      'La demande est bruitée et saisonnière, et l’effet d’une commande n’apparaît qu’après le délai de livraison. Tester des prix sur de vrais clients pose des questions d’équité et parfois de droit.',
    problemIds: ['bandit', 'grid'],
    angle: {
      curieux:
        'Essayer plusieurs prix revient à essayer plusieurs machines à sous ; gérer un stock, c’est plutôt le labyrinthe, où une décision d’aujourd’hui se paie plusieurs jours plus tard.',
      etudiant:
        'Tester des prix est un bandit ; le stock est un processus de décision markovien, car l’action modifie l’état futur (niveau de stock, commandes en cours) et la récompense est différée.',
      dev:
        'Mettez les commandes en transit dans l’état, sinon il n’est pas markovien, et comparez toujours à une politique à seuil de recomplètement : elle est difficile à battre.',
      decideur:
        'Les règles classiques de gestion de stock restent la référence ; le RL ne se justifie que sur de gros volumes, avec un historique propre et un simulateur de demande crédible.',
    },
  },
  {
    id: 'bras-robotises',
    title: 'Saisir des objets jamais vus',
    sector: 'Robotique industrielle et entrepôts',
    story:
      'Un bras robotisé doit attraper dans un bac des objets de formes variées, à partir d’une image de caméra. Google a publié en 2018 un apprentissage de ce type sur plusieurs bras réels (QT-Opt).',
    agent: 'Le contrôleur du bras, qui voit l’image de la caméra.',
    actions: 'Déplacer la pince, l’orienter, la fermer ou l’ouvrir.',
    reward: 'Un succès si l’objet est soulevé, rien sinon.',
    limits:
      'La récompense n’arrive qu’à la fin du geste, et chaque essai coûte du temps machine et de l’usure : il a fallu des centaines de milliers de tentatives. Un geste appris sur un poste se transfère mal à un autre.',
    problemIds: ['mountaincar', 'cartpole'],
    angle: {
      curieux:
        'Comme la voiture dans la vallée, le robot n’est « payé » qu’à la toute fin : tant qu’il n’a pas réussi une première prise par hasard, il ne sait pas quoi répéter.',
      etudiant:
        'C’est du Q-learning à actions continues avec une récompense binaire en fin d’épisode : le réseau estime la valeur d’un geste, et l’exploration initiale décide de tout.',
      dev:
        'L’apprentissage hors politique permet de réutiliser tous les essais stockés dans un tampon de rejeu ; le coût réel est la collecte de données, pas le calcul.',
      decideur:
        'Sur un poste fixe aux pièces connues, la vision classique et une trajectoire programmée coûtent moins cher ; l’apprentissage se justifie quand les objets changent sans cesse.',
    },
  },
  {
    id: 'locomotion-robots-a-pattes',
    title: 'Faire marcher un robot à quatre pattes',
    sector: 'Robotique mobile',
    story:
      'Un robot quadrupède doit marcher sur des terrains qu’il n’a jamais vus : herbe, escaliers, cailloux. L’ETH Zurich a montré avec le robot ANYmal qu’une marche apprise en simulation tient sur le terrain.',
    agent: 'Le contrôleur de marche, exécuté des dizaines de fois par seconde.',
    actions: 'La position visée de chaque articulation des pattes.',
    reward: 'Avancer à la vitesse demandée, moins des pénalités pour l’énergie dépensée, les à-coups et les chutes.',
    limits:
      'Tout repose sur le simulateur : frottements et moteurs y diffèrent toujours un peu du réel, et il faut les faire varier au hasard pendant l’entraînement. Régler les termes de la récompense demande de nombreux essais.',
    problemIds: ['quadruped3d', 'walker'],
    angle: {
      curieux:
        'Le robot tombe un nombre incalculable de fois, mais dans une sorte de jeu vidéo très réaliste : le vrai robot ne reçoit que le résultat final, comme dans notre robot 3D.',
      etudiant:
        'On apprend une politique à actions continues en simulation, en tirant au hasard masses et frottements à chaque épisode pour qu’elle reste valable sur le robot réel.',
      dev:
        'La recette courante est PPO sur des milliers de simulations parallèles sur GPU ; notre bac à sable utilise une stratégie d’évolution, plus simple mais bien plus gourmande en épisodes.',
      decideur:
        'Le prérequis est un simulateur fidèle et une équipe capable de l’entretenir ; sans lui, apprendre directement sur le matériel casse des robots.',
    },
  },
  {
    id: 'jeux-atari-go',
    title: 'Jouer à Atari et au go',
    sector: 'Recherche (jeux)',
    story:
      'En 2015, un même programme de DeepMind apprend des dizaines de jeux Atari à partir des seuls pixels et du score. En 2016, AlphaGo bat Lee Sedol, l’un des meilleurs joueurs de go.',
    agent: 'Le programme qui joue.',
    actions: 'Les boutons de la manette, ou la case où poser une pierre.',
    reward: 'Le score du jeu ; au go, uniquement la victoire ou la défaite en fin de partie.',
    limits:
      'Un jeu est un simulateur parfait, gratuit et sans danger, avec un score sans ambiguïté : presque aucun problème d’entreprise n’offre cela. Ces résultats ont demandé des millions de parties.',
    problemIds: ['grid', 'cartpole'],
    angle: {
      curieux:
        'C’est notre labyrinthe en très grand : sur Atari, personne n’explique les règles au programme, il joue énormément de parties et garde ce qui fait monter le score.',
      etudiant:
        'DQN est le Q-learning du labyrinthe où un réseau remplace le tableau ; AlphaGo ajoute une recherche arborescente guidée par un réseau de politique et un réseau de valeur.',
      dev:
        'Deux ajouts ont stabilisé le Q-learning avec réseau : le tampon de rejeu, qui casse la corrélation entre échantillons, et le réseau cible, mis à jour plus rarement.',
      decideur:
        'Ce sont des jalons de recherche, pas des produits : ils prouvent que la méthode fonctionne quand la simulation est exacte et illimitée, ce qui est rarement votre cas.',
    },
  },
  {
    id: 'refroidissement-centres-de-donnees',
    title: 'Refroidir un centre de données',
    sector: 'Énergie et bâtiment',
    story:
      'Refroidir des milliers de serveurs consomme beaucoup d’électricité, et le bon réglage dépend de la météo et de la charge. Google et DeepMind ont décrit un système d’abord conseiller (2016), puis pilote sous supervision (2018), fondé sur des modèles prédictifs : un cousin du RL plus qu’un cas d’école.',
    agent: 'Le logiciel de pilotage du refroidissement.',
    actions: 'Les consignes des pompes, ventilateurs et groupes froids.',
    reward: 'Moins d’énergie consommée, à condition que les températures restent dans les limites autorisées.',
    limits:
      'Impossible d’essayer au hasard sur une installation réelle : le système apprend d’abord des relevés passés, ses actions sont bornées par des règles de sécurité, et les opérateurs peuvent reprendre la main.',
    problemIds: ['cartpole'],
    angle: {
      curieux:
        'Comme pour le bâton en équilibre, il faut corriger en permanence par petites touches ; ici, l’« équilibre » est une température, et chaque correction coûte de l’électricité.',
      etudiant:
        'L’état est continu (capteurs), l’action aussi (consignes), et l’exploration est contrainte : on apprend surtout à partir de données historiques, donc hors ligne.',
      dev:
        'L’architecture utile est une politique apprise enfermée dans une enveloppe de sécurité codée en dur, qui rejette toute consigne hors bornes et rend la main à la régulation classique.',
      decideur:
        'Il faut des années de relevés de capteurs fiables et un objectif chiffré ; pour un bâtiment ordinaire, une régulation classique bien réglée capte déjà l’essentiel du gain.',
    },
  },
  {
    id: 'traitements-medicaux',
    title: 'Adapter un traitement au patient',
    sector: 'Santé (recherche)',
    story:
      'Certains traitements s’ajustent heure par heure selon la réaction du patient, par exemple en réanimation. Des équipes ont étudié, sur des dossiers anciens, si un algorithme pouvait suggérer ces ajustements ; cela reste de la recherche.',
    agent: 'Un outil d’aide à la décision ; le médecin reste seul décideur.',
    actions: 'Suggérer une dose ou une étape du protocole parmi quelques options.',
    reward: 'L’évolution de l’état du patient, difficile à résumer en un seul nombre.',
    limits:
      'Aucune exploration n’est acceptable sur un patient. On n’apprend donc que de décisions passées, prises par des médecins pour des raisons absentes des données, ce qui fausse facilement les conclusions. Toute piste doit passer par un essai clinique.',
    problemIds: ['bandit'],
    angle: {
      curieux:
        'Ici, on ne peut pas « essayer pour voir » comme avec les machines à sous : l’algorithme ne fait que relire d’anciens dossiers, et c’est le médecin qui décide.',
      etudiant:
        'C’est de l’apprentissage hors ligne : il faut estimer la valeur d’une politique jamais exécutée à partir de données produites par une autre, avec des facteurs de confusion non observés.',
      dev:
        'Le point dur est l’évaluation hors politique : sa variance explose dès que la politique apprise s’écarte des pratiques observées, et aucun test en ligne ne peut la valider.',
      decideur:
        'À traiter comme un sujet de recherche encadré (éthique, réglementation des dispositifs médicaux), pas comme un projet d’optimisation ; l’échéance se compte en années.',
    },
  },
  {
    id: 'plasma-tokamak',
    title: 'Maintenir un plasma de fusion',
    sector: 'Physique (recherche)',
    story:
      'Dans un tokamak, un gaz porté à très haute température est tenu à distance des parois par des champs magnétiques. En 2022, DeepMind et l’EPFL ont piloté ainsi le plasma du tokamak TCV, à Lausanne.',
    agent: 'Le contrôleur magnétique, qui décide des milliers de fois par seconde.',
    actions: 'Les tensions appliquées aux bobines magnétiques.',
    reward: 'L’écart entre la forme et la position du plasma obtenues et celles demandées.',
    limits:
      'Le contrôleur est entièrement appris dans un simulateur physique, puis exécuté tel quel sur la machine : tout dépend de la fidélité de ce simulateur. Le résultat porte sur le contrôle de la forme, pas sur la production d’énergie.',
    problemIds: ['cartpole'],
    angle: {
      curieux:
        'C’est le bâton en équilibre poussé à l’extrême : un plasma instable, qu’il faut rattraper par de minuscules corrections plusieurs milliers de fois par seconde.',
      etudiant:
        'C’est un problème de régulation à état et actions continus, résolu par une méthode acteur-critique entraînée en simulation, puis transférée sans réapprentissage sur le système réel.',
      dev:
        'La contrainte est le temps réel : l’acteur déployé est un petit réseau qui répond en une fraction de milliseconde, alors que le critique, plus gros, ne sert qu’à l’entraînement.',
      decideur:
        'Résultat de laboratoire, rendu possible par des décennies de modélisation physique ; à retenir pour vos projets : sans simulateur validé, cette approche n’existe pas.',
    },
  },
];
