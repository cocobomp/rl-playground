// « Vitesse d'apprentissage » : combien de Web Workers calculent, et si l'animation continue.
// Aucun accès au DOM (testé dans tests/walker-timeline.test.ts).

export type SpeedMode = 'normal' | 'fast' | 'turbo';

export interface SpeedModeDef {
  key: SpeedMode;
  label: string;
  help: (workers: number) => string;
}

const calc = (n: number) => `${n} calcul${n > 1 ? 's' : ''} en parallèle`;

export const SPEED_MODES: SpeedModeDef[] = [
  {
    key: 'normal',
    label: 'Normale',
    help: (n) => `Normale : ${calc(n)}, la page et votre ordinateur restent tranquilles.`,
  },
  {
    key: 'fast',
    label: 'Rapide',
    help: (n) => `Rapide : ${calc(n)}, un par cœur libre de votre appareil.`,
  },
  {
    key: 'turbo',
    label: 'Turbo',
    help: (n) =>
      `Turbo : ${calc(n)} et l’animation se met en pause (une image fixe toutes les 3 s) pour laisser toute la puissance à l’apprentissage. Cliquer sur un moment clé relance l’animation.`,
  },
];

/**
 * Nombre de workers créés : un par cœur (au plus 6). En Normale et Rapide, on en laisse un au fil principal,
 * qui anime le robot ; en Turbo, l'animation est en pause, donc le dernier cœur calcule aussi.
 */
export function poolSize(hardwareConcurrency: number): number {
  return Math.max(1, Math.min(6, Math.floor(hardwareConcurrency) || 1));
}

/** Workers mis au travail selon le mode (Rapide = cœurs − 1, entre 1 et 6 ; Normale = la moitié ; Turbo = tous). */
export function workersFor(mode: SpeedMode, hardwareConcurrency: number): number {
  const pool = poolSize(hardwareConcurrency);
  const fast = Math.max(1, Math.min(6, Math.floor(hardwareConcurrency) - 1 || 1));
  if (mode === 'normal') return Math.max(1, Math.ceil(fast / 2));
  if (mode === 'fast') return Math.min(pool, fast);
  return pool;
}
