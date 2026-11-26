import { describe, expect, it } from 'vitest';
import { DEFAULT_OBJECTIVES, HEALTHY, OBS_SIZE, Walker, WorldConfig } from '../src/problems/walker/env';
import { evaluate, evaluateShare, makeES, policyFromJSON, randomParams, BrainJSON } from '../src/problems/walker/agent';
import { DISTANCE_MILESTONES, MAX_MOMENTS, Timeline, StoryJSON } from '../src/problems/walker/timeline';
import { workersFor } from '../src/problems/walker/speed';
import healthy from '../src/problems/walker/pretrained/healthy.json';
import injured from '../src/problems/walker/pretrained/injured.json';
import storyHealthy from '../src/problems/walker/pretrained/story-healthy.json';
import storyInjured from '../src/problems/walker/pretrained/story-injured.json';

const KNEE_LOCKED: WorldConfig = { ...HEALTHY, lockLeftKnee: true };

/** Amplitude (max − min, rad) de chaque articulation pendant un essai, après 2 s de mise en route. */
function amplitudes(brain: BrainJSON, config: WorldConfig): number[] {
  const pol = policyFromJSON(brain);
  const w = new Walker(config);
  const obs = new Float64Array(OBS_SIZE);
  const lo = [Infinity, Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity, -Infinity];
  while (!w.done) {
    w.step(pol.act(w.observe(obs)));
    if (w.time < 2) continue;
    w.joints.forEach((j, i) => {
      const a = j.getJointAngle();
      lo[i] = Math.min(lo[i], a);
      hi[i] = Math.max(hi[i], a);
    });
  }
  return hi.map((h, i) => h - lo[i]);
}

describe('les deux jambes travaillent (cerveaux livrés)', () => {
  it('cerveau sain : hanches et genoux des deux jambes bougent nettement', () => {
    const [hl, kl, hr, kr] = amplitudes(healthy as BrainJSON, HEALTHY);
    for (const a of [hl, hr]) expect(a).toBeGreaterThan(0.5);
    for (const a of [kl, kr]) expect(a).toBeGreaterThan(0.3);
    // Aucune jambe ne se contente de suivre : l'amplitude de l'une vaut au moins 40 % de l'autre.
    expect(Math.min(hl, hr) / Math.max(hl, hr)).toBeGreaterThan(0.4);
  });

  it('cerveau adapté : genou gauche figé, mais les deux hanches et le genou droit bougent', () => {
    const [hl, kl, hr, kr] = amplitudes(injured as BrainJSON, KNEE_LOCKED);
    // Le genou bloqué ne plie plus que de la souplesse de sa butée sous le poids du robot (≈ 0,2 rad), contre 0,7 rad et plus libre.
    expect(kl).toBeLessThan(0.3);
    for (const a of [hl, hr]) expect(a).toBeGreaterThan(0.5);
    expect(kr).toBeGreaterThan(0.3);
  });
});

describe('moments clés', () => {
  const obs = (gen: number, distance: number, fell: boolean) => ({
    gen,
    params: [gen, distance],
    config: HEALTHY,
    distance,
    fell,
    fitness: distance - (fell ? 3 : 0),
  });

  it('repère le départ, le premier essai sans chute, les paliers et les records', () => {
    const tl = new Timeline();
    tl.observe(obs(0, 0.2, true), true);
    tl.observe(obs(1, 0.3, true));
    tl.observe(obs(2, 0.8, false));
    tl.observe(obs(3, 1.4, false));
    tl.observe(obs(4, 1.6, false)); // petit progrès (< 1 m) : pas de nouveau moment
    tl.observe(obs(5, 6.2, false)); // franchit 3 et 5 m d'un coup : un seul palier (5 m)
    const kinds = tl.moments.map((m) => `${m.gen}:${m.kind}`);
    expect(kinds).toEqual(['0:start', '2:firstStand', '3:milestone', '5:milestone']);
    expect(tl.moments[0].label).toBe('Génération 0 : il tombe tout de suite');
    expect(tl.moments[1].label).toBe('Génération 2 : premier essai sans chute, mais il fait du surplace (0,8 m)');
    expect(tl.moments[3].label).toBe('Génération 5 : premier essai à plus de 5 m');
    expect(DISTANCE_MILESTONES).toContain(5);
  });

  it('un petit record remplace le précédent ; un gros record s’ajoute', () => {
    const tl = new Timeline();
    tl.observe(obs(0, 5.2, false), true);
    tl.observe(obs(1, 5.5, false));
    tl.observe(obs(2, 5.9, false));
    const recs = () => tl.moments.filter((m) => m.kind === 'record').map((m) => m.gen);
    expect(recs()).toEqual([]);
    tl.observe(obs(3, 6.5, false)); // + 1,3 m : nouveau moment
    expect(recs()).toEqual([3]);
    tl.observe(obs(4, 7.0, false)); // + 0,5 m : remplace le record précédent
    expect(recs()).toEqual([4]);
    expect(tl.moments[tl.moments.length - 1].label).toBe('Génération 4 : record, 7,0 m');
    tl.observe(obs(5, 8.6, false));
    expect(recs()).toEqual([4, 5]);
    tl.observe(obs(10, 8.0, false)); // pas de progrès : instantané régulier toutes les 10 générations
    expect(tl.moments[tl.moments.length - 1].kind).toBe('regular');
  });

  it('mémoire bornée : jamais plus de MAX_MOMENTS, les moments clés ne sont jamais supprimés', () => {
    const tl = new Timeline();
    tl.observe(obs(0, 0, true), true);
    for (let g = 1; g <= 3000; g++) tl.observe(obs(g, Math.min(29, g / 40) + (g % 7) * 0.01, g < 30));
    tl.push({ ...obs(3000, 10, false), kind: 'before' });
    tl.newSegment();
    for (let g = 3001; g <= 6000; g++) tl.observe({ ...obs(g, (g - 3000) / 100, false), config: KNEE_LOCKED });
    expect(tl.moments.length).toBeLessThanOrEqual(MAX_MOMENTS);
    const kinds = new Set(tl.moments.map((m) => m.kind));
    for (const k of ['start', 'firstStand', 'milestone', 'before', 'record']) expect(kinds.has(k as never)).toBe(true);
    expect(tl.moments.filter((m) => m.kind === 'milestone').length).toBe(2 * DISTANCE_MILESTONES.length - 1);
    // ordre chronologique conservé
    const gens = tl.moments.map((m) => m.gen);
    expect([...gens].sort((a, b) => a - b)).toEqual(gens);
    expect(tl.nearest(2999)!.gen).toBeGreaterThan(2900);
  });
});

