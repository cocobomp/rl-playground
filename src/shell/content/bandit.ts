import type { ProblemContent } from './types';

export const CONTENT: ProblemContent = {
  byProfile: {
    curieux: {
      intro:
        'Imaginez une rue pleine de restaurants inconnus : retourner à celui qui vous a plu, ou en tenter un autre, peut-être meilleur ? Ici, les restaurants sont des machines à sous, et quatre joueurs automatiques cherchent la plus généreuse.',
      watch: [
        'Cliquez sur « Démarrer » et suivez le graphique « Regret » : une courbe qui s’aplatit a trouvé la bonne machine, une courbe qui monte tout droit continue de se tromper.',
        'Passez sur « À vous de jouer », cliquez sur les machines pour dépenser vos pièces, puis comparez votre score à celui des quatre stratégies.',
        'Cochez « Révéler les vraies probabilités » pour voir si la machine que vous préfériez était vraiment la meilleure.',
        'Essayez le scénario « Le casino change les réglages en cours de route » : qui remarque le changement, et au bout de combien de temps ?',
      ],
      takeaway:
        'Pour bien choisir, il faut accepter de perdre quelques pièces à essayer, mais de moins en moins à mesure que l’on en sait plus.',
    },
    etudiant: {
      intro:
        'Le bandit à K bras est le cas le plus simple du RL : un seul état, K actions, une récompense de Bernoulli. Il ne reste que le compromis exploration / exploitation, mesuré par le regret cumulé.',
      watch: [
        'Chaque stratégie estime la valeur d’une action par la moyenne incrémentale Q ← Q + (r − Q) / n ; seule la règle de choix change (ε-greedy, UCB, Thompson).',
        'Prédisez puis vérifiez avec « Machines très différentes » : regret linéaire pour « Glouton + hasard » (ε constant), à peu près logarithmique pour UCB et Thompson. Relancez plusieurs fois avec « Recommencer ».',
        'Choisissez « Thompson » dans « Afficher ce que sait » : les lois Beta(a₀ + gains, b₀ + pertes) se resserrent, et l’exploration s’éteint d’elle-même.',
        'Scénario « Le casino change les réglages en cours de route », puis « Mémoire courte » : le pas constant α remplace 1/n. Prédisez l’effet sur « % meilleure machine » après le trait vertical.',
      ],
      takeaway:
        'Une bonne politique d’exploration dirige ses essais vers les actions encore incertaines, au lieu de les répartir au hasard.',
    },
    dev: {
      intro:
        'Par stratégie, quelques tableaux de taille K (compteurs, estimations, gains et pertes pour Thompson) et un choix en O(K) par coup. « Paramètres experts » s’ouvre automatiquement pour ce profil.',
      watch: [
        'Le curseur « Curiosité » règle ε et c ensemble ; dans « Paramètres experts », séparez-les : « c (UCB) » à 0 rend UCB glouton après un essai par machine.',
        'Montez « Q₀ : estimation de départ (les deux gloutons) » à 100 % : l’optimisme initial force le glouton pur à essayer chaque machine, sans une ligne de code d’exploration.',
        'Piège classique : la moyenne en 1/n ne suit pas un environnement qui change. Cochez « Mémoire courte » et réglez « α : pas de la mémoire courte » (mémoire d’environ 1/α résultats).',
        'Une seule course ne prouve rien : chaque stratégie a son propre tirage. En production, on utilise plutôt des bandits contextuels (Vowpal Wabbit, par exemple), avec récompenses différées et décisions journalisées.',
      ],
      takeaway:
        'Sans état ni conséquence à long terme, un bandit suffit : gardez PPO ou SAC pour les problèmes où une action change la situation suivante.',
    },
    decideur: {
      intro:
        'Même situation que choisir entre plusieurs variantes d’une page, d’une offre ou d’un message sans savoir laquelle marche le mieux : chaque visiteur servi est une pièce jouée. Le regret, c’est le manque à gagner pendant qu’on apprend.',
      watch: [
        'Lancez « Démarrer » : la courbe « Regret » chiffre le coût de l’apprentissage. Le glouton pur montre le risque de figer trop tôt un choix médiocre.',
        'Scénario « Machines presque identiques » : quand les options se valent, il faut beaucoup d’essais pour les départager, et le gain espéré est faible. Un test A/B classique peut suffire.',
        'Scénario « Le casino change les réglages en cours de route » : si votre marché bouge, une méthode qui n’oublie rien reste sur l’ancienne gagnante. Comparez avec « Mémoire courte ».',
      ],
      takeaway:
        'Un bandit vaut la peine s’il existe une récompense mesurable rapidement, assez de trafic et un droit à l’erreur ; sinon, un test A/B ou une règle métier fait le travail.',
    },
  },
  realWorld: [
    {
      title: 'Tests A/B adaptatifs',
      text: 'Au lieu de partager le trafic à parts égales jusqu’à la fin du test, on en envoie peu à peu davantage vers les variantes qui marchent, souvent avec un échantillonnage de Thompson.',
    },
    {
      title: 'Recommandation de contenus',
      text: 'Choisir quel article ou quelle vignette montrer est un bandit « contextuel » : même dilemme, mais le choix dépend aussi du profil du visiteur. Yahoo! l’a documenté pour sa page d’actualités (algorithme LinUCB).',
    },
    {
      title: 'Essais cliniques adaptatifs',
      text: 'C’est la question d’origine de Thompson (1933) : orienter plus de patients vers le traitement qui semble le meilleur, sans conclure trop tôt. Usage réel mais très encadré, car l’exploration y a un coût humain.',
    },
  ],
};
