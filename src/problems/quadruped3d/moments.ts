// « Moments clés » de l'apprentissage : cerveaux mis de côté pour être revus plus tard (sans DOM).
// On garde la génération 0, les records nets, le premier essai sans chute, les paliers de distance,
// les générations juste avant et juste après chaque changement, et une génération régulière de temps
// en temps. Les générations régulières sont éclaircies quand la mémoire est pleine ; les autres restent.
import type { WorldParams } from './env';

export type MomentKind = 'start' | 'nofall' | 'milestone' | 'record' | 'before' | 'after' | 'adapted' | 'regular' | 'offline';

export interface Moment {
  id: number;
  /** Numéro de génération affiché. */
  generation: number;
  kind: MomentKind;
  /** Titre court (« Génération 14 : premier essai sans chute »). */
  label: string;
  distance: number;
  fell: boolean;
  params: Float64Array;
  /** Monde dans lequel ce cerveau a été noté (rejoué tel quel). */
  world: WorldParams;
  /** Moment venu de l'entraînement hors ligne. */
  offline?: boolean;
}

/** Paliers de distance (m) en 8 s. */
export const MILESTONES = [1, 3, 5, 8, 12, 16, 20];
/** Une génération régulière toutes les REGULAR_EVERY générations. */
export const REGULAR_EVERY = 10;
/** Nombre maximal de moments gardés. */
export const MAX_MOMENTS = 60;
/** Un record n'est gardé que s'il dépasse le précédent record gardé d'au moins RECORD_STEP (fraction) et 0,2 m. */
export const RECORD_STEP = 0.1;
/** « Premier essai sans chute » : seulement s'il avance d'au moins NOFALL_MIN m (rester debout sur place n'apprend rien). */
export const NOFALL_MIN = 0.5;

const fr = (v: number, d = 1) => v.toFixed(d).replace('.', ',').replace('-', '−');
export const fmtDist = (v: number) => `${fr(v)} m`;

export interface GenInfo {
  generation: number;
  distance: number;
  fell: boolean;
}

export class MomentStore {
  moments: Moment[] = [];
  private nextId = 1;
  /** État de la phase en cours (remis à zéro à chaque changement de monde ou de cerveau). */
  private record = -Infinity;
  private keptRecord = -Infinity;
  private seenNoFall = false;
  private milestone = -1;
  private phaseStart = -1;
  /** Un événement « après » attend la prochaine génération. */
  private pendingAfter: string | null = null;

  constructor(public max = MAX_MOMENTS) {}

  clear(): void {
    this.moments = [];
    this.newPhase();
    this.pendingAfter = null;
  }

  /** Nouvelle phase (nouveau monde, nouveau cerveau) : records et paliers repartent de zéro. */
  newPhase(): void {
    this.record = -Infinity;
    this.keptRecord = -Infinity;
    this.seenNoFall = false;
    this.milestone = -1;
    this.phaseStart = -1;
  }

  /** Ajoute des moments venus d'ailleurs (histoire de l'entraînement hors ligne). */
  addOffline(list: Array<Omit<Moment, 'id' | 'offline'>>): void {
    for (const m of list) this.push({ ...m, offline: true });
  }

  /** Signale un changement (intervention, « Réapprendre ») : on garde le cerveau tel qu'il était juste avant. */
  markChange(before: GenInfo & { params: ArrayLike<number>; world: WorldParams } | null, what: string): void {
    if (before)
      this.push({
        generation: before.generation,
        kind: 'before',
        label: `Avant : ${what}`,
        distance: before.distance,
        fell: before.fell,
        params: Float64Array.from(before.params),
        world: { ...before.world },
      });
    this.newPhase();
    this.pendingAfter = what;
  }

  /** « Réapprendre » : la première génération notée sera marquée « juste après » (s'il y a déjà une histoire). */
  markRestart(): void {
    if (!this.pendingAfter && this.moments.length) this.pendingAfter = 'Réapprendre';
    this.newPhase();
  }

  /** Une génération vient d'être notée : renvoie les moments ajoutés. */
  observe(g: GenInfo, params: ArrayLike<number>, world: WorldParams): Moment[] {
    const added: Moment[] = [];
    const add = (kind: MomentKind, label: string) => {
      const m = this.push({ generation: g.generation, kind, label, distance: g.distance, fell: g.fell, params: Float64Array.from(params), world: { ...world } });
      added.push(m);
    };
    const first = this.phaseStart < 0;
    if (first) this.phaseStart = g.generation;
    const d = fmtDist(g.distance);
    const gl = `Génération ${g.generation}`;
    if (this.pendingAfter) {
      add('after', `${gl} : juste après « ${this.pendingAfter} », ${d}${g.fell ? ', il tombe' : ''}`);
      this.pendingAfter = null;
    } else if (first && this.moments.length === 0) {
      add('start', `${gl} : ${g.fell ? 'il tombe' : g.distance < 0.5 ? 'il piétine sur place' : `${d}`}${g.fell && g.distance < 0.5 ? ' tout de suite' : ''}`);
    }
    let noFall = false;
    if (!g.fell && g.distance >= NOFALL_MIN && !this.seenNoFall) {
      this.seenNoFall = true;
      noFall = !first;
    }
    let ms = this.milestone;
    while (ms + 1 < MILESTONES.length && g.distance >= MILESTONES[ms + 1]) ms++;
    const newRecord = g.distance > this.record;
    if (newRecord) this.record = g.distance;
    const milestone = ms > this.milestone && !first;
    if (ms > this.milestone) {
      this.milestone = ms;
      this.keptRecord = Math.max(this.keptRecord, g.distance);
    }
    if (noFall && milestone) add('milestone', `${gl} : premier essai sans chute et cap des ${MILESTONES[ms]} m franchi (${d})`);
    else if (noFall) add('nofall', `${gl} : premier essai sans chute, ${d}`);
    else if (milestone) add('milestone', `${gl} : cap des ${MILESTONES[ms]} m franchi (${d})`);
    else if (newRecord && !first && g.distance >= this.keptRecord + Math.max(0.2, RECORD_STEP * Math.abs(this.keptRecord))) {
      this.keptRecord = g.distance;
      add('record', `${gl} : record, ${d}`);
    }
    if (added.length === 0 && g.generation % REGULAR_EVERY === 0) add('regular', `${gl} : ${d}${g.fell ? ', chute' : ''}`);
    return added;
  }

  /** Après une adaptation réussie (la courbe plafonne), on garde le cerveau obtenu. */
  markAdapted(g: GenInfo, params: ArrayLike<number>, world: WorldParams, what: string): Moment {
    return this.push({ generation: g.generation, kind: 'adapted', label: `Génération ${g.generation} : après adaptation (${what}), ${fmtDist(g.distance)}`, distance: g.distance, fell: g.fell, params: Float64Array.from(params), world: { ...world } });
  }

  get(id: number): Moment | undefined {
    return this.moments.find((m) => m.id === id);
  }

  private push(m: Omit<Moment, 'id'>): Moment {
    const full: Moment = { ...m, id: this.nextId++ };
    this.moments.push(full);
    this.thin();
    return full;
  }

  /** Éclaircit : d'abord la plus ancienne génération régulière, puis (en dernier recours) le plus ancien record. */
  private thin(): void {
    while (this.moments.length > this.max) {
      const victim = this.moments.find((m) => m.kind === 'regular') ?? this.moments.find((m) => m.kind === 'record');
      if (!victim) break; // que des moments clés : on dépasse la limite plutôt que d'en perdre un
      this.moments = this.moments.filter((m) => m !== victim);
    }
  }
}