describe('histoires livrées avec les cerveaux pré-entraînés', () => {
  const check = (story: StoryJSON, final: BrainJSON, config: WorldConfig) => {
    expect(story.moments.length).toBeGreaterThanOrEqual(5);
    const last = story.moments.find((m) => m.kind === 'final')!;
    expect(last).toBeDefined();
    expect(last.params).toEqual(final.params);
    // Chaque distance affichée est exactement celle que la page rejouera.
    for (const m of story.moments) {
      const r = evaluate(Float64Array.from(m.params), { ...HEALTHY, ...m.config }, DEFAULT_OBJECTIVES);
      expect(r.distance).toBeCloseTo(m.distance, 3);
      expect(r.fell).toBe(m.fell);
    }
    void config;
    const n = story.curve.bestDist.length;
    expect(story.curve.meanDist).toHaveLength(n);
    expect(story.endGen - story.moments[0].gen).toBe(n);
  };
  it('robot sain : de la chute immédiate au cerveau final', () => {
    check(storyHealthy as StoryJSON, healthy as BrainJSON, HEALTHY);
    const ms = (storyHealthy as StoryJSON).moments;
    expect(ms[0].gen).toBe(0);
    expect(ms[0].fell).toBe(true);
    expect(ms.some((m) => m.kind === 'firstStand')).toBe(true);
  }, 30_000);
  it('genou bloqué : juste après la blessure, puis adaptation', () => {
    check(storyInjured as StoryJSON, injured as BrainJSON, KNEE_LOCKED);
    expect((storyInjured as StoryJSON).moments[0].kind).toBe('after');
  }, 30_000);
  it('fichiers légers (< 400 Ko au total avec les cerveaux)', () => {
    const total = [healthy, injured, storyHealthy, storyInjured].reduce((a, x) => a + JSON.stringify(x).length, 0);
    expect(total).toBeLessThan(400_000);
  });
});

describe('vitesse d’apprentissage', () => {
  it('nombre de workers : Rapide = cœurs − 1 (entre 1 et 6), Turbo prend aussi le dernier cœur', () => {
    expect(4).toBe(4);
    expect(workersFor('fast', 4)).toBe(3);
    expect(workersFor('normal', 4)).toBe(2);
    expect(workersFor('turbo', 4)).toBe(4);
    expect(workersFor('fast', 1)).toBe(1);
    expect(workersFor('turbo', 1)).toBe(1);
    expect(workersFor('fast', 16)).toBe(6);
    expect(workersFor('turbo', 16)).toBe(6);
  });

  it('résultat identique quel que soit le nombre de workers actifs (évaluation par indice)', () => {
    const run = (actives: number[]) => {
      const K = 4;
      const replicas = Array.from({ length: K }, () => makeES(randomParams(5), { popSize: 8, sigma: 0.1, lr: 0.05 }, 77));
      for (const active of actives) {
        const cands = replicas.map((es) => es.ask());
        const scored = replicas.flatMap((_, k) => evaluateShare(cands[k], k, active, HEALTHY, DEFAULT_OBJECTIVES));
        scored.sort((a, b) => a.i - b.i);
        expect(scored.map((s) => s.i)).toEqual(cands[0].map((_, i) => i));
        for (const es of replicas) es.tell(scored.map((s) => s.r.fitness));
      }
      for (const es of replicas) expect(Array.from(es.theta)).toEqual(Array.from(replicas[0].theta));
      return Array.from(replicas[0].theta);
    };
    expect(run([1, 1, 1])).toEqual(run([3, 2, 4]));
  }, 30_000);
});
