// Réglages du robot marcheur : interventions, objectifs (« Ce que le robot cherche ») et paramètres experts.
import { CURIOSITY_LEVELS, FALL_LEVELS, INTERVENTIONS, Level, PRIORITY_LEVELS, Settings, UPRIGHT_LEVELS, fmt } from './config';
import { HEALTHY, WorldConfig } from './env';
import { createSlider } from '../../shared/ui';

export interface SettingsHooks {
  getConfig: () => WorldConfig;
  setConfig: (c: WorldConfig) => void;
  /** Objectifs ou hyper-paramètres modifiés (déjà écrits dans settings). */
  objectivesChanged: () => void;
  workerInfo: string;
}

export function mountSettings(root: HTMLElement, settings: Settings, hooks: SettingsHooks): { refreshInterventions: () => void } {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector(`#walker-${id}`) as T;

  const interBox = $('interventions');
  const interInputs = INTERVENTIONS.map((it) => {
    const id = `walker-int-${it.key}`;
    const wrap = document.createElement('div');
    wrap.className = 'walker-intervention';
    wrap.innerHTML = `<label class="check walker-int-label"><input type="checkbox" id="${id}" aria-describedby="${id}-help" /> <span></span></label><p class="help" id="${id}-help"></p>`;
    wrap.querySelector('span')!.textContent = it.label;
    wrap.querySelector('.help')!.textContent = it.help;
    const input = wrap.querySelector('input')!;
    input.addEventListener('change', () => {
      hooks.setConfig({ ...hooks.getConfig(), [it.key]: input.checked });
    });
    interBox.appendChild(wrap);
    return { it, input, wrap };
  });

  function refreshInterventions() {
    for (const { it, input, wrap } of interInputs) {
      const config = hooks.getConfig();
      input.checked = config[it.key];
      wrap.classList.toggle('walker-on', config[it.key]);
    }
  }

  $('btn-heal').addEventListener('click', () => hooks.setConfig({ ...HEALTHY }));

  interface KnobDef {
    id: string;
    label: string;
    help: string;
    levels: Level<number>[];
    get: () => number;
    set: (v: number) => void;
    kind: 'range' | 'segmented';
    ends?: [string, string];
  }
  const KNOBS: KnobDef[] = [
    {
      id: 'priority',
      label: 'Priorité',
      kind: 'range',
      ends: ['Aller vite', 'Économiser l’énergie'],
      help: 'Plus vous allez vers l’économie, plus chaque joule dépensé par les moteurs coûte de points. Observez après quelques dizaines de générations : l’énergie dépensée baisse dans le tableau des mesures, et en général la vitesse aussi.',
      levels: PRIORITY_LEVELS,
      get: () => settings.objectives.energy,
      set: (v) => (settings.objectives.energy = v),
    },
    {
      id: 'fall',
      label: 'Ne jamais tomber',
      kind: 'segmented',
      help: 'Pénalité retirée du score en cas de chute. Forte : le robot apprend une démarche plus prudente, quitte à aller moins loin. Nulle : il peut tenter un « plongeon » final pour gagner quelques centimètres.',
      levels: FALL_LEVELS,
      get: () => settings.objectives.fall,
      set: (v) => (settings.objectives.fall = v),
    },
    {
      id: 'upright',
      label: 'Se tenir droit',
      kind: 'segmented',
      help: 'Pénalité proportionnelle à l’inclinaison moyenne du torse. Forte : il garde le dos horizontal au lieu de se pencher pour « tomber vers l’avant ».',
      levels: UPRIGHT_LEVELS,
      get: () => settings.objectives.upright,
      set: (v) => (settings.objectives.upright = v),
    },
    {
      id: 'curiosity',
      label: 'Curiosité',
      kind: 'segmented',
      help: 'Taille des variations essayées autour du cerveau actuel. Prudente : progrès lents mais réguliers. Aventureuse : il essaie des démarches très différentes, ce qui peut débloquer une situation… ou rendre la courbe chaotique.',
      levels: CURIOSITY_LEVELS,
      get: () => settings.es.sigma,
      set: (v) => (settings.es.sigma = v),
    },
  ];

  const knobUIs: { def: KnobDef; out: HTMLElement; buttons?: HTMLButtonElement[]; range?: HTMLInputElement }[] = [];
  const knobBox = $('knobs');
  for (const def of KNOBS) {
    const id = `walker-knob-${def.id}`;
    const wrap = document.createElement('div');
    wrap.className = 'walker-knob';
    wrap.innerHTML = `
      <div class="slider-head"><span class="walker-knob-name" id="${id}-label"></span><output id="${id}-out" aria-live="polite"></output></div>
      <div class="walker-knob-control"></div>
      <p class="help" id="${id}-help"></p>`;
    wrap.querySelector('.walker-knob-name')!.textContent = def.label;
    wrap.querySelector('.help')!.textContent = def.help;
    const ctrl = wrap.querySelector('.walker-knob-control')!;
    const ui: (typeof knobUIs)[number] = { def, out: wrap.querySelector('output')! };
    if (def.kind === 'range') {
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = String(def.levels.length - 1);
      range.step = '1';
      range.id = `${id}-range`;
      range.setAttribute('aria-labelledby', `${id}-label`);
      range.setAttribute('aria-describedby', `${id}-help`);
      range.addEventListener('input', () => applyKnob(def, def.levels[Number(range.value)].value));
      const ends = document.createElement('div');
      ends.className = 'walker-ends';
      ends.innerHTML = '<span></span><span></span>';
      ends.children[0].textContent = def.ends![0];
      ends.children[1].textContent = def.ends![1];
      ctrl.append(range, ends);
      ui.range = range;
    } else {
      const seg = document.createElement('div');
      seg.className = 'segmented walker-seg';
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-labelledby', `${id}-label`);
      ui.buttons = def.levels.map((lv) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = lv.label;
        b.addEventListener('click', () => applyKnob(def, lv.value));
        seg.appendChild(b);
        return b;
      });
      ctrl.appendChild(seg);
    }
    knobUIs.push(ui);
    knobBox.appendChild(wrap);
  }

  function applyKnob(def: KnobDef, v: number) {
    def.set(v);
    objectivesChanged();
  }

  function objectivesChanged() {
    hooks.objectivesChanged();
    refreshKnobs();
    syncSliders();
  }

  function refreshKnobs() {
    for (const ui of knobUIs) {
      const v = ui.def.get();
      const idx = ui.def.levels.findIndex((l) => Math.abs(l.value - v) < 1e-9);
      ui.out.textContent = idx >= 0 ? ui.def.levels[idx].label : 'personnalisé';
      ui.out.classList.toggle('walker-custom', idx < 0);
      ui.buttons?.forEach((b, i) => {
        b.classList.toggle('active', i === idx);
        b.setAttribute('aria-pressed', String(i === idx));
      });
      if (ui.range && idx >= 0) ui.range.value = String(idx);
    }
    const o = settings.objectives;
    $('formula').textContent =
      `score = ${fmt(o.speed, 1)} × distance − ${fmt(o.energy, 2)} × énergie ÷ 100 − ${fmt(o.fall, 0)} si chute − ${fmt(o.upright, 1)} × inclinaison`;
  }

  // Paramètres experts
  const sliderBox = $('sliders');
  const sliders: { set: (v: number) => void; get: () => number }[] = [];
  const addGroup = (t: string) => {
    const g = document.createElement('div');
    g.className = 'group-title';
    g.textContent = t;
    sliderBox.appendChild(g);
  };
  const addSlider = (
    label: string,
    help: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    set: (v: number) => void,
    format?: (v: number) => string,
  ) => {
    const s = createSlider({
      label,
      help,
      min,
      max,
      step,
      value: get(),
      format,
      onInput: (v) => {
        set(v);
        objectivesChanged();
      },
    });
    sliders.push({ set: s.set, get });
    sliderBox.appendChild(s.el);
  };
  addGroup('Score');
  addSlider('Poids de la distance', 'Points par mètre parcouru vers l’avant (à l’horizontale). En arrière, la distance est négative.', 0, 3, 0.1, () => settings.objectives.speed, (v) => (settings.objectives.speed = v), (v) => fmt(v, 1));
  addSlider('Poids de l’énergie', 'Points retirés pour 100 J de travail des moteurs. Un essai typique dépense quelques milliers de joules.', 0, 1, 0.01, () => settings.objectives.energy, (v) => (settings.objectives.energy = v), (v) => fmt(v, 2));
  addSlider('Pénalité de chute', 'Points retirés si le torse touche le sol ou bascule (l’essai s’arrête alors).', 0, 30, 1, () => settings.objectives.fall, (v) => (settings.objectives.fall = v), (v) => fmt(v, 0));
  addSlider('Poids de l’inclinaison', 'Points retirés par radian d’inclinaison moyenne du torse.', 0, 10, 0.5, () => settings.objectives.upright, (v) => (settings.objectives.upright = v), (v) => fmt(v, 1));
  addGroup('Stratégie d’évolution');
  addSlider('Taille de la population', 'Nombre de variantes essayées par génération (nombre pair : chaque bruit est essayé avec + et −). Plus grand : estimation plus fiable de la bonne direction, mais chaque génération est plus longue.', 8, 96, 2, () => settings.es.popSize, (v) => (settings.es.popSize = v), (v) => String(v));
  addSlider('Bruit σ (curiosité)', 'Écart-type du bruit ajouté aux poids pour créer les variantes.', 0.01, 0.3, 0.01, () => settings.es.sigma, (v) => (settings.es.sigma = v), (v) => fmt(v, 2));
  addSlider('Taux d’apprentissage', 'Taille du pas de mise à jour des poids (optimiseur Adam). Trop grand : le cerveau oscille ; trop petit : progrès très lents.', 0.002, 0.1, 0.002, () => settings.es.lr, (v) => (settings.es.lr = v), (v) => fmt(v, 3));
  const wInfo = document.createElement('p');
  wInfo.className = 'help';
  wInfo.textContent = hooks.workerInfo;
  sliderBox.appendChild(wInfo);

  function syncSliders() {
    for (const s of sliders) s.set(s.get());
  }


  refreshKnobs();
  return { refreshInterventions };
}
