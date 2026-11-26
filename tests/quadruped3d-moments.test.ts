import { describe, expect, it } from 'vitest';
import { MAX_MOMENTS, MomentStore, REGULAR_EVERY } from '../src/problems/quadruped3d/moments';
import { DEFAULT_WORLD } from '../src/problems/quadruped3d/env';

const P = [1, 2, 3];
const W = { ...DEFAULT_WORLD };
const g = (generation: number, distance: number, fell = false) => ({ generation, distance, fell });

describe('moments clés', () => {
  it('génération 0, premier essai sans chute, paliers, records nets', () => {
    const s = new MomentStore();
    s.observe(g(0, 0.1, true), P, W);
    s.observe(g(1, -0.4, false), P, W); // debout sans avancer : pas encore « sans chute »
    s.observe(g(2, 0.5, false), P, W);
    s.observe(g(3, 1.2, false), P, W);
    s.observe(g(4, 1.25, false), P, W); // record trop petit : pas gardé
    s.observe(g(5, 1.6, false), P, W); // record net
    s.observe(g(6, 3.4, false), P, W);
    const kinds = s.moments.map((m) => `${m.generation}:${m.kind}`);
    expect(kinds).toEqual(['0:start', '2:nofall', '3:milestone', '5:record', '6:milestone']);
    expect(s.moments[0].label).toBe('Génération 0 : il tombe tout de suite');
    expect(s.moments[1].label).toBe('Génération 2 : premier essai sans chute, 0,5 m');
    expect(s.moments[4].label).toContain('cap des 3 m');
  });

  it('premier essai sans chute et palier dans la même génération : un seul moment', () => {
    const s = new MomentStore();
    s.observe(g(0, 0.1, true), P, W);
    s.observe(g(1, 1.4, false), P, W);
    expect(s.moments.map((m) => m.label)).toEqual([
      'Génération 0 : il tombe tout de suite',
      'Génération 1 : premier essai sans chute et cap des 1 m franchi (1,4 m)',
    ]);
  });

  it('avant et juste après un changement de monde', () => {
    const s = new MomentStore();
    s.observe(g(0, 5, false), P, W);
    s.markChange({ ...g(0, 5, false), params: P, world: W }, 'patte avant gauche cassée');
    const broken = { ...W, brokenFrontLeft: true };
    s.observe(g(1, 0.8, false), P, broken);
    const [, before, after] = s.moments;
    expect(before.kind).toBe('before');
    expect(before.label).toBe('Avant : patte avant gauche cassée');
    expect(before.world.brokenFrontLeft).toBe(false);
    expect(after.kind).toBe('after');
    expect(after.label).toContain('juste après « patte avant gauche cassée »');
    expect(after.world.brokenFrontLeft).toBe(true);
    // Les paliers repartent de zéro dans le nouveau monde.
    s.observe(g(2, 1.1, false), P, broken);
    expect(s.moments[s.moments.length - 1].kind).toBe('milestone');
  });

  it('« Réapprendre » marque la génération suivante, une génération régulière de temps en temps', () => {
    const s = new MomentStore();
    s.addOffline([{ generation: 300, kind: 'offline', label: 'hors ligne', distance: 9, fell: false, params: Float64Array.from(P), world: W }]);
    s.markRestart();
    s.observe(g(0, 9, false), P, W);
    expect(s.moments[1].kind).toBe('after');
    s.observe(g(REGULAR_EVERY, 9, false), P, W);
    expect(s.moments[2].kind).toBe('regular');
  });

  it('mémoire bornée : on éclaircit les générations régulières, jamais les moments clés', () => {
    const s = new MomentStore();
    s.observe(g(0, 0, true), P, W);
    for (let i = 1; i <= 2000; i++) s.observe(g(i, 0.5, true), P, W);
    expect(s.moments.length).toBeLessThanOrEqual(MAX_MOMENTS);
    expect(s.moments[0].kind).toBe('start');
    s.markChange({ ...g(2000, 0.5, true), params: P, world: W }, 'sol glissant');
    for (let i = 2001; i <= 4000; i++) s.observe(g(i, 0.5, true), P, W);
    expect(s.moments.length).toBeLessThanOrEqual(MAX_MOMENTS);
    expect(s.moments.some((m) => m.kind === 'before')).toBe(true);
    expect(s.moments.some((m) => m.kind === 'after')).toBe(true);
    // Les générations régulières restantes sont les plus récentes.
    const reg = s.moments.filter((m) => m.kind === 'regular');
    expect(reg[reg.length - 1].generation).toBe(4000);
  });
});
