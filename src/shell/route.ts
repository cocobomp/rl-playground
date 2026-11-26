// Logique pure du routeur et du parcours (sans DOM, testée dans tests/shell.test.ts).

export type Route =
  | { kind: 'home' }
  | { kind: 'glossary'; term?: string }
  | { kind: 'problem'; id: string };

export const GLOSSARY_ID = 'glossaire';

/**
 * Lit un hash d'URL (« #/grid », « #/glossaire/gamma »…).
 * Tout ce qui n'est pas un problème connu ni le glossaire mène à l'accueil.
 */
export function parseRoute(hash: string, problemIds: readonly string[]): Route {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/');
  const id = decodeURIComponentSafe(parts[0] ?? '');
  if (id === GLOSSARY_ID) {
    const term = parts[1] ? decodeURIComponentSafe(parts[1]) : '';
    return term ? { kind: 'glossary', term } : { kind: 'glossary' };
  }
  if (id && problemIds.includes(id)) return { kind: 'problem', id };
  return { kind: 'home' };
}

/** Identifiant utilisé par le menu pour surligner l'onglet actif. */
export function navId(route: Route): string {
  if (route.kind === 'problem') return route.id;
  if (route.kind === 'glossary') return GLOSSARY_ID;
  return '';
}

/** Le problème qui suit `id` dans le parcours, ou null pour le dernier (ou un id inconnu). */
export function nextInPath<T extends { id: string }>(problems: readonly T[], id: string): T | null {
  const i = problems.findIndex((p) => p.id === id);
  if (i < 0 || i >= problems.length - 1) return null;
  return problems[i + 1];
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
