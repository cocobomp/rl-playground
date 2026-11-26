// « Moments clés » : instantanés du cerveau gardés pendant l'apprentissage, pour les revoir plus tard.
// Aucun accès au DOM : utilisé par la page, les tests et le script hors ligne (histoire du cerveau pré-entraîné).
import type { WorldConfig } from './env';

export type MomentKind =
  /** Génération 0 : le cerveau de départ. */
  | 'start'
  /** Premier essai qui va au bout des 10 s sans tomber. */
  | 'firstStand'
  /** Premier essai au-delà d'un palier de distance. */
  | 'milestone'
  /** Nouveau record de distance (gardé tant que la place le permet). */
  | 'record'
  /** Juste avant un nouvel apprentissage (changement de monde ou « Réapprendre »). */
  | 'before'
  /** Première génération du nouvel apprentissage : le même cerveau dans le nouveau monde. */
  | 'after'
  /** Cerveau final d'un entraînement hors ligne. */
  | 'final'
  /** Instantané régulier (toutes les N générations), supprimé en premier quand la place manque. */
  | 'regular';

export interface Moment {
  /** Numéro de génération (cumulé depuis le début de l'histoire). */
  gen: number;
  kind: MomentKind;
  /** Libellé court en français (« Génération 14 : premier essai sans chute »). */
  label: string;
  /** Les poids du cerveau (arrondis à 5 décimales, comme les cerveaux pré-entraînés). */
  params: number[];
  /** Le monde dans lequel il a été évalué : la rediffusion se fait dans ce monde. */
  config: WorldConfig;
  distance: number;
  fell: boolean;
  fitness: number;
  /** Jamais supprimé par l'élagage. */
  key: boolean;
}

/** Paliers de distance (m) : 1, 3, 5, 10, 15, 20, 25 m… adaptés à un robot qui fait environ 28 m au mieux. */
export const DISTANCE_MILESTONES = [1, 3, 5, 10, 15, 20, 25, 30];
/** Nombre maximal d'instantanés gardés (≈ 3 Ko chacun). */
export const MAX_MOMENTS = 60;
/** Un instantané régulier toutes les REGULAR_EVERY générations. */
export const REGULAR_EVERY = 10;
/** Un record n'ajoute un nouveau moment que s'il dépasse le précédent d'au moins ce nombre de mètres ; sinon il le remplace. */
export const RECORD_STEP_M = 1;

const KEY_KINDS: MomentKind[] = ['start', 'firstStand', 'milestone', 'before', 'after', 'final'];

/** Nombre à la française : 4,2 */
export function frNum(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '–';
  return v.toFixed(digits).replace('.', ',').replace('-', '−');
}

export function roundParams(p: ArrayLike<number>): number[] {
  return Array.from(p, (x) => +x.toFixed(5));
}

export interface GenObservation {
  gen: number;
  /** Le meilleur cerveau de la génération et son résultat. */
  params: ArrayLike<number>;
  distance: number;
  fell: boolean;
  fitness: number;
  config: WorldConfig;
}

export function momentLabel(kind: MomentKind, gen: number, distance: number, fell: boolean, extra = ''): string {
  const d = `${frNum(distance, 1)} m`;
  const g = `Génération ${gen}`;
  switch (kind) {
    case 'start':
      return fell ? `${g} : il tombe tout de suite` : `${g} : point de départ, ${d}`;
    case 'firstStand':
      if (distance < 0) return `${g} : premier essai sans chute… mais il recule (${d})`;
      return distance < 1 ? `${g} : premier essai sans chute, mais il fait du surplace (${d})` : `${g} : premier essai sans chute (${d})`;
    case 'milestone':
      return `${g} : premier essai à plus de ${extra} m`;
    case 'record':
      return `${g} : record, ${d}${fell ? ' (avec chute)' : ''}`;
    case 'before':
      return `${g} : ${extra || 'avant le changement'} (${d})`;
    case 'after':
      return `${g} : ${extra || 'juste après le changement'}, ${d}${fell ? ' puis chute' : ''}`;
    case 'final':
      return `${g} : ${extra || 'cerveau final'}, ${d}`;
    case 'regular':
      return `${g} : ${d}${fell ? ' (chute)' : ''}`;
  }
}

