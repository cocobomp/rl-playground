import { describe, expect, it } from 'vitest';
import { PROBLEMS } from '../src/problems/index';
import { GLOSSARY } from '../src/shell/glossary';
import { GLOSSARY_ID, navId, nextInPath, parseRoute } from '../src/shell/route';

const ids = PROBLEMS.map((p) => p.id);

describe('parseRoute', () => {
  it('reconnaît les problèmes', () => {
    expect(parseRoute('#/grid', ids)).toEqual({ kind: 'problem', id: 'grid' });
    expect(parseRoute('#/bandit?x=1', ids)).toEqual({ kind: 'problem', id: 'bandit' });
    expect(parseRoute('#/walker/autre', ids)).toEqual({ kind: 'problem', id: 'walker' });
  });

  it('renvoie à l’accueil pour un hash vide ou inconnu', () => {
    for (const h of ['', '#', '#/', '#/inconnu', '#/%E0%A4%A', '#/__proto__', '#/constructor']) {
      expect(parseRoute(h, ids)).toEqual({ kind: 'home' });
    }
  });

  it('reconnaît le glossaire et un terme ciblé', () => {
    expect(parseRoute(`#/${GLOSSARY_ID}`, ids)).toEqual({ kind: 'glossary' });
    expect(parseRoute(`#/${GLOSSARY_ID}/gamma`, ids)).toEqual({ kind: 'glossary', term: 'gamma' });
  });

  it('donne l’onglet actif du menu', () => {
    expect(navId({ kind: 'home' })).toBe('');
    expect(navId({ kind: 'glossary', term: 'x' })).toBe(GLOSSARY_ID);
    expect(navId({ kind: 'problem', id: 'grid' })).toBe('grid');
  });
});

describe('parcours', () => {
  it('enchaîne les problèmes dans l’ordre du registre, et s’arrête au dernier', () => {
    for (let i = 0; i < PROBLEMS.length - 1; i++) {
      expect(nextInPath(PROBLEMS, PROBLEMS[i].id)?.id).toBe(PROBLEMS[i + 1].id);
    }
    expect(nextInPath(PROBLEMS, PROBLEMS[PROBLEMS.length - 1].id)).toBeNull();
    expect(nextInPath(PROBLEMS, 'inconnu')).toBeNull();
  });

  it('chaque étape a une idée et une durée indicative', () => {
    for (const p of PROBLEMS) {
      expect(p.concept.length).toBeGreaterThan(10);
      expect(p.duration).toMatch(/^\d+ min$/);
    }
  });

  it('le glossaire n’entre pas en conflit avec un problème', () => {
    expect(ids).not.toContain(GLOSSARY_ID);
  });
});

describe('glossaire', () => {
  it('contient entre 12 et 20 termes, avec des ancres uniques', () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(12);
    expect(GLOSSARY.length).toBeLessThanOrEqual(20);
    const anchors = GLOSSARY.map((t) => t.id);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const a of anchors) expect(a).toMatch(/^[a-z0-9-]+$/);
  });

  it('ne renvoie qu’à des problèmes existants', () => {
    for (const t of GLOSSARY) {
      for (const id of t.seeIn ?? []) expect(ids).toContain(id);
    }
  });

  it('a des définitions d’une phrase, non vides', () => {
    for (const t of GLOSSARY) {
      expect(t.definition.length).toBeGreaterThan(30);
      expect(t.definition.length).toBeLessThan(260);
    }
  });

  it('couvre les notions clés du parcours', () => {
    const terms = GLOSSARY.map((t) => t.term).join(' | ');
    for (const k of ['Agent', 'Environnement', 'État', 'Action', 'Récompense', 'Épisode', 'Politique', 'ε-greedy', 'α', 'γ', 'Regret', 'Q-learning', 'SARSA', 'Réseau de neurones', 'évolution', 'reward shaping', 'Simulation physique']) {
      expect(terms).toContain(k);
    }
  });
});
