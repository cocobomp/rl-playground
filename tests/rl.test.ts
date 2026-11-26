import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, GridWorld, Params, Trainer, mulberry32 } from '../src/rl';

const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
const rewards = { goal: 10, trap: -10, step: -1 };

function params(over: Partial<Params> = {}): Params {
  return { ...DEFAULT_PARAMS, rewards: { ...DEFAULT_PARAMS.rewards }, ...over };
}

describe('GridWorld', () => {
  const w = GridWorld.fromStrings([
    'S.#',
    '.T.',
    '..G',
  ]);

  it('bloque sur les bords et les murs (l’agent reste sur place)', () => {
    expect(w.step(0, UP, rewards)).toEqual({ next: 0, reward: -1, done: false });
    expect(w.step(0, LEFT, rewards)).toEqual({ next: 0, reward: -1, done: false });
    expect(w.step(1, RIGHT, rewards)).toEqual({ next: 1, reward: -1, done: false }); // mur en (0,2)
  });

  it('se déplace normalement sur une case vide', () => {
    expect(w.step(0, RIGHT, rewards)).toEqual({ next: 1, reward: -1, done: false });
    expect(w.step(0, DOWN, rewards)).toEqual({ next: 3, reward: -1, done: false });
  });

  it('termine l’épisode sur un piège ou l’arrivée', () => {
    expect(w.step(1, DOWN, rewards)).toEqual({ next: 4, reward: -10, done: true });
    expect(w.step(7, RIGHT, rewards)).toEqual({ next: 8, reward: 10, done: true });
  });

  it('n’autorise qu’un seul départ', () => {
    const g = new GridWorld(3);
    g.setCell(0, 'start');
    g.setCell(5, 'start');
    expect(g.cells.filter((c) => c === 'start')).toHaveLength(1);
    expect(g.startState()).toBe(5);
  });

  it('refuse une grille non carrée', () => {
    expect(() => GridWorld.fromStrings(['S.', '.G', '..'])).toThrow();
  });
});

describe('Mise à jour de Q', () => {
  const corridor = GridWorld.fromStrings(['S.G', '...', '...']);

  it('Q-learning : Q += α (r + γ max Q(s′) − Q)', () => {
    const t = new Trainer(corridor, params({ alpha: 0.5, gamma: 0.9 }));
    t.q[1 * 4 + RIGHT] = 4; // max Q(s′=1)
    t.q[1 * 4 + LEFT] = 2;
    t.update(0, RIGHT, -1, 1, false, LEFT);
    // cible = -1 + 0.9 * 4 = 2.6 ; Q = 0 + 0.5 * 2.6
    expect(t.qValue(0, RIGHT)).toBeCloseTo(1.3);
  });

  it('SARSA : utilise l’action réellement choisie ensuite, pas le max', () => {
    const t = new Trainer(corridor, params({ alpha: 0.5, gamma: 0.9, algorithm: 'sarsa' }));
    t.q[1 * 4 + RIGHT] = 4;
    t.q[1 * 4 + LEFT] = 2;
    t.update(0, RIGHT, -1, 1, false, LEFT);
    // cible = -1 + 0.9 * 2 = 0.8 ; Q = 0.4
    expect(t.qValue(0, RIGHT)).toBeCloseTo(0.4);
  });

  it('ignore le futur sur une case terminale', () => {
    const t = new Trainer(corridor, params({ alpha: 1, gamma: 0.9 }));
    t.q[2 * 4 + UP] = 100; // ne doit pas compter
    t.update(1, RIGHT, 10, 2, true, -1);
    expect(t.qValue(1, RIGHT)).toBe(10);
  });
});

describe('Exploration', () => {
  it('ε décroît à chaque épisode sans passer sous le plancher', () => {
    const w = GridWorld.fromStrings(['SG', '..']);
    const t = new Trainer(w, params({ epsilon: 1, epsilonDecay: 0.5, epsilonMin: 0.1 }), mulberry32(1));
    t.runEpisode();
    expect(t.epsilon).toBeCloseTo(0.5);
    for (let i = 0; i < 10; i++) t.runEpisode();
    expect(t.epsilon).toBeCloseTo(0.1);
    expect(t.episode).toBe(11);
    expect(t.history).toHaveLength(11);
  });

  it('coupe un épisode trop long (maxSteps)', () => {
    const w = GridWorld.fromStrings(['S#G', '.#.', '.#.']); // arrivée inaccessible
    const t = new Trainer(w, params({ maxSteps: 25 }), mulberry32(2));
    const r = t.runEpisode();
    expect(r).toBeCloseTo(25 * DEFAULT_PARAMS.rewards.step);
  });

  it('est reproductible avec une graine fixe', () => {
    const w = GridWorld.fromStrings(['S...', '.T..', '..#.', '...G']);
    const a = new Trainer(w, params(), mulberry32(42));
    const b = new Trainer(w, params(), mulberry32(42));
    for (let i = 0; i < 30; i++) {
      a.runEpisode();
      b.runEpisode();
    }
    expect(Array.from(a.q)).toEqual(Array.from(b.q));
  });

  it('ne fait rien sans départ ni arrivée', () => {
    const t = new Trainer(new GridWorld(4), params());
    expect(t.canRun()).toBe(false);
    expect(t.step()).toBeNull();
  });
});

describe('Convergence', () => {
  // Un piège coupe le chemin direct : il faut contourner.
  const world = GridWorld.fromStrings([
    'S...',
    '.##.',
    '.T..',
    '...G',
  ]);

  for (const algorithm of ['qlearning', 'sarsa'] as const) {
    it(`${algorithm} apprend le plus court chemin sûr`, () => {
      const t = new Trainer(world, params({ algorithm, alpha: 0.5, epsilonDecay: 0.95 }), mulberry32(7));
      for (let i = 0; i < 400; i++) t.runEpisode();
      const path = t.greedyPath();
      expect(world.cells[path[path.length - 1]]).toBe('goal');
      expect(path).not.toContain(world.index(2, 1)); // évite le piège
      expect(path.length - 1).toBe(6); // 6 pas = distance minimale
      // Les dernières récompenses sont bien meilleures que les premières
      const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
      expect(avg(t.history.slice(-50))).toBeGreaterThan(avg(t.history.slice(0, 50)));
    });
  }
});

describe('Carte et préréglages de l’application', () => {
  it('la carte par défaut est résolue avec le préréglage « équilibré »', async () => {
    const { DEFAULT_MAP, DEFAULT_SETTINGS, PRESETS } = await import('../src/config');
    const world = GridWorld.fromStrings(DEFAULT_MAP);
    const settings = { ...DEFAULT_SETTINGS, rewards: { ...DEFAULT_SETTINGS.rewards }, ...PRESETS.balanced.settings } as Params;
    const t = new Trainer(world, settings, mulberry32(3));
    for (let i = 0; i < 300; i++) t.runEpisode();
    const path = t.greedyPath();
    expect(world.cells[path[path.length - 1]]).toBe('goal');
    expect(t.epsilon).toBeLessThan(0.05);
  });

  it('« explore trop » ne réduit jamais ε', async () => {
    const { DEFAULT_MAP, DEFAULT_SETTINGS, PRESETS } = await import('../src/config');
    const settings = { ...DEFAULT_SETTINGS, rewards: { ...DEFAULT_SETTINGS.rewards }, ...PRESETS.explore.settings } as Params;
    const t = new Trainer(GridWorld.fromStrings(DEFAULT_MAP), settings, mulberry32(4));
    for (let i = 0; i < 20; i++) t.runEpisode();
    expect(t.epsilon).toBe(1);
  });
});
