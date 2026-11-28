import type { ProfileId } from '../profiles';

/** Ce qu'un profil lit au-dessus d'un problème. Textes courts, en français, « vous ». */
export interface ProfileAngle {
  /** 1 à 2 phrases : le problème vu par ce profil. */
  intro: string;
  /** 2 à 4 choses concrètes à faire ou à regarder dans CE problème (boutons et libellés réels). */
  watch: string[];
  /** Une phrase à retenir. */
  takeaway: string;
}

export interface RealWorldLink {
  /** Projet ou domaine réel (ex. « Recommandation de contenus »). */
  title: string;
  /** 1 à 2 phrases : le lien avec ce problème, sans exagérer. */
  text: string;
}

export interface ProblemContent {
  byProfile: Record<ProfileId, ProfileAngle>;
  /** 2 à 3 projets réels où l'idée de ce problème sert vraiment. */
  realWorld: RealWorldLink[];
}

/** Un projet réel de la page « Dans la vraie vie ». */
export interface Application {
  id: string;
  title: string;
  sector: string;
  /** Le problème concret, en 1 à 2 phrases. */
  story: string;
  /** Qui est l'agent, quelles actions, quelle récompense. */
  agent: string;
  actions: string;
  reward: string;
  /** Ce qui rend le projet difficile ou risqué en pratique. */
  limits: string;
  /** Problèmes du bac à sable qui illustrent l'idée (ids du registre). */
  problemIds: string[];
  /** Une phrase par profil : ce que ce lecteur doit en retenir. */
  angle: Record<ProfileId, string>;
}