/**
 * Collection d'instantanés avec une politique de mémoire bornée :
 * les moments clés (départ, premier essai sans chute, paliers, avant/après) ne sont jamais supprimés ;
 * au-delà de MAX_MOMENTS, on retire d'abord des instantanés réguliers (là où ils sont le plus serrés),
 * puis des anciens records (jamais le dernier).
 */
export class Timeline {
  moments: Moment[] = [];
  /** État de la « séquence » en cours (remis à zéro à chaque nouvel apprentissage). */
  private stood = false;
  private nextMilestone = 0;
  private lastRecordIdx = -1;
  /** Meilleure distance de la séquence, et distance du dernier moment gardé pour un record (record, palier, départ…). */
  private lastRecordDist = -Infinity;
  private keptRecordDist = -Infinity;

  constructor(
    readonly cap = MAX_MOMENTS,
    readonly regularEvery = REGULAR_EVERY,
  ) {}

  /** Nouvelle séquence d'apprentissage (nouveau monde, nouveaux objectifs ou « Réapprendre »). */
  newSegment(): void {
    this.stood = false;
    this.nextMilestone = 0;
    this.lastRecordIdx = -1;
    this.lastRecordDist = -Infinity;
    this.keptRecordDist = -Infinity;
  }

  /**
   * Prend un résultat comme point de départ de la séquence sans créer de moment (ex. le moment « après » :
   * s'il ne tombait déjà pas, la génération suivante n'est pas un « premier essai sans chute »).
   */
  prime(o: { distance: number; fell: boolean; fitness: number }): void {
    if (!o.fell) this.stood = true;
    while (this.nextMilestone < DISTANCE_MILESTONES.length && o.distance >= DISTANCE_MILESTONES[this.nextMilestone]) this.nextMilestone++;
    this.lastRecordDist = Math.max(this.lastRecordDist, o.distance);
    this.keptRecordDist = Math.max(this.keptRecordDist, o.distance);
  }

  /** Ajoute un moment tel quel (cerveaux pré-entraînés, avant/après). */
  push(m: Omit<Moment, 'key' | 'label' | 'params'> & { params: ArrayLike<number>; label?: string; key?: boolean; extra?: string }): Moment {
    const mm: Moment = {
      gen: m.gen,
      kind: m.kind,
      params: roundParams(m.params),
      config: { ...m.config },
      distance: m.distance,
      fell: m.fell,
      fitness: m.fitness,
      key: m.key ?? KEY_KINDS.includes(m.kind),
      label: m.label ?? momentLabel(m.kind, m.gen, m.distance, m.fell, m.extra),
    };
    this.moments.push(mm);
    this.thin();
    return mm;
  }

