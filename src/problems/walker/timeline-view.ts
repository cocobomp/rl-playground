// Affichage des « Moments clés » : liste cliquable, curseur pour parcourir les générations,
// repères sur la courbe. Ne contient aucune logique d'apprentissage.
import { prepareCanvas, type ThemeColors } from '../../shared/ui';
import type { Moment, Timeline } from './timeline';
import { worldLabel } from './config';

/** Même marge que src/shared/chart.ts, pour aligner les repères sur la courbe. */
const PAD = { l: 44, r: 10, t: 10, b: 24 };

export interface TimelineViewHooks {
  onView: (m: Moment) => void;
  onCompare: (m: Moment) => void;
}

export interface TimelineState {
  viewing: Moment | null;
  compare: Moment | null;
  /** Nombre de points de la courbe (pour aligner les repères). */
  chartLength: number;
}

export class TimelineView {
  private lastSig = '';
  private items: { m: Moment; li: HTMLLIElement; view: HTMLButtonElement; cmp: HTMLButtonElement }[] = [];

  constructor(
    private timeline: Timeline,
    private list: HTMLOListElement,
    private scrub: HTMLInputElement,
    private scrubOut: HTMLElement,
    private marks: HTMLCanvasElement,
    chart: HTMLCanvasElement,
    private hooks: TimelineViewHooks,
  ) {
    scrub.addEventListener('input', () => {
      const m = this.timeline.moments[Number(scrub.value)];
      if (m) hooks.onView(m);
    });
    chart.addEventListener('click', (ev) => {
      const n = this.chartLength;
      if (n < 1) return;
      const rect = chart.getBoundingClientRect();
      const pw = rect.width - PAD.l - PAD.r;
      const f = Math.max(0, Math.min(1, (ev.clientX - rect.left - PAD.l) / pw));
      const gen = Math.round(f * (n - 1)) + 1;
      const m = this.timeline.nearest(gen);
      if (m) hooks.onView(m);
    });
  }

  private chartLength = 0;
  private toStart = false;

  /** Au prochain affichage, la liste repart du début (nouvelle histoire). */
  scrollToStart(): void {
    this.toStart = true;
  }

  /** Reconstruit la liste si les moments ont changé ; met à jour l'état actif. */
  render(state: TimelineState): void {
    this.chartLength = state.chartLength;
    const ms = this.timeline.moments;
    const hl = this.timeline.highlights();
    const sig = hl.map((m) => `${m.gen}|${m.kind}|${m.label}`).join(';') + `#${ms.length}`;
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      const atBottom = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 8;
      this.list.replaceChildren();
      this.items = hl.map((m) => {
        const li = document.createElement('li');
        li.className = `walker-moment walker-moment-${m.kind}`;
        const view = document.createElement('button');
        view.type = 'button';
        view.className = 'walker-moment-view';
        const t = document.createElement('span');
        t.className = 'walker-moment-label';
        t.textContent = m.label;
        const sub = document.createElement('span');
        sub.className = 'walker-moment-sub';
        sub.textContent = worldLabel(m.config) + (m.fell ? ' · tombe' : ' · sans chute');
        view.append(t, sub);
        view.addEventListener('click', () => this.hooks.onView(m));
        const cmp = document.createElement('button');
        cmp.type = 'button';
        cmp.className = 'ghost walker-moment-cmp';
        cmp.textContent = 'Comparer';
        cmp.setAttribute('aria-label', `Comparer : ${m.label} (en fantôme)`);
        cmp.addEventListener('click', () => this.hooks.onCompare(m));
        li.append(view, cmp);
        this.list.appendChild(li);
        return { m, li, view, cmp };
      });
      if (!hl.length) {
        const li = document.createElement('li');
        li.className = 'walker-empty';
        li.textContent = 'Aucun moment enregistré : lancez l’apprentissage.';
        this.list.appendChild(li);
      }
      if (atBottom && !this.toStart) this.list.scrollTop = this.list.scrollHeight;
      this.scrub.max = String(Math.max(0, ms.length - 1));
      this.scrub.disabled = ms.length === 0;
    }
    if (this.toStart) {
      this.list.scrollTop = 0;
      this.toStart = false;
    }
    for (const it of this.items) {
      const on = it.m === state.viewing;
      it.li.classList.toggle('active', on);
      it.view.setAttribute('aria-pressed', String(on));
      const c = it.m === state.compare;
      it.cmp.classList.toggle('active', c);
      it.cmp.setAttribute('aria-pressed', String(c));
    }
    const vi = state.viewing ? ms.indexOf(state.viewing) : -1;
    if (vi >= 0) this.scrub.value = String(vi);
    else this.scrub.value = this.scrub.max;
    const cur = vi >= 0 ? state.viewing : null;
    this.scrubOut.textContent = cur
      ? `génération ${cur.gen}`
      : ms.length
        ? `${ms.length} enregistrée${ms.length > 1 ? 's' : ''}`
        : '';
  }

  /** Repères des moments clés sous la courbe + ligne verticale sur la génération regardée. */
  drawMarks(theme: ThemeColors, state: TimelineState): void {
    const { ctx, w, h } = prepareCanvas(this.marks);
    ctx.clearRect(0, 0, w, h);
    const n = state.chartLength;
    if (n < 1 || w === 0) return;
    const pw = w - PAD.l - PAD.r;
    const x = (gen: number) => PAD.l + (n <= 1 ? pw / 2 : (Math.max(0, Math.min(n - 1, gen - 1)) / (n - 1)) * pw);
    const yb = h - PAD.b;
    for (const m of this.timeline.highlights()) {
      const X = x(m.gen);
      ctx.fillStyle = m.kind === 'before' || m.kind === 'after' ? theme.trap : theme.accent;
      ctx.beginPath();
      ctx.moveTo(X, yb - 7);
      ctx.lineTo(X + 4, yb - 3);
      ctx.lineTo(X, yb + 1);
      ctx.lineTo(X - 4, yb - 3);
      ctx.closePath();
      ctx.fill();
    }
    const vline = (m: Moment | null, color: string, dashed: boolean) => {
      if (!m) return;
      const X = x(m.gen);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(dashed ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(X, PAD.t);
      ctx.lineTo(X, yb);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    vline(state.compare, theme.muted, true);
    vline(state.viewing, theme.text, false);
  }
}
