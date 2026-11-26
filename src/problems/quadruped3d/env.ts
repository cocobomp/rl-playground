// Environnement 3D du robot quadrupède (physique Rapier, version « compat »).
// Aucun accès au DOM : ce fichier est partagé tel quel par la page (rejeu), le Web Worker
// (entraînement), le script de pré-entraînement hors ligne et les tests.
import RAPIER from '@dimforge/rapier3d-compat';

/** Pas de temps fixe de la simulation (secondes). */
export const DT = 1 / 60;
/** Durée d'un essai pendant l'entraînement (secondes). */
export const EPISODE_SECONDS = 8;
export const EPISODE_STEPS = Math.round(EPISODE_SECONDS / DT);

/** Ordre des pattes : avant gauche, avant droite, arrière gauche, arrière droite. */
export const LEGS = ['avant gauche', 'avant droite', 'arrière gauche', 'arrière droite'] as const;
export const NUM_LEGS = 4;
export const NUM_JOINTS = 8; // hanche + genou par patte
/** Index des articulations : 2·patte (hanche) et 2·patte + 1 (genou). */
export const hipIndex = (leg: number) => 2 * leg;
export const kneeIndex = (leg: number) => 2 * leg + 1;

// Géométrie (mètres). x = avant, y = haut, z = côté (z > 0 = gauche).
export const TORSO_HALF = { x: 0.34, y: 0.06, z: 0.16 };
export const HIP_OFFSET = { x: 0.27, y: -0.03, z: 0.2 };
export const UPPER_HALF_LEN = 0.13; // demi-longueur de la cuisse (de la hanche au genou)
export const LOWER_HALF_LEN = 0.13; // demi-longueur du tibia (du genou au pied)
export const UPPER_RADIUS = 0.04;
export const LOWER_RADIUS = 0.032;
/** Débattement des articulations (radians, symétrique). */
export const HIP_RANGE = 0.9;
export const KNEE_RANGE = 1.2;
/** En dessous de cette hauteur (m) du centre du tronc, on considère que le robot est tombé. */
export const FALL_HEIGHT = 0.16;
/** Hauteur initiale du centre du tronc : pattes tendues, pieds juste au-dessus du sol. */
export const START_HEIGHT = -HIP_OFFSET.y + 4 * UPPER_HALF_LEN + LOWER_RADIUS + 0.01;

/** Ce que l'utilisateur peut changer dans le monde ou le corps du robot. */
export interface WorldParams {
  /** Patte avant gauche cassée : le tibia est absent (il ne reste qu'un moignon de cuisse). */
  brokenFrontLeft: boolean;
  /** Genou arrière droit bloqué, jambe tendue. */
  lockedRearRightKnee: boolean;
  /** Multiplicateur de masse du tronc (1 = normal). */
  bodyMass: number;
  /** Coefficient de frottement du sol et des pieds (≈ 1 : caoutchouc, ≈ 0,15 : glace). */
  friction: number;
  /** Multiplicateur du couple maximal des moteurs (1 = normal). */
  motorStrength: number;
}

export const DEFAULT_WORLD: WorldParams = {
  brokenFrontLeft: false,
  lockedRearRightKnee: false,
  bodyMass: 1,
  friction: 1,
  motorStrength: 1,
};

/** Ce que l'on récompense (la « priorité » de l'agent). */
export interface RewardParams {
  /** Poids de l'énergie dépensée (0 = seule la distance compte). */
  energyWeight: number;
  /** Poids de l'instabilité (inclinaison du tronc). */
  stabilityWeight: number;
  /** Pénalité forfaitaire en cas de chute. */
  fallPenalty: number;
}

export const DEFAULT_REWARD: RewardParams = { energyWeight: 0.001, stabilityWeight: 0.2, fallPenalty: 1 };

/** Raideur, amortissement et couple maximal des moteurs (N·m/rad, N·m·s/rad, N·m). */
export const MOTOR_STIFFNESS = 90;
export const MOTOR_DAMPING = 4;
export const MOTOR_MAX_TORQUE = 28;
/** Masse du tronc (kg) avant multiplicateur. */
export const TORSO_MASS = 6;
/** Fréquence de référence du rythme de marche interne (Hz) ; chaque cerveau peut l'ajuster. */
export const GAIT_HZ = 2.2;

