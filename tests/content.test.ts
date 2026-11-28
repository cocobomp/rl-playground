import { describe, expect, it } from 'vitest';
import { PROBLEMS } from '../src/problems/index';
import { APPLICATIONS, PROBLEM_CONTENT } from '../src/shell/content/index';
import { DEFAULT_PROFILE, PROFILES, initialProfile, isProfileId } from '../src/shell/profiles';
import { typo } from '../src/shell/profile-ui';
import { APPLICATIONS_ID, navId, parseRoute } from '../src/shell/route';

const ids = PROBLEMS.map((p) => p.id);
const profileIds = PROFILES.map((p) => p.id);
const PLACEHOLDER = 'À rédiger';
const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

describe('contenu par profil des problèmes', () => {
  it('couvre exactement les problèmes du registre', () => {
    expect(Object.keys(PROBLEM_CONTENT).sort()).toEqual([...ids].sort());
  });

  describe.each(ids)('%s', (id) => {
    const content = PROBLEM_CONTENT[id];

    it.each(profileIds)('profil %s : intro, pistes et phrase à retenir', (profile) => {
      const a = content.byProfile[profile];
      expect(a, `profil ${profile} manquant`).toBeDefined();
      expect(a.intro.trim()).not.toBe('');
      expect(words(a.intro)).toBeLessThanOrEqual(60);
      expect(a.takeaway.trim()).not.toBe('');
      expect(a.watch.length).toBeGreaterThanOrEqual(2);
      expect(a.watch.length).toBeLessThanOrEqual(4);
      for (const w of a.watch) expect(w.trim()).not.toBe('');
    });

    it('donne des voix distinctes aux quatre profils', () => {
      const intros = profileIds.map((p) => content.byProfile[p].intro);
      expect(new Set(intros).size).toBe(profileIds.length);
    });

    it('relie le problème à 2 ou 3 projets réels', () => {
      expect(content.realWorld.length).toBeGreaterThanOrEqual(2);
      expect(content.realWorld.length).toBeLessThanOrEqual(3);
      for (const r of content.realWorld) {
        expect(r.title.trim()).not.toBe('');
        expect(r.text.trim()).not.toBe('');
      }
    });

    it('ne contient plus de texte provisoire', () => {
      expect(JSON.stringify(content)).not.toContain(PLACEHOLDER);
    });
  });
});

describe('page « Dans la vraie vie »', () => {
  it('propose au moins 6 projets aux identifiants uniques, en kebab-case', () => {
    expect(APPLICATIONS.length).toBeGreaterThanOrEqual(6);
    const appIds = APPLICATIONS.map((a) => a.id);
    expect(new Set(appIds).size).toBe(appIds.length);
    for (const id of appIds) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it.each(APPLICATIONS.map((a) => [a.id, a] as const))('%s : fiche complète', (_id, app) => {
    for (const field of [app.title, app.sector, app.story, app.agent, app.actions, app.reward, app.limits]) {
      expect(field.trim()).not.toBe('');
    }
    expect(app.problemIds.length).toBeGreaterThanOrEqual(1);
    expect(app.problemIds.length).toBeLessThanOrEqual(2);
    for (const pid of app.problemIds) expect(ids).toContain(pid);
    for (const profile of profileIds) expect((app.angle[profile] ?? '').trim()).not.toBe('');
    expect(new Set(profileIds.map((p) => app.angle[p])).size).toBe(profileIds.length);
    expect(JSON.stringify(app)).not.toContain(PLACEHOLDER);
  });

  it('illustre chaque problème du bac à sable par au moins un projet réel', () => {
    const covered = new Set(APPLICATIONS.flatMap((a) => a.problemIds));
    for (const id of ids) expect(covered, `aucun projet réel ne renvoie à ${id}`).toContain(id);
  });
});

describe('profils de lecteur', () => {
  it('reconnaît les quatre profils et rien d’autre', () => {
    for (const id of ['curieux', 'etudiant', 'dev', 'decideur']) expect(isProfileId(id)).toBe(true);
    for (const v of ['', 'Curieux', 'expert', 'toString', null, undefined, 3]) expect(isProfileId(v)).toBe(false);
  });

  it('donne la priorité au paramètre d’URL sur le choix mémorisé', () => {
    expect(initialProfile('?profil=dev', 'etudiant')).toBe('dev');
    expect(initialProfile('?x=1&profil=decideur', null)).toBe('decideur');
  });

  it('reprend le choix mémorisé si l’URL ne dit rien de valable', () => {
    expect(initialProfile('', 'etudiant')).toBe('etudiant');
    expect(initialProfile('?profil=inconnu', 'dev')).toBe('dev');
  });

  it('retombe sur « curieux » pour des valeurs invalides', () => {
    expect(DEFAULT_PROFILE).toBe('curieux');
    expect(initialProfile('', null)).toBe('curieux');
    expect(initialProfile('?profil=inconnu', 'nimporte')).toBe('curieux');
    expect(initialProfile('?profil=', '')).toBe('curieux');
  });
});

describe('route des projets réels', () => {
  it('reconnaît #/applications', () => {
    expect(parseRoute('#/applications', ids)).toEqual({ kind: 'applications' });
    expect(parseRoute('#/applications?profil=dev', ids)).toEqual({ kind: 'applications' });
    expect(navId(parseRoute('#/applications', ids))).toBe(APPLICATIONS_ID);
  });
});

describe('typographie à l’affichage', () => {
  it('pose une espace insécable avant : ; ? ! % et dans les guillemets', () => {
    expect(typo('Prêt ? Oui : « 5 % » ; bien !')).toBe('Prêt\u00a0? Oui\u00a0: «\u00a05\u00a0%\u00a0»\u00a0; bien\u00a0!');
  });

  it('ne change rien à un texte déjà correct ni aux formules', () => {
    const ok = 'Q ← Q + (r − Q) / n\u00a0: déjà bon';
    expect(typo(ok)).toBe(ok);
    expect(typo(typo('a : b'))).toBe(typo('a : b'));
  });
});
