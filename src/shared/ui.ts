// Petits utilitaires d'interface partagés par tous les problèmes.

/** Crée un élément à partir d'un fragment HTML (un seul élément racine). */
export function h<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

export interface SliderOptions {
  label: string;
  /** Explication courte, affichée sous le curseur. */
  help?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  onInput: (v: number) => void;
}

let sliderCounter = 0;

/** Curseur avec étiquette, valeur affichée et explication (classe CSS .slider). */
export function createSlider(o: SliderOptions): { el: HTMLElement; set: (v: number) => void; input: HTMLInputElement } {
  const id = `sl-${++sliderCounter}`;
  const el = h(`
    <div class="slider">
      <div class="slider-head"><label for="${id}"></label><output for="${id}"></output></div>
      <input type="range" id="${id}" min="${o.min}" max="${o.max}" step="${o.step}" ${o.help ? `aria-describedby="${id}-help"` : ''} />
      ${o.help ? `<p class="help" id="${id}-help"></p>` : ''}
    </div>`);
  el.querySelector('label')!.textContent = o.label;
  if (o.help) el.querySelector('.help')!.textContent = o.help;
  const input = el.querySelector('input')!;
  const output = el.querySelector('output')!;
  const fmt = o.format ?? ((v: number) => (Number.isInteger(o.step) ? String(v) : v.toFixed(2)));
  const set = (v: number) => {
    input.value = String(v);
    output.textContent = fmt(Number(input.value));
  };
  input.addEventListener('input', () => {
    const v = Number(input.value);
    output.textContent = fmt(v);
    o.onInput(v);
  });
  set(o.value);
  return { el, set, input };
}

export interface ThemeColors {
  bg: string; panel: string; text: string; muted: string; border: string; accent: string;
  cell: string; wall: string; trap: string; goal: string; start: string; agent: string;
  /** Triplets "r, g, b" pour construire des rgba(). */
  good: string; bad: string;
  gridLine: string; chartRaw: string; chartAvg: string;
  /** Palette catégorielle pour plusieurs séries / bras / variantes. */
  series: string[];
}

/** Lit les couleurs du thème courant (variables CSS de :root). */
export function readTheme(): ThemeColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    bg: v('--bg'), panel: v('--panel'), text: v('--text'), muted: v('--muted'), border: v('--border'), accent: v('--accent'),
    cell: v('--cell'), wall: v('--wall'), trap: v('--trap'), goal: v('--goal'), start: v('--start'), agent: v('--agent'),
    good: v('--good'), bad: v('--bad'), gridLine: v('--grid-line'), chartRaw: v('--chart-raw'), chartAvg: v('--chart-avg'),
    series: [1, 2, 3, 4, 5, 6].map((i) => v(`--series-${i}`)),
  };
}

/** Appelle cb quand le thème clair/sombre change. Renvoie la fonction de désabonnement. */
export function onThemeChange(cb: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/**
 * Ajuste la résolution interne d'un canvas à sa taille CSS × devicePixelRatio
 * et renvoie un contexte déjà mis à l'échelle (on dessine en pixels CSS).
 */
export function prepareCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const hgt = canvas.clientHeight;
  const W = Math.round(w * dpr);
  const H = Math.round(hgt * dpr);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: hgt };
}

/** Boucle requestAnimationFrame annulable. */
export function rafLoop(cb: (now: number) => void): () => void {
  let id = 0;
  let alive = true;
  const tick = (now: number) => {
    if (!alive) return;
    cb(now);
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => {
    alive = false;
    cancelAnimationFrame(id);
  };
}

/** Observe les changements de taille d'un élément. Renvoie la fonction d'arrêt. */
export function onResize(el: Element, cb: () => void): () => void {
  const ro = new ResizeObserver(cb);
  ro.observe(el);
  return () => ro.disconnect();
}
