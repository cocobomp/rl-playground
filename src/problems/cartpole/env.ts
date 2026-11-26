// Pendule inversé (cart-pole) : dynamique classique de Barto, Sutton & Anderson (1983),
// intégrée par la méthode d'Euler (pas de 0,02 s), comme dans la version de référence de Gym.
// Ajout : des rafales de vent, modélisées comme une force horizontale appliquée au centre du bâton.
// Aucun accès au DOM : utilisable dans la page, un Web Worker, les tests et les scripts hors ligne.

export const GRAVITY = 9.8;
export const DT = 0.02;
/** Angle de chute : 12° (≈ 0,2094 rad). */
export const ANGLE_LIMIT = (12 * Math.PI) / 180;
/** Le chariot ne doit pas sortir de la piste : |x| ≤ 2,4 m. */
export const X_LIMIT = 2.4;
export const MAX_STEPS = 500;
/** Durée d’une rafale, en pas de 0,02 s (de 0,5 à 1,5 s). */
export const GUST_MIN = 25;
export const GUST_MAX = 75;

/** Réglages physiques du « monde ». */
export interface WorldParams {
  /** Masse du chariot (kg). */
  massCart: number;
  /** Masse du bâton (kg). */
  massPole: number;
  /** Demi-longueur du bâton (m) : la distance du pivot au centre du bâton. */
  halfLength: number;
  /** Force du moteur (N) : chaque pas, le chariot est poussé de ±forceMag. */
  forceMag: number;
  /** Force maximale d'une rafale de vent sur le bâton (N). 0 = pas de vent. */
  windForce: number;
  /** Probabilité qu'une rafale démarre à chaque pas (quand aucune n'est en cours). */
  windRate: number;
}

export const DEFAULT_WORLD: WorldParams = {
  massCart: 1.0,
  massPole: 0.1,
  halfLength: 0.5,
  forceMag: 10,
  windForce: 0,
  windRate: 0.01,
};

/** État : position x (m), vitesse ẋ (m/s), angle θ (rad, 0 = vertical, > 0 = penché à droite), vitesse angulaire θ̇ (rad/s). */
export type State = [number, number, number, number];

/** Normalisation des entrées du réseau (ordre de grandeur ~1 pour chaque capteur). */
export const OBS_SCALE: State = [X_LIMIT, 2, ANGLE_LIMIT, 2];

export function observe(s: State, out: number[] = [0, 0, 0, 0]): number[] {
  for (let i = 0; i < 4; i++) out[i] = s[i] / OBS_SCALE[i];
  return out;
}

/**
 * Accélérations (ẍ, θ̈) pour une force F sur le chariot et une force de vent Fw au centre du bâton.
 * Équations de Lagrange du système chariot + bâton rigide (moment d'inertie au pivot 4/3·m·l²) :
 *   (M+m)ẍ + m·l·cosθ·θ̈ − m·l·θ̇²·sinθ = F + Fw
 *   m·l·cosθ·ẍ + 4/3·m·l²·θ̈ − m·g·l·sinθ = Fw·l·cosθ
 * Avec Fw = 0, on retrouve exactement les formules de Barto et al.
 */
export function accelerations(s: State, force: number, wind: number, w: WorldParams): [number, number] {
  const [, , theta, thetaDot] = s;
  const total = w.massCart + w.massPole;
  const pml = w.massPole * w.halfLength;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const temp = (force + wind + pml * thetaDot * thetaDot * sin) / total;
  const thetaAcc =
    (GRAVITY * sin - cos * temp + (cos * wind) / w.massPole) /
    (w.halfLength * (4 / 3 - (w.massPole * cos * cos) / total));
  const xAcc = temp - (pml * thetaAcc * cos) / total;
  return [xAcc, thetaAcc];
}

/** Un pas d'Euler (même ordre de mise à jour que la version classique). */
export function eulerStep(s: State, force: number, wind: number, w: WorldParams): State {
  const [xAcc, thetaAcc] = accelerations(s, force, wind, w);
  return [s[0] + DT * s[1], s[1] + DT * xAcc, s[2] + DT * s[3], s[3] + DT * thetaAcc];
}

export function isFailure(s: State): boolean {
  return Math.abs(s[0]) > X_LIMIT || Math.abs(s[2]) > ANGLE_LIMIT;
}

/** Environnement complet : état, rafales, compteur de pas. */
export class CartPole {
  state: State = [0, 0, 0, 0];
  steps = 0;
  done = false;
  /** true si l'épisode s'est arrêté parce que le bâton est tombé ou que le chariot est sorti. */
  failed = false;
  /** Force de vent actuelle (N), > 0 = vers la droite. */
  wind = 0;
  /** Dernière force du moteur appliquée (N). */
  lastForce = 0;
  private gustLeft = 0;
  private gustDir = 0;
  private gustLen = 1;

  constructor(public world: WorldParams, private rng: () => number) {}

  /** Nouveau départ : chaque variable tirée uniformément dans [−0,05 ; 0,05]. */
  reset(rng?: () => number): State {
    if (rng) this.rng = rng;
    const r = () => (this.rng() - 0.5) * 0.1;
    this.state = [r(), r(), r(), r()];
    this.steps = 0;
    this.done = false;
    this.failed = false;
    this.wind = 0;
    this.lastForce = 0;
    this.gustLeft = 0;
    return this.state;
  }

  /** Fait évoluer les rafales : profil en cloche (montée puis descente) de 0,5 à 1,5 s. */
  private updateWind(): void {
    const w = this.world;
    if (w.windForce <= 0) {
      this.wind = 0;
      this.gustLeft = 0;
      return;
    }
    // On consomme toujours le même nombre de tirages : les mêmes graines donnent les mêmes rafales.
    const u1 = this.rng(), u2 = this.rng(), u3 = this.rng(), u4 = this.rng();
    if (this.gustLeft <= 0 && u1 < w.windRate) {
      this.gustLen = GUST_MIN + Math.floor(u2 * (GUST_MAX - GUST_MIN + 1));
      this.gustLeft = this.gustLen;
      this.gustDir = (u3 < 0.5 ? -1 : 1) * (0.6 + 0.4 * u4) * w.windForce;
    }
    if (this.gustLeft > 0) {
      const phase = 1 - this.gustLeft / this.gustLen;
      this.wind = this.gustDir * Math.sin(Math.PI * phase);
      this.gustLeft--;
    } else {
      this.wind = 0;
    }
  }

  /** Applique une force (N, bornée à ±forceMag) pendant 0,02 s. */
  step(force: number): State {
    if (this.done) return this.state;
    const f = Math.max(-this.world.forceMag, Math.min(this.world.forceMag, force));
    this.lastForce = f;
    this.updateWind();
    this.state = eulerStep(this.state, f, this.wind, this.world);
    this.steps++;
    if (isFailure(this.state)) {
      this.done = true;
      this.failed = true;
    } else if (this.steps >= MAX_STEPS) {
      this.done = true;
    }
    return this.state;
  }
}

/** Graine dérivée (hachage simple) pour obtenir des épisodes reproductibles. */
export function hashSeed(a: number, b: number, c = 0): number {
  let hsh = (a * 0x9e3779b1) ^ (b * 0x85ebca77) ^ (c * 0xc2b2ae3d);
  hsh = Math.imul(hsh ^ (hsh >>> 16), 0x7feb352d);
  hsh = Math.imul(hsh ^ (hsh >>> 15), 0x846ca68b);
  return (hsh ^ (hsh >>> 16)) >>> 0;
}
