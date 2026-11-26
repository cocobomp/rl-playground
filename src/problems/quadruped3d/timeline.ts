// Frise des « moments clés » : liste cliquable, curseur pour parcourir les générations gardées,
// et choix d'un fantôme pour comparer deux générations.
import type { Moment } from './moments';
import { fmtDist } from './moments';

export interface TimelineHandlers {
  /** Revoir un moment (null : revenir au direct). */
  onView: (m: Moment | null) => void;
  /** Choisir le fantôme : un moment, « live » (le cerveau en direct) ou null. */
  onGhost: (g: Moment | 'live' | null) => void;
}

const KIND_TAG: Record<Moment['kind'], string> = {
  start: 'départ',
  nofall: 'sans chute',
  milestone: 'palier',
  record: 'record',
  before: 'avant',
  after: 'après',
  adapted: 'adapté',
  regular: '',
  offline: '',
};

export class Timeline {
  private list: HTMLOListElement;
  private scrub: HTMLInputElement;
  private scrubOut: HTMLOutputElement;
  private ghostSel: HTMLSelectElement;
  private moments: Moment[] = [];
  private viewing: number | null = null;
  private ghost: number | 'live' | null = null;
  private stickToEnd = true;

  constructor(root: HTMLElement, private h: TimelineHandlers) {
    this.list = root.querySelector('#quadruped3d-moments') as HTMLOListElement;
    this.scrub = root.querySelector('#quadruped3d-scrub') as HTMLInputElement;
    this.scrubOut = root.querySelector('#quadruped3d-scrub-out') as HTMLOutputElement;
    this.ghostSel = root.querySelector('#quadruped3d-ghost') as HTMLSelectElement;
    this.list.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest('button[data-id]') as HTMLButtonElement | null;
      if (!b) return;
      const m = this.moments.find((x) => x.id === Number(b.dataset.id));
      if (m) this.h.onView(this.viewing === m.id ? null : m);
    });
    this.list.addEventListener('scroll', () => {
      const l = this.list;
      this.stickToEnd = l.scrollTop + l.clientHeight >= l.scrollHeight - 8;
    });
    this.scrub.addEventListener('input', () => {
      const m = this.moments[Number(this.scrub.value)];
      if (m) this.h.onView(m);
    });
    this.ghostSel.addEventListener('change', () => {
      const v = this.ghostSel.value;
      if (v === '') this.h.onGhost(null);
      else if (v === 'live') this.h.onGhost('live');
      else {
        const m = this.moments.find((x) => x.id === Number(v));
        this.h.onGhost(m ?? null);
      }
    });
  }

  /** Reconstruit la frise (appelé quand la liste des moments change). */
  setMoments(ms: Moment[]): void {
    this.moments = ms.slice();
    const frag = document.createDocumentFragment();
    for (const m of this.moments) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = String(m.id);
      b.className = `quadruped3d-moment quadruped3d-moment-${m.kind}${m.offline ? ' quadruped3d-moment-offline' : ''}`;
      const tag = m.offline ? 'hors ligne' : KIND_TAG[m.kind];
      if (tag) {
        const t = document.createElement('span');
        t.className = 'quadruped3d-moment-tag';
        t.textContent = tag;
        b.append(t);
      }
      b.append(m.label);
      li.append(b);
      frag.append(li);
    }
    this.list.replaceChildren(frag);
    if (this.moments.length === 0) {
      const li = document.createElement('li');
      li.className = 'quadruped3d-moments-empty';
      li.textContent = 'Aucun moment pour l’instant : lancez l’apprentissage, les étapes marquantes apparaîtront ici.';
      this.list.append(li);
    }
    this.scrub.max = String(Math.max(0, this.moments.length - 1));
    this.scrub.disabled = this.moments.length < 2;
    // Fantôme : « aucun », « le direct », puis chaque moment.
    const cur = this.ghostSel.value;
    this.ghostSel.replaceChildren();
    const opt = (value: string, text: string) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      this.ghostSel.append(o);
    };
    opt('', 'aucun fantôme');
    opt('live', 'le cerveau en direct');
    for (const m of this.moments) opt(String(m.id), `${m.offline ? 'hors ligne, ' : ''}${m.label}`);
    this.ghostSel.value = [...this.ghostSel.options].some((o) => o.value === cur) ? cur : '';
    if (this.ghostSel.value !== cur) this.ghost = null;
    if (this.viewing !== null && !this.moments.some((m) => m.id === this.viewing)) this.viewing = null;
    this.refresh();
    if (this.stickToEnd && this.viewing === null) this.list.scrollTop = this.list.scrollHeight;
  }

  setViewing(m: Moment | null): void {
    this.viewing = m ? m.id : null;
    this.refresh();
    if (m) this.list.querySelector(`button[data-id="${m.id}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  setGhost(g: Moment | 'live' | null): void {
    this.ghost = g === 'live' ? 'live' : g ? g.id : null;
    this.ghostSel.value = this.ghost === null ? '' : String(this.ghost);
  }

  private refresh(): void {
    this.list.querySelectorAll('button[data-id]').forEach((b) => {
      const on = Number((b as HTMLElement).dataset.id) === this.viewing;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const i = this.moments.findIndex((m) => m.id === this.viewing);
    if (i >= 0) this.scrub.value = String(i);
    else this.scrub.value = this.scrub.max;
    const m = i >= 0 ? this.moments[i] : null;
    this.scrubOut.textContent = m
      ? `génération ${m.generation} (${fmtDist(m.distance)})`
      : this.moments.length
        ? 'direct'
        : '–';
  }
}