let initPromise: Promise<void> | null = null;
/** Initialise le module WebAssembly de Rapier (une seule fois). */
export function initPhysics(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

/** Groupes de collision : le robot ne touche que le sol (pas de collisions entre ses propres pièces). */
const GROUP_GROUND = (0x0001 << 16) | 0x0002;
const GROUP_ROBOT = (0x0002 << 16) | 0x0001;

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Fait tourner v par l'inverse du quaternion unitaire q (monde → repère local). */
export function rotateInv(q: Quat, v: Vec3): Vec3 {
  // q⁻¹ = conjugué pour un quaternion unitaire.
  return rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
}

/** Fait tourner v par le quaternion unitaire q. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const { x, y, z, w } = q;
  // t = 2 · (q.xyz × v)
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  return {
    x: v.x + w * tx + (y * tz - z * ty),
    y: v.y + w * ty + (z * tx - x * tz),
    z: v.z + w * tz + (x * ty - y * tx),
  };
}

/** Angle de rotation autour de l'axe z du repère du parent : q_rel = q_parent⁻¹ · q_enfant. */
export function relativeAngleZ(parent: Quat, child: Quat): number {
  // Produit conj(parent) * child
  const ax = -parent.x, ay = -parent.y, az = -parent.z, aw = parent.w;
  const bx = child.x, by = child.y, bz = child.z, bw = child.w;
  const rz = aw * bz + ax * by - ay * bx + az * bw;
  const rw = aw * bw - ax * bx - ay * by - az * bz;
  let a = 2 * Math.atan2(rz, rw);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

interface Joint {
  joint: RAPIER.RevoluteImpulseJoint | null;
  parent: RAPIER.RigidBody;
  child: RAPIER.RigidBody | null;
  range: number;
  locked: boolean;
}

/** Pose d'une pièce pour l'affichage 3D. */
export interface PartPose {
  p: Vec3;
  q: Quat;
}

/** Nombre d'entrées du réseau : rythme (2) + gravité vue du tronc (3) + vitesses (3 + 3) + hauteur (1) + 8 angles. */
export const OBS_SIZE = 2 + 3 + 3 + 3 + 1 + NUM_JOINTS;

export class QuadrupedEnv {
  readonly params: WorldParams;
  world: RAPIER.World;
  torso: RAPIER.RigidBody;
  /** Pour chaque patte : cuisse et tibia (null si absent). */
  upper: RAPIER.RigidBody[] = [];
  lower: (RAPIER.RigidBody | null)[] = [];
  private joints: Joint[] = [];
  /** Dernières consignes d'angle (radians). */
  readonly targets = new Float64Array(NUM_JOINTS);
  /** Dernier couple estimé par articulation (N·m). */
  readonly torques = new Float64Array(NUM_JOINTS);
  private prevAngles = new Float64Array(NUM_JOINTS);
  readonly angles = new Float64Array(NUM_JOINTS);
  readonly angVels = new Float64Array(NUM_JOINTS);
  steps = 0;
  /** Fréquence du rythme interne (Hz), choisie par le cerveau (voir runEpisode). */
  gaitHz = GAIT_HZ;
  /** Phase du rythme interne (radians), intégrée pas à pas. */
  phase = 0;
  /** Énergie mécanique estimée dépensée par les moteurs (J). */
  energy = 0;
  /** Somme de l'inclinaison du tronc (rad · pas). */
  tiltSum = 0;
  fallen = false;
  readonly startX: number;
  private freed = false;

  constructor(params: WorldParams = DEFAULT_WORLD) {
    this.params = { ...params };
    const p = this.params;
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = DT;
    this.world = world;

    // Sol : une grande dalle fixe dont la face supérieure est à y = 0.
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(400, 0.5, 40).setFriction(p.friction).setRestitution(0).setCollisionGroups(GROUP_GROUND),
      ground,
    );

    // Tronc
    const y0 = START_HEIGHT;
    this.torso = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, y0, 0).setCanSleep(false));
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(TORSO_HALF.x, TORSO_HALF.y, TORSO_HALF.z)
        .setMass(TORSO_MASS * p.bodyMass)
        .setFriction(p.friction)
        .setCollisionGroups(GROUP_ROBOT),
      this.torso,
    );
    this.startX = 0;

    const maxTorque = MOTOR_MAX_TORQUE * p.motorStrength;
    const axis = { x: 0, y: 0, z: 1 };
    for (let leg = 0; leg < NUM_LEGS; leg++) {
      const front = leg < 2;
      const left = leg % 2 === 0;
      const hx = front ? HIP_OFFSET.x : -HIP_OFFSET.x;
      const hz = left ? HIP_OFFSET.z : -HIP_OFFSET.z;
      const hipY = y0 + HIP_OFFSET.y;
      const broken = leg === 0 && p.brokenFrontLeft;

      const upper = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(hx, hipY - UPPER_HALF_LEN, hz).setCanSleep(false),
      );
      world.createCollider(
        RAPIER.ColliderDesc.capsule(UPPER_HALF_LEN - UPPER_RADIUS * 0.5, UPPER_RADIUS)
          .setMass(0.6)
          .setFriction(p.friction)
          .setCollisionGroups(GROUP_ROBOT),
        upper,
      );
      this.upper.push(upper);
      const hip = world.createImpulseJoint(
        RAPIER.JointData.revolute({ x: hx, y: HIP_OFFSET.y, z: hz }, { x: 0, y: UPPER_HALF_LEN, z: 0 }, axis),
        this.torso,
        upper,
        true,
      ) as RAPIER.RevoluteImpulseJoint;
      hip.setContactsEnabled(false);
      hip.setLimits(-HIP_RANGE, HIP_RANGE);
      hip.configureMotorModel(RAPIER.MotorModel.ForceBased);
      hip.setMotorMaxForce(maxTorque);
      hip.configureMotorPosition(0, MOTOR_STIFFNESS, MOTOR_DAMPING);
      this.joints.push({ joint: hip, parent: this.torso, child: upper, range: HIP_RANGE, locked: false });

      if (broken) {
        this.lower.push(null);
        this.joints.push({ joint: null, parent: upper, child: null, range: KNEE_RANGE, locked: true });
        continue;
      }
      const lower = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(hx, hipY - 2 * UPPER_HALF_LEN - LOWER_HALF_LEN, hz)
          .setCanSleep(false),
      );
      world.createCollider(
        RAPIER.ColliderDesc.capsule(LOWER_HALF_LEN, LOWER_RADIUS)
          .setMass(0.4)
          .setFriction(p.friction)
          .setCollisionGroups(GROUP_ROBOT),
        lower,
      );
      this.lower.push(lower);
      const locked = leg === 3 && p.lockedRearRightKnee;
      const kneeA = { x: 0, y: -UPPER_HALF_LEN, z: 0 };
      const kneeB = { x: 0, y: LOWER_HALF_LEN, z: 0 };
      if (locked) {
        // Genou bloqué : liaison rigide (jambe tendue), le moteur n'existe plus.
        const id = { x: 0, y: 0, z: 0, w: 1 };
        world.createImpulseJoint(RAPIER.JointData.fixed(kneeA, id, kneeB, id), upper, lower, true).setContactsEnabled(false);
        this.joints.push({ joint: null, parent: upper, child: lower, range: KNEE_RANGE, locked: true });
        continue;
      }
      const knee = world.createImpulseJoint(RAPIER.JointData.revolute(kneeA, kneeB, axis), upper, lower, true) as RAPIER.RevoluteImpulseJoint;
      knee.setContactsEnabled(false);
      knee.setLimits(-KNEE_RANGE, KNEE_RANGE);
      knee.configureMotorModel(RAPIER.MotorModel.ForceBased);
      knee.setMotorMaxForce(maxTorque);
      knee.configureMotorPosition(0, MOTOR_STIFFNESS, MOTOR_DAMPING);
      this.joints.push({ joint: knee, parent: upper, child: lower, range: KNEE_RANGE, locked: false });
    }
    this.readJoints();
    this.prevAngles.set(this.angles);
  }

  /** Une articulation existe-t-elle et obéit-elle aux moteurs ? */
  isActuated(j: number): boolean {
    const jt = this.joints[j];
    return jt.joint !== null && !jt.locked;
  }

  private readJoints(): void {
    for (let j = 0; j < NUM_JOINTS; j++) {
      const jt = this.joints[j];
      if (!jt.child) {
        this.angles[j] = 0;
        continue;
      }
      this.angles[j] = relativeAngleZ(jt.parent.rotation(), jt.child.rotation());
    }
  }

  /** Temps simulé (s). */
  get time(): number {
    return this.steps * DT;
  }

  /** Distance parcourue vers l'avant (m). */
  get distance(): number {
    return this.torso.translation().x - this.startX;
  }

  /** Vecteur « haut » du tronc exprimé dans le monde (y ≈ 1 quand il est droit). */
  upVector(): Vec3 {
    return rotate(this.torso.rotation(), { x: 0, y: 1, z: 0 });
  }

  /** Ce que perçoit le robot, normalisé autour de [-1, 1]. */
  observe(out: Float64Array = new Float64Array(OBS_SIZE)): Float64Array {
    const q = this.torso.rotation();
    const g = rotateInv(q, { x: 0, y: -1, z: 0 });
    const v = rotateInv(q, this.torso.linvel());
    const w = rotateInv(q, this.torso.angvel());
    const ph = this.phase;
    let k = 0;
    out[k++] = Math.sin(ph);
    out[k++] = Math.cos(ph);
    out[k++] = g.x;
    out[k++] = g.y;
    out[k++] = g.z;
    out[k++] = v.x * 0.5;
    out[k++] = v.y * 0.5;
    out[k++] = v.z * 0.5;
    out[k++] = w.x * 0.25;
    out[k++] = w.y * 0.25;
    out[k++] = w.z * 0.25;
    out[k++] = (this.torso.translation().y - START_HEIGHT) * 4;
    for (let j = 0; j < NUM_JOINTS; j++) out[k++] = this.angles[j] / this.joints[j].range;
    return out;
  }

  /**
   * Applique les actions (une par articulation, dans [-1, 1] → consigne d'angle),
   * avance la physique d'un pas et met à jour les mesures.
   */
  step(actions: ArrayLike<number>): void {
    const stiff = MOTOR_STIFFNESS;
    const maxT = MOTOR_MAX_TORQUE * this.params.motorStrength;
    for (let j = 0; j < NUM_JOINTS; j++) {
      const jt = this.joints[j];
      if (!jt.joint || jt.locked) {
        this.targets[j] = 0;
        continue;
      }
      const a = Math.max(-1, Math.min(1, actions[j] ?? 0));
      const target = a * jt.range;
      this.targets[j] = target;
      jt.joint.configureMotorPosition(target, stiff, MOTOR_DAMPING);
    }
    this.world.step();
    this.steps++;
    this.phase += 2 * Math.PI * this.gaitHz * DT;
    if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
    this.prevAngles.set(this.angles);
    this.readJoints();
    let power = 0;
    for (let j = 0; j < NUM_JOINTS; j++) {
      const w = (this.angles[j] - this.prevAngles[j]) / DT;
      this.angVels[j] = w;
      if (!this.isActuated(j)) {
        this.torques[j] = 0;
        continue;
      }
      // Couple du régulateur PD (estimation : le solveur de Rapier le calcule comme une contrainte).
      const tau = Math.max(-maxT, Math.min(maxT, stiff * (this.targets[j] - this.angles[j]) - MOTOR_DAMPING * w));
      this.torques[j] = tau;
      power += Math.abs(tau * w);
    }
    this.energy += power * DT;
    const up = this.upVector();
    this.tiltSum += Math.acos(Math.max(-1, Math.min(1, up.y)));
    const h = this.torso.translation().y;
    if (up.y < 0.3 || h < FALL_HEIGHT) this.fallen = true;
  }

  /** Pose de chaque pièce (tronc, 4 cuisses, 4 tibias) pour l'affichage. */
  poses(): { torso: PartPose; upper: PartPose[]; lower: (PartPose | null)[] } {
    const pose = (b: RAPIER.RigidBody): PartPose => {
      const t = b.translation();
      const r = b.rotation();
      return { p: { x: t.x, y: t.y, z: t.z }, q: { x: r.x, y: r.y, z: r.z, w: r.w } };
    };
    return { torso: pose(this.torso), upper: this.upper.map(pose), lower: this.lower.map((b) => (b ? pose(b) : null)) };
  }

  /** Libère la mémoire WebAssembly (obligatoire : le ramasse-miettes JS ne la voit pas). */
  free(): void {
    if (this.freed) return;
    this.freed = true;
    this.world.free();
  }
}

