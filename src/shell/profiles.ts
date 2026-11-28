// Profils de lecteur : le même bac à sable, expliqué différemment selon qui regarde.
// Logique sans DOM (testée) : choix initial, mémorisation, abonnement aux changements.

export type ProfileId = 'curieux' | 'etudiant' | 'dev' | 'decideur';

export interface ProfileInfo {
  id: ProfileId;
  label: string;
  /** Une ligne : pour qui, et ce que ce profil met en avant. */
  blurb: string;
}

export const PROFILES: readonly ProfileInfo[] = [
  { id: 'curieux', label: 'Curieux', blurb: 'Aucune connaissance requise : des images simples et quoi regarder à l’écran.' },
  { id: 'etudiant', label: 'Étudiant', blurb: 'Le vocabulaire exact, les formules et les expériences à refaire soi-même.' },
  { id: 'dev', label: 'Développeur', blurb: 'Comment c’est construit : algorithmes, réglages, pièges d’implémentation.' },
  { id: 'decideur', label: 'Décideur', blurb: 'À quoi ça sert en entreprise, ce que ça coûte et quand ne pas l’utiliser.' },
];

export const DEFAULT_PROFILE: ProfileId = 'curieux';
const STORAGE_KEY = 'rl-playground:profil';

export function isProfileId(v: unknown): v is ProfileId {
  return typeof v === 'string' && PROFILES.some((p) => p.id === v);
}

/** Profil initial : ?profil=… dans l'URL, sinon le dernier choisi, sinon « curieux ». */
export function initialProfile(search: string, stored: string | null): ProfileId {
  const fromUrl = new URLSearchParams(search).get('profil');
  if (isProfileId(fromUrl)) return fromUrl;
  if (isProfileId(stored)) return stored;
  return DEFAULT_PROFILE;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // navigation privée, iframe sans stockage…
  }
}

let current: ProfileId | null = null;
const listeners = new Set<(p: ProfileId) => void>();

export function getProfile(): ProfileId {
  if (current === null) current = initialProfile(typeof location === 'undefined' ? '' : location.search, readStored());
  return current;
}

export function setProfile(p: ProfileId): void {
  if (p === getProfile()) return;
  current = p;
  try {
    localStorage.setItem(STORAGE_KEY, p);
  } catch {
    /* pas de stockage : le choix vaut pour cette visite */
  }
  listeners.forEach((cb) => cb(p));
}

/** S'abonne aux changements de profil. Renvoie la fonction de désabonnement. */
export function onProfileChange(cb: (p: ProfileId) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