  /**
   * Observe le meilleur cerveau d'une génération ; ajoute les moments qui s'imposent.
   * `isStart` : première génération d'une histoire (cerveau de départ, génération 0).
   */
  observe(o: GenObservation, isStart = false): Moment[] {
    const added: Moment[] = [];
    const base = { gen: o.gen, params: o.params, config: o.config, distance: o.distance, fell: o.fell, fitness: o.fitness };
    if (isStart) added.push(this.push({ ...base, kind: 'start' }));
    if (!o.fell && !this.stood) {
      this.stood = true;
      if (!isStart) added.push(this.push({ ...base, kind: 'firstStand' }));
    }
    // Paliers de distance : on ne retient que le plus haut franchi d'un coup.
    let crossed = -1;
    while (this.nextMilestone < DISTANCE_MILESTONES.length && o.distance >= DISTANCE_MILESTONES[this.nextMilestone]) {
      crossed = this.nextMilestone++;
    }
    if (crossed >= 0 && !isStart) added.push(this.push({ ...base, kind: 'milestone', extra: String(DISTANCE_MILESTONES[crossed]) }));
    // Record de distance de la séquence.
    if (o.distance > this.lastRecordDist) {
      this.lastRecordDist = o.distance;
      if (!added.length && !isStart) {
        const prev = this.lastRecordIdx >= 0 ? this.moments[this.lastRecordIdx] : null;
        if (o.distance - this.keptRecordDist < RECORD_STEP_M) {
          // Petit progrès : on met à jour le dernier record (s'il y en a un), sans empiler de nouveau moment.
          if (prev && prev.kind === 'record') {
            // Nouvel objet (le précédent peut être en cours de revue) ; il passe en dernier pour garder l'ordre chronologique.
            const next: Moment = {
              ...prev,
              gen: o.gen,
              params: roundParams(o.params),
              distance: o.distance,
              fell: o.fell,
              fitness: o.fitness,
              label: momentLabel('record', o.gen, o.distance, o.fell),
            };
            this.moments.splice(this.lastRecordIdx, 1);
            this.moments.push(next);
            this.lastRecordIdx = this.moments.length - 1;
          }
          return added;
        }
        added.push(this.push({ ...base, kind: 'record' }));
      }
      if (added.length) {
        this.lastRecordIdx = this.moments.length - 1;
        this.keptRecordDist = o.distance;
      }
      return added;
    }
    if (!added.length && o.gen % this.regularEvery === 0) added.push(this.push({ ...base, kind: 'regular' }));
    return added;
  }

  private thin(): void {
    while (this.moments.length > this.cap) {
      const idx = this.pickVictim();
      if (idx < 0) return;
      this.moments.splice(idx, 1);
      if (this.lastRecordIdx > idx) this.lastRecordIdx--;
      else if (this.lastRecordIdx === idx) this.lastRecordIdx = -1;
    }
  }

  /** Indice du moment à retirer : un régulier là où les instantanés sont le plus serrés, sinon le plus vieux record. */
  private pickVictim(): number {
    let best = -1;
    let bestGap = Infinity;
    const ms = this.moments;
    for (let i = 0; i < ms.length; i++) {
      if (ms[i].kind !== 'regular') continue;
      const prev = i > 0 ? ms[i - 1].gen : ms[i].gen;
      const next = i < ms.length - 1 ? ms[i + 1].gen : Infinity;
      const gap = next - prev;
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    if (best >= 0) return best;
    let lastRecord = -1;
    for (let i = ms.length - 1; i >= 0; i--)
      if (ms[i].kind === 'record') {
        lastRecord = i;
        break;
      }
    for (let i = 0; i < ms.length; i++) if (ms[i].kind === 'record' && !ms[i].key && i !== lastRecord) return i;
    return -1;
  }

  /** Les moments mis en avant dans la liste (tout sauf les réguliers). */
  highlights(): Moment[] {
    return this.moments.filter((m) => m.kind !== 'regular');
  }

  /** Le moment enregistré le plus proche d'une génération. */
  nearest(gen: number): Moment | null {
    let best: Moment | null = null;
    for (const m of this.moments) if (!best || Math.abs(m.gen - gen) < Math.abs(best.gen - gen)) best = m;
    return best;
  }

  clear(): void {
    this.moments = [];
    this.newSegment();
  }
}

/** Format compact d'une histoire pré-entraînée (fichier JSON livré avec la page). */
export interface StoryJSON {
  /** Dernière génération de l'entraînement (la courbe s'arrête là). */
  endGen: number;
  /** Courbes par génération (index 0 = génération 1). */
  curve: { bestDist: number[]; meanDist: number[]; bestFit: number[]; meanFit: number[] };
  moments: Array<Omit<Moment, 'config' | 'key'> & { config?: Partial<WorldConfig> }>;
}
