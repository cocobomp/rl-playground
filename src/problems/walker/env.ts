// Environnement du robot marcheur 2D (planck.js, portage de Box2D).
// Aucun accès au DOM : ce même fichier sert à la page, au Web Worker, aux tests
// et au script de pré-entraînement hors ligne (scripts/walker/train.ts).
// Si on modifie la physique ici, les cerveaux pré-entraînés ne sont plus valables : il faut les réentraîner.
import { Body, Box, Chain, Circle, Fixture, RevoluteJoint, Vec2, World } from 'planck';

/** Pas de temps fixe (s). */
export const DT = 1 / 60;
/** Itérations du solveur (vitesse, position) : fixes pour un résultat déterministe. */
const VEL_ITERS = 8;
const POS_ITERS = 3;
/** Durée d'un épisode (s). */
export const EPISODE_SECONDS = 10;
export const MAX_STEPS = Math.round(EPISODE_SECONDS / DT);

// Géométrie (mètres) et masses.
export const HULL_W = 0.64;
export const HULL_H = 0.22;
export const THIGH_LEN = 0.46;
export const THIGH_W = 0.12;
export const SHIN_LEN = 0.44;
export const SHIN_W = 0.1;
export const FOOT_R = 0.06;
const HULL_DENSITY = 45;
const LEG_DENSITY = 25;
const HIP_TORQUE = 70;
const KNEE_TORQUE = 50;
/** Vitesse maximale des moteurs (rad/s). */
export const MAX_MOTOR_SPEED = 8;
/** Gain de l'asservissement : vitesse moteur = gain × (angle visé − angle actuel). */
const SERVO_GAIN = 10;
/** Fréquence de l'horloge interne (« générateur de rythme »), en Hz. */
export const CLOCK_HZ = 1.4;

/** Ordre des articulations partout dans le code. */
export const JOINTS = ['hanche gauche', 'genou gauche', 'hanche droite', 'genou droit'] as const;
/** Limites angulaires (rad) : hanche positive = cuisse vers l'avant ; genou négatif = jambe pliée vers l'arrière. */
export const HIP_LIMITS: [number, number] = [-0.8, 1.1];
export const KNEE_LIMITS: [number, number] = [-1.6, 0.0];
/** Posture « debout » visée quand le réseau répond 0. */
export const HIP_NEUTRAL = 0;
export const KNEE_NEUTRAL = -0.15;
/** Angle auquel le genou gauche est figé quand on le bloque (légèrement plié). */
export const LOCKED_KNEE_ANGLE = -0.1;

export const OBS_SIZE = 17;
export const ACT_SIZE = 4;
/** Architecture du réseau : observation → 16 neurones cachés → 4 angles visés. */
export const NET_SIZES = [OBS_SIZE, 16, ACT_SIZE];

/** Les « interventions » : ce qu'on fait subir au robot ou au monde. */
export interface WorldConfig {
  lockLeftKnee: boolean;
  weakRightLeg: boolean;
  shortLeftLeg: boolean;
  slippery: boolean;
  heavyBackpack: boolean;
  slope: boolean;
}

export const HEALTHY: WorldConfig = {
  lockLeftKnee: false,
  weakRightLeg: false,
  shortLeftLeg: false,
  slippery: false,
  heavyBackpack: false,
  slope: false,
};

export const SLOPE_ANGLE = (6 * Math.PI) / 180;
const FRICTION = 0.9;
const SLIPPERY_FRICTION = 0.1;
/** La jambe droite affaiblie garde 30 % de son couple. */
export const WEAK_FACTOR = 0.3;
/** La jambe gauche raccourcie : tibia à 70 %. */
export const SHORT_FACTOR = 0.7;

/** Ce que l'on récompense (objectifs de haut niveau). */
export interface Objectives {
  /** Points par mètre parcouru vers l'avant. */
  speed: number;
  /** Pénalité par 100 J d'énergie dépensée par les moteurs. */
  energy: number;
  /** Pénalité si le robot tombe (en « mètres équivalents »). */
  fall: number;
  /** Pénalité par radian d'inclinaison moyenne du torse. */
  upright: number;
}

export const DEFAULT_OBJECTIVES: Objectives = { speed: 1, energy: 0.05, fall: 3, upright: 1 };

export interface EpisodeResult {
  fitness: number;
  /** Distance parcourue vers l'avant (m), mesurée à l'horizontale. */
  distance: number;
  /** Énergie mécanique dépensée par les moteurs (J). */
  energy: number;
  fell: boolean;
  /** Durée simulée (s). */
  time: number;
  /** Inclinaison moyenne du torse (rad). */
  tilt: number;
}

/** Pose instantanée pour le dessin. */
export interface BodyPose {
  x: number;
  y: number;
  a: number;
}
export interface Pose {
  hull: BodyPose;
  /** cuisse G, tibia G, cuisse D, tibia D */
  legs: BodyPose[];
  contacts: [boolean, boolean];
}

interface Leg {
  thigh: Body;
  shin: Body;
  hip: RevoluteJoint;
  knee: RevoluteJoint;
  shinLen: number;
}

