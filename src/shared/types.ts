/** Contrat commun à tous les problèmes du bac à sable. */
export interface ProblemModule {
  /**
   * Construit l'interface du problème dans `root` et démarre ce qu'il faut.
   * Renvoie une fonction de nettoyage (arrêt des boucles d'animation, workers, écouteurs globaux…),
   * appelée quand on change de problème.
   */
  mount(root: HTMLElement): () => void;
}

export interface ProblemInfo {
  /** Identifiant utilisé dans l'URL : #/<id> */
  id: string;
  /** Titre court affiché dans le menu. */
  title: string;
  /** Une phrase : de quoi il s'agit. */
  tagline: string;
  /** L'idée de RL que ce problème illustre. */
  concept: string;
  /** Algorithmes utilisés. */
  algorithms: string;
  level: 'Découverte' | 'Intermédiaire' | 'Avancé' | 'Expérimental';
  /** Temps indicatif pour saisir l'idée (ex. « 2 min »), affiché dans le parcours. Facultatif. */
  duration?: string;
  /** Chargement paresseux (le code 3D, lourd, n'est téléchargé que si on l'ouvre). */
  load: () => Promise<ProblemModule>;
}
