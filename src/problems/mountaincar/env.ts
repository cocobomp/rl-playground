// Environnement « Mountain Car » (Sutton & Barto, 2e éd., exemple 10.1), sans DOM.
// Position x ∈ [−1,2 ; 0,5], vitesse v ∈ [−0,07 ; 0,07], relief y = sin(3x).
// v ← v + 0,001·a·force − 0,0025·gravité·cos(3x) ;  x ← x + v.

export const X_MIN = -1.2;
export const X_MAX = 0.5;
export const V_MAX = 0.07;
export const GOAL_X = 0.5;
export const ENGINE = 0.001;
export const GRAVITY = 0.0025;

/** Actions : 0 = gauche (a = −1), 1 = rien (a = 0), 2 = droite (a = +1). */
export const ACTIONS = [-1, 0, 1] as const;
export const N_ACTIONS = 3;

export type Shaping = 'none' | 'energy' | 'speed';

export interface PhysicsParams {
  /** Multiplicateur de la force du moteur (1 = classique). */
  force: number;
  /** Multiplicateur de la gravité (1 = classique). */
  gravity: number;
  /** Nombre maximal de pas par épisode (au-delà : épisode interrompu). */
  maxSteps: number;
  /** « Coup de pouce » : récompense supplémentaire ajoutée au −1 de chaque pas. */
  shaping: Shaping;
}

export const DEFAULT_PHYSICS: PhysicsParams = { force: 1, gravity: 1, maxSteps: 1000, shaping: 'none' };

export function height(x: number): number {
  return Math.sin(3 * x);
}

/** Pente du relief dy/dx. */
export function slope(x: number): number {
  return 3 * Math.cos(3 * x);
}

/** Un pas de physique (fonction pure). */
export function physicsStep(x: number, v: number, action: number, force = 1, gravity = 1): { x: number; v: number } {
  const a = ACTIONS[action];
  let nv = v + ENGINE * force * a - GRAVITY * gravity * Math.cos(3 * x);
  if (nv > V_MAX) nv = V_MAX;
  else if (nv < -V_MAX) nv = -V_MAX;
  let nx = x + nv;
  if (nx < X_MIN) {
    nx = X_MIN;
    if (nv < 0) nv = 0; // mur de gauche : choc inélastique
  }
  if (nx > X_MAX) nx = X_MAX;
  return { x: nx, v: nv };
}

/**
 * La montée directe (sans élan) est-elle garantie ? La gravité freine au plus de 0,0025·g (au fond, x = 0),
 * donc un moteur de force 0,001·f > 0,0025·g gagne partout sur la pente de droite.
 */
export function canClimbDirectly(force: number, gravity: number): boolean {
  return ENGINE * force > GRAVITY * gravity;
}

/**
 * Depuis quelle part des positions de départ (x₀ ∈ [−0,6 ; −0,4], vitesse nulle) le réflexe « toujours à droite »
 * atteint-il le drapeau ? Même quand la pente l’emporte au point le plus raide, la descente depuis le départ
 * peut donner assez d’élan : on simule donc plutôt que de comparer seulement les forces.
 * Renvoie la fraction de départs réussis et le départ réussi le plus à droite (NaN si aucun).
 */
export function directClimb(force: number, gravity: number, samples = 21, maxSteps = 1000): { fraction: number; maxStart: number } {
  let ok = 0;
  let maxStart = NaN;
  for (let i = 0; i < samples; i++) {
    const x0 = -0.6 + (0.2 * i) / (samples - 1);
    let x = x0;
    let v = 0;
    for (let t = 0; t < maxSteps; t++) {
      const r = physicsStep(x, v, 2, force, gravity);
      x = r.x;
      v = r.v;
      if (x >= GOAL_X) {
        ok++;
        maxStart = x0;
        break;
      }
    }
  }
  return { fraction: ok / samples, maxStart };
}

/** Énergie mécanique normalisée (potentiel pour le coup de pouce « bien conçu »). */
export function energy(x: number, v: number, gravity = 1): number {
  // Énergie potentielle U = 0,0025·g/3 · sin(3x) (dU/dx = 0,0025·g·cos 3x), cinétique v²/2.
  const u = ((GRAVITY * gravity) / 3) * Math.sin(3 * x);
  return (u + 0.5 * v * v) / (GRAVITY / 3);
}

export const ENERGY_SCALE = 10;
export const SPEED_BONUS = 60;

/**
 * Bonus de « coup de pouce » pour la transition s → s′.
 * - energy : potentiel Φ = 10·E, bonus = γΦ(s′) − Φ(s), avec Φ(arrivée) = 0 : ne change pas la stratégie optimale (Ng et al., 1999).
 * - speed : +60 × |v′| à chaque pas (jusqu’à +4,2) : piège, se balancer vite rapporte plus que finir.
 */
export function shapingBonus(kind: Shaping, x: number, v: number, nx: number, nv: number, goal: boolean, gamma: number, gravity = 1): number {
  switch (kind) {
    case 'none':
      return 0;
    case 'energy': {
      const phi = ENERGY_SCALE * energy(x, v, gravity);
      const phiNext = goal ? 0 : ENERGY_SCALE * energy(nx, nv, gravity);
      return gamma * phiNext - phi;
    }
    case 'speed':
      return SPEED_BONUS * Math.abs(nv);
  }
}

export interface EnvStep {
  x: number;
  v: number;
  /** Récompense perçue par l’agent (−1 + coup de pouce). */
  reward: number;
  /** Drapeau atteint (état terminal). */
  goal: boolean;
  /** Limite de pas atteinte (épisode interrompu, état non terminal). */
  truncated: boolean;
}

export class MountainCar {
  x = -0.5;
  v = 0;
  t = 0;
  constructor(public params: PhysicsParams = { ...DEFAULT_PHYSICS }) {}

  reset(rng: () => number): void {
    this.x = -0.6 + 0.2 * rng();
    this.v = 0;
    this.t = 0;
  }

  step(action: number, gamma = 1): EnvStep {
    const p = this.params;
    const { x: nx, v: nv } = physicsStep(this.x, this.v, action, p.force, p.gravity);
    const goal = nx >= GOAL_X;
    const reward = -1 + shapingBonus(p.shaping, this.x, this.v, nx, nv, goal, gamma, p.gravity);
    this.x = nx;
    this.v = nv;
    this.t++;
    return { x: nx, v: nv, reward, goal, truncated: !goal && this.t >= p.maxSteps };
  }
}