/** Fonction de score : combine les objectifs (plus haut = meilleur). */
export function fitnessOf(r: { distance: number; energy: number; fell: boolean; tilt: number }, o: Objectives): number {
  return o.speed * r.distance - (o.energy * r.energy) / 100 - (r.fell ? o.fall : 0) - o.upright * r.tilt;
}

export class Walker {
  readonly world: World;
  readonly hull: Body;
  readonly legs: [Leg, Leg];
  readonly config: WorldConfig;
  readonly joints: RevoluteJoint[];
  private hullFix: Fixture;
  private groundFix: Fixture;
  steps = 0;
  energy = 0;
  fell = false;
  done = false;
  startX: number;
  private tiltSum = 0;
  /** Dernières consignes (angles visés, normalisés dans [−1, 1]). */
  readonly action = new Float64Array(ACT_SIZE);
  readonly contacts: [boolean, boolean] = [false, false];
  private hullTouch = false;

  constructor(config: WorldConfig = HEALTHY) {
    this.config = { ...config };
    const c = this.config;
    const world = new World({ gravity: Vec2(0, -9.8) });
    this.world = world;

    // Sol : une longue ligne (montante si « pente »).
    const ground = world.createBody();
    const slope = c.slope ? SLOPE_ANGLE : 0;
    const pts = [Vec2(-20, -20 * Math.tan(slope)), Vec2(0, 0), Vec2(400, 400 * Math.tan(slope))];
    this.groundFix = ground.createFixture(Chain(pts, false), { friction: c.slippery ? SLIPPERY_FRICTION : FRICTION });

    const legLen = THIGH_LEN + SHIN_LEN + FOOT_R;
    const hipY = legLen + 0.02;
    const hullY = hipY + HULL_H / 2;
    const robot = { filterGroupIndex: -1 }; // les pièces du robot ne se heurtent pas entre elles
    this.hull = world.createBody({ type: 'dynamic', position: Vec2(0, hullY) });
    this.hullFix = this.hull.createFixture(Box(HULL_W / 2, HULL_H / 2), {
      density: HULL_DENSITY * (c.heavyBackpack ? 2 : 1),
      friction: 0.5,
      ...robot,
    });
    this.startX = this.hull.getPosition().x;

    const makeLeg = (side: 0 | 1): Leg => {
      const shinLen = side === 0 && c.shortLeftLeg ? SHIN_LEN * SHORT_FACTOR : SHIN_LEN;
      const thigh = world.createBody({ type: 'dynamic', position: Vec2(0, hipY - THIGH_LEN / 2) });
      thigh.createFixture(Box(THIGH_W / 2, THIGH_LEN / 2), { density: LEG_DENSITY, friction: 0.6, ...robot });
      const kneeY = hipY - THIGH_LEN;
      const shin = world.createBody({ type: 'dynamic', position: Vec2(0, kneeY - shinLen / 2) });
      shin.createFixture(Box(SHIN_W / 2, shinLen / 2), { density: LEG_DENSITY, friction: 0.8, ...robot });
      shin.createFixture(Circle(Vec2(0, -shinLen / 2), FOOT_R), { density: LEG_DENSITY, friction: 1, ...robot });
      const weak = side === 1 && c.weakRightLeg ? WEAK_FACTOR : 1;
      const hip = world.createJoint(
        new RevoluteJoint(
          {
            enableLimit: true,
            lowerAngle: HIP_LIMITS[0],
            upperAngle: HIP_LIMITS[1],
            enableMotor: true,
            maxMotorTorque: HIP_TORQUE * weak,
            motorSpeed: 0,
          },
          this.hull,
          thigh,
          Vec2(0, hipY),
        ),
      )!;
      const locked = side === 0 && c.lockLeftKnee;
      const knee = world.createJoint(
        new RevoluteJoint(
          {
            enableLimit: true,
            lowerAngle: locked ? LOCKED_KNEE_ANGLE : KNEE_LIMITS[0],
            upperAngle: locked ? LOCKED_KNEE_ANGLE : KNEE_LIMITS[1],
            enableMotor: !locked,
            maxMotorTorque: locked ? 0 : KNEE_TORQUE * weak,
            motorSpeed: 0,
          },
          thigh,
          shin,
          Vec2(0, kneeY),
        ),
      )!;
      return { thigh, shin, hip, knee, shinLen };
    };
    this.legs = [makeLeg(0), makeLeg(1)];
    this.joints = [this.legs[0].hip, this.legs[0].knee, this.legs[1].hip, this.legs[1].knee];
  }

  /** Abscisse du torse. */
  get x(): number {
    return this.hull.getPosition().x;
  }
  get distance(): number {
    return this.x - this.startX;
  }
  get time(): number {
    return this.steps * DT;
  }

