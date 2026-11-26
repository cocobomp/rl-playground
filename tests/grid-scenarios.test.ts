import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, GridWorld, Trainer, mulberry32 } from '../src/problems/grid/rl';
import { DEFAULT_SETTINGS, SCENARIOS, Scenario, Settings, scenarioSettings } from '../src/problems/grid/config';
import { TRAITS, applyPersonality, detectAll, detectLevel } from '../src/problems/grid/personality';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Entraîne sur un scénario (avec éventuellement d'autres traits) et renvoie le meilleur chemin appris. */
function train(sc: Scenario, levels: Partial<Record<string, number>>, seed: number, extra: Partial<Settings> = {}) {
  const s = scenarioSettings(sc);
  applyPersonality(s, levels);
  Object.assign(s, extra);
  const world = GridWorld.fromStrings(sc.map);
  const t = new Trainer(world, s, mulberry32(seed));
  for (let i = 0; i < sc.episodes; i++) t.runEpisode();
  const path = t.greedyPath();
  return { world, t, path, end: world.cells[path[path.length - 1]], steps: path.length - 1 };
}

describe('Petit trésor (case bonus)', () => {
  const w = GridWorld.fromStrings(['Sg', '.G']);
  it('termine l’épisode avec sa propre récompense', () => {
    expect(w.cells[1]).toBe('bonus');
    expect(w.isTerminal(1)).toBe(true);
    expect(w.step(0, 1, { goal: 10, trap: -10, step: -1, small: 4 })).toEqual({ next: 1, reward: 4, done: true });
    expect(w.step(0, 1, { goal: 10, trap: -10, step: -1 }).reward).toBe(3); // valeur par défaut
  });
  it('compte comme une arrivée possible et se relit en texte', () => {
    const only = GridWorld.fromStrings(['Sg', '..']);
    expect(only.hasGoal()).toBe(true);
    expect(w.toStrings()).toEqual(['Sg', '.G']);
  });
});

describe('Personnalité → paramètres techniques', () => {
  it('chaque niveau appliqué est ensuite reconnu', () => {
    for (const trait of TRAITS) {
      trait.levels.forEach((level, i) => {
        const s = structuredClone(DEFAULT_SETTINGS);
        level.apply(s);
        expect(detectLevel(trait, s), `${trait.id} / ${level.label}`).toBe(i);
      });
    }
  });
  it('les réglages par défaut correspondent à une personnalité reconnue', () => {
    expect(detectAll(DEFAULT_SETTINGS)).toEqual({ curiosity: 1, vision: 3, prudence: 0, impatience: 2, memory: 2, world: 0 });
  });
  it('une valeur experte hors des crans devient « personnalisé » (-1)', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.gamma = 0.9;
    s.algorithm = 'sarsa'; // SARSA avec piège −10 : aucun niveau de prudence
    const d = detectAll(s);
    expect(d.vision).toBe(-1);
    expect(d.prudence).toBe(-1);
    expect(d.memory).toBe(2);
  });
  it('les traits traduisent bien vers les bons paramètres', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    applyPersonality(s, { curiosity: 0, vision: 0, prudence: 2, impatience: 4, memory: 4, world: 2 });
    expect(s).toMatchObject({ epsilon: 0.1, epsilonDecay: 1, gamma: 0.5, algorithm: 'sarsa', alpha: 1, slip: 0.2 });
    expect(s.rewards).toMatchObject({ trap: -100, step: -1 });
  });
  it('un scénario part toujours des réglages par défaut', () => {
    const s = scenarioSettings(SCENARIOS.cliff);
    expect(s.episodes).toBe(500);
    expect(s.rewards.goal).toBe(DEFAULT_PARAMS.rewards.goal);
  });
});

describe('Scénario « La falaise » : Q-learning longe le bord, SARSA s’en écarte', () => {
  const sc = SCENARIOS.cliff;
  const highestRow = (r: ReturnType<typeof train>) => Math.min(...r.path.map((s) => r.world.rowCol(s)[0]));

  it('Q-learning (« mesuré ») : le meilleur chemin colle au bord de la falaise', () => {
    const runs = SEEDS.map((seed) => train(sc, {}, seed));
    runs.forEach((r) => expect(r.end).toBe('goal'));
    const hugging = runs.filter((r) => highestRow(r) === 6 && r.steps === 9).length;
    expect(hugging).toBeGreaterThanOrEqual(8);
  });

  it('SARSA (« prudent », même pénalité) : il marche au moins un rang plus haut', () => {
    const runs = SEEDS.map((seed) => train(sc, { prudence: 2 }, seed));
    runs.forEach((r) => {
      expect(r.end).toBe('goal');
      expect(highestRow(r)).toBeLessThanOrEqual(5);
    });
  });
});

describe('Scénario « La falaise » : récompense pendant l’apprentissage', () => {
  it('SARSA gagne en moyenne plus que Q-learning (il tombe moins en explorant)', () => {
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    for (const seed of [1, 2, 3]) {
      const q = train(SCENARIOS.cliff, {}, seed);
      const s = train(SCENARIOS.cliff, { prudence: 2 }, seed);
      expect(avg(s.t.history.slice(-200))).toBeGreaterThan(avg(q.t.history.slice(-200)));
    }
  });
});

describe('Scénario « Le grand détour »', () => {
  const sc = SCENARIOS.detour;
  const seeds = SEEDS.slice(0, 6);
  it('téméraire : il prend le couloir de 7 pas entre les pièges', () => {
    for (const seed of seeds) expect(train(sc, {}, seed)).toMatchObject({ end: 'goal', steps: 7 });
  });
  it('mesuré (Q-learning, pénalité forte) sans glissance : toujours le couloir', () => {
    for (const seed of seeds) expect(train(sc, { prudence: 1 }, seed)).toMatchObject({ end: 'goal', steps: 7 });
  });
  it('prudent : il préfère le détour de 13 pas', () => {
    for (const seed of seeds) expect(train(sc, { prudence: 2 }, seed)).toMatchObject({ end: 'goal', steps: 13 });
  });
  it('téméraire sur un sol « un peu glissant » : le détour aussi', () => {
    for (const seed of seeds) expect(train(sc, { world: 1 }, seed)).toMatchObject({ end: 'goal', steps: 13 });
  });
});

describe('Scénario « Deux trésors » : la vision à long terme décide', () => {
  const sc = SCENARIOS.treasures;
  const seeds = SEEDS.slice(0, 5);
  it('myope (γ ≤ 0,7) : le petit trésor tout proche', () => {
    for (const vision of [0, 1])
      for (const seed of seeds) expect(train(sc, { vision }, seed)).toMatchObject({ end: 'bonus', steps: 2 });
  });
  it('équilibré ou prévoyant (γ ≥ 0,85) : le grand trésor plus loin', () => {
    for (const vision of [2, 3, 4])
      for (const seed of seeds) expect(train(sc, { vision }, seed)).toMatchObject({ end: 'goal', steps: 6 });
  });
  it('le calcul annoncé dans la description est juste', () => {
    expect(10 * 0.7 ** 5).toBeLessThan(3 * 0.7);
    expect(10 * 0.85 ** 5).toBeGreaterThan(3 * 0.85);
  });
});

describe('Scénario « Pièce vide »', () => {
  it('apprend le plus court chemin (14 pas) en 100 épisodes', () => {
    for (const seed of [1, 2, 3]) {
      const r = train(SCENARIOS.empty, {}, seed);
      expect(r).toMatchObject({ end: 'goal', steps: 14 });
      const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(avg(r.t.history.slice(-20))).toBeGreaterThan(avg(r.t.history.slice(0, 20)));
    }
  });
});
