// Histoires pré-enregistrées : les moments clés et les courbes de l'entraînement hors ligne
// des cerveaux livrés (scripts/walker/story.ts). Aucun accès au DOM.
import { HEALTHY, WorldConfig } from './env';
import { Moment, StoryJSON } from './timeline';
import healthyStory from './pretrained/story-healthy.json';
import injuredStory from './pretrained/story-injured.json';

export interface Story {
  endGen: number;
  curve: StoryJSON['curve'];
  moments: Moment[];
}

function load(s: StoryJSON): Story {
  return {
    endGen: s.endGen,
    curve: s.curve,
    moments: s.moments.map((m) => ({
      ...m,
      config: { ...HEALTHY, ...(m.config ?? {}) } as WorldConfig,
      key: m.kind !== 'regular' && m.kind !== 'record',
    })),
  };
}

export const STORIES: { healthy: Story; injured: Story } = {
  healthy: load(healthyStory as StoryJSON),
  injured: load(injuredStory as StoryJSON),
};

/** Dernière génération d'une histoire. */
export function storyEnd(s: Story): number {
  return Math.max(s.endGen, ...s.moments.map((m) => m.gen));
}

/** Génération du cerveau livré (moment « final »). */
export function finalGen(s: Story): number {
  return s.moments.find((m) => m.kind === 'final')?.gen ?? storyEnd(s);
}