  /** Observation normalisée (taille OBS_SIZE). */
  observe(out: Float64Array = new Float64Array(OBS_SIZE)): Float64Array {
    const h = this.hull;
    const v = h.getLinearVelocity();
    out[0] = h.getAngle();
    out[1] = h.getAngularVelocity() * 0.25;
    out[2] = v.x * 0.5;
    out[3] = v.y * 0.5;
    for (let j = 0; j < 4; j++) {
      out[4 + j] = this.joints[j].getJointAngle();
      out[8 + j] = this.joints[j].getJointSpeed() * 0.1;
    }
    out[12] = this.contacts[0] ? 1 : 0;
    out[13] = this.contacts[1] ? 1 : 0;
    const ph = 2 * Math.PI * CLOCK_HZ * this.time;
    out[14] = Math.sin(ph);
    out[15] = Math.cos(ph);
    out[16] = (h.getPosition().y - this.groundY(h.getPosition().x) - 1.05) * 2;
    return out;
  }

  /** Hauteur du sol à l'abscisse x. */
  groundY(x: number): number {
    return this.config.slope ? x * Math.tan(SLOPE_ANGLE) : 0;
  }

  /**
   * Un pas de simulation. action[i] ∈ [−1, 1] = angle visé pour l'articulation i
   * (−1 = butée basse, 0 = posture debout, +1 = butée haute). Un asservissement simple en déduit la vitesse du moteur.
   */
  step(action: ArrayLike<number>): void {
    if (this.done) return;
    for (let j = 0; j < 4; j++) {
      const joint = this.joints[j];
      const a = Math.max(-1, Math.min(1, action[j] ?? 0));
      this.action[j] = a;
      const [lo, hi] = j % 2 === 0 ? HIP_LIMITS : KNEE_LIMITS;
      const mid = j % 2 === 0 ? HIP_NEUTRAL : KNEE_NEUTRAL;
      const target = a >= 0 ? mid + a * (hi - mid) : mid + a * (mid - lo);
      const sp = SERVO_GAIN * (target - joint.getJointAngle());
      joint.setMotorSpeed(Math.max(-MAX_MOTOR_SPEED, Math.min(MAX_MOTOR_SPEED, sp)));
    }
    this.world.step(DT, VEL_ITERS, POS_ITERS);
    this.steps++;
    // Énergie : puissance mécanique |couple × vitesse| intégrée sur le pas.
    for (let j = 0; j < 4; j++) {
      const joint = this.joints[j];
      if (!joint.isMotorEnabled()) continue;
      this.energy += Math.abs(joint.getMotorTorque(1 / DT) * joint.getJointSpeed()) * DT;
    }
    this.updateContacts();
    const ang = this.hull.getAngle();
    this.tiltSum += Math.abs(ang);
    if (this.hullTouch || Math.abs(ang) > 1.2) {
      this.fell = true;
      this.done = true;
    } else if (this.steps >= MAX_STEPS) {
      this.done = true;
    }
  }

  private updateContacts(): void {
    this.contacts[0] = false;
    this.contacts[1] = false;
    this.hullTouch = false;
    for (let c = this.world.getContactList(); c; c = c.getNext()) {
      if (!c.isTouching()) continue;
      const a = c.getFixtureA();
      const b = c.getFixtureB();
      const other = a === this.groundFix ? b : b === this.groundFix ? a : null;
      if (!other) continue;
      if (other === this.hullFix) this.hullTouch = true;
      else {
        const body = other.getBody();
        if (body === this.legs[0].shin) this.contacts[0] = true;
        else if (body === this.legs[1].shin) this.contacts[1] = true;
      }
    }
  }

  /** Inclinaison moyenne du torse depuis le début (rad). */
  get tilt(): number {
    return this.steps ? this.tiltSum / this.steps : 0;
  }

  result(o: Objectives): EpisodeResult {
    const r = { distance: this.distance, energy: this.energy, fell: this.fell, tilt: this.tilt, time: this.time };
    return { ...r, fitness: fitnessOf(r, o) };
  }

  pose(): Pose {
    const bp = (b: Body): BodyPose => {
      const p = b.getPosition();
      return { x: p.x, y: p.y, a: b.getAngle() };
    };
    return {
      hull: bp(this.hull),
      legs: [bp(this.legs[0].thigh), bp(this.legs[0].shin), bp(this.legs[1].thigh), bp(this.legs[1].shin)],
      contacts: [this.contacts[0], this.contacts[1]],
    };
  }

  /** Longueur du tibia de chaque jambe (pour le dessin). */
  shinLength(side: 0 | 1): number {
    return this.legs[side].shinLen;
  }
}

/** Petit contrôleur : un MLP lu depuis un tableau de paramètres. */
export interface Policy {
  act(obs: Float64Array): ArrayLike<number>;
}

/** Joue un épisode complet (déterministe : même cerveau + même monde = même résultat). */
export function runEpisode(policy: Policy, config: WorldConfig, objectives: Objectives, maxSteps = MAX_STEPS): EpisodeResult {
  const w = new Walker(config);
  const obs = new Float64Array(OBS_SIZE);
  while (!w.done && w.steps < maxSteps) w.step(policy.act(w.observe(obs)));
  return w.result(objectives);
}