/** Résultat d'un essai complet. */
export interface EpisodeResult {
  fitness: number;
  distance: number;
  /** Énergie estimée (J). */
  energy: number;
  /** Inclinaison moyenne du tronc (rad). */
  tilt: number;
  fell: boolean;
  steps: number;
}

/** Note d'un essai : distance − énergie − instabilité − chute. */
export function fitnessOf(distance: number, energy: number, tilt: number, fell: boolean, r: RewardParams): number {
  return distance - r.energyWeight * energy - r.stabilityWeight * tilt - (fell ? r.fallPenalty : 0);
}

/** Politique : observation → actions dans [-1, 1], avec éventuellement son propre tempo (Hz). */
export type Policy = ((obs: Float64Array) => ArrayLike<number>) & { gaitHz?: number };

/** Prépare un environnement pour une politique (tempo du rythme interne). */
export function newEnvFor(policy: Policy, world: WorldParams): QuadrupedEnv {
  const env = new QuadrupedEnv(world);
  env.gaitHz = policy.gaitHz ?? GAIT_HZ;
  return env;
}

/** Joue un essai (EPISODE_STEPS pas ou jusqu'à la chute) et le note. */
export function runEpisode(policy: Policy, world: WorldParams, reward: RewardParams, steps = EPISODE_STEPS): EpisodeResult {
  const env = newEnvFor(policy, world);
  const obs = new Float64Array(OBS_SIZE);
  try {
    while (env.steps < steps && !env.fallen) {
      env.observe(obs);
      env.step(policy(obs));
    }
    const distance = env.distance;
    const tilt = env.tiltSum / Math.max(1, env.steps);
    return {
      fitness: fitnessOf(distance, env.energy, tilt, env.fallen, reward),
      distance,
      energy: env.energy,
      tilt,
      fell: env.fallen,
      steps: env.steps,
    };
  } finally {
    env.free();
  }
}
