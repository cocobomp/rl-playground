// Interface des profils : sélecteur, encadré « Pour vous » d'un problème, page « Dans la vraie vie ».
import type { ProblemInfo } from '../shared/types';
import { h } from '../shared/ui';
import { APPLICATIONS, PROBLEM_CONTENT } from './content/index';
import { PROFILES, getProfile, onProfileChange, setProfile, type ProfileId } from './profiles';

const label = (id: ProfileId) => PROFILES.find((p) => p.id === id)!.label;

/** Barre « Je suis… » affichée sous le menu, sur toutes les pages. */
export function mountProfileBar(bar: HTMLElement): void {
  bar.replaceChildren();
  const wrap = h(`<div class="profile-bar-inner"><span class="profile-bar-label" id="profile-bar-label">Expliquez-moi comme à un…</span><div class="segmented profile-seg" role="group" aria-labelledby="profile-bar-label"></div><span class="profile-bar-blurb" aria-live="polite"></span></div>`);
  const seg = wrap.querySelector('.profile-seg')!;
  const blurb = wrap.querySelector('.profile-bar-blurb')!;
  for (const p of PROFILES) {
    const b = h<HTMLButtonElement>(`<button type="button"></button>`);
    b.textContent = p.label;
    b.dataset.profile = p.id;
    b.addEventListener('click', () => setProfile(p.id));
    seg.append(b);
  }
  const sync = (id: ProfileId) => {
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      const on = b.dataset.profile === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    blurb.textContent = PROFILES.find((p) => p.id === id)!.blurb;
    document.documentElement.dataset.profile = id;
  };
  sync(getProfile());
  onProfileChange(sync); // vit aussi longtemps que la page
  bar.append(wrap);
}

/**
 * Encadré « Pour vous » placé au-dessus d'un problème. Se met à jour quand le profil change.
 * Renvoie l'élément et sa fonction de nettoyage.
 */
export function renderProfilePanel(problem: ProblemInfo, problems: readonly ProblemInfo[]): { el: HTMLElement; dispose: () => void } {
  const el = h(`<section class="panel profile-panel" aria-label="Explication selon votre profil"></section>`);
  const content = PROBLEM_CONTENT[problem.id];
  const draw = (id: ProfileId) => {
    el.replaceChildren();
    if (!content) return;
    const a = content.byProfile[id];
    const box = h(`
      <div class="profile-cols">
        <div>
          <p class="profile-kicker"></p>
          <p class="profile-intro"></p>
          <p class="profile-sub">À essayer ici</p>
          <ul class="profile-watch"></ul>
          <p class="profile-takeaway"><strong>À retenir : </strong><span></span></p>
        </div>
        <div class="profile-real">
          <p class="profile-sub">Dans la vraie vie</p>
          <ul class="profile-real-list"></ul>
          <a class="profile-more" href="#/applications">Voir tous les projets réels →</a>
        </div>
      </div>`);
    box.querySelector('.profile-kicker')!.textContent = `Pour vous · ${label(id)}`;
    box.querySelector('.profile-intro')!.textContent = a.intro;
    const ul = box.querySelector('.profile-watch')!;
    for (const w of a.watch) {
      const li = document.createElement('li');
      li.textContent = w;
      ul.append(li);
    }
    box.querySelector('.profile-takeaway span')!.textContent = a.takeaway;
    const real = box.querySelector('.profile-real-list')!;
    for (const r of content.realWorld) {
      const li = h(`<li><strong></strong><span></span></li>`);
      li.querySelector('strong')!.textContent = `${r.title} : `;
      li.querySelector('span')!.textContent = r.text;
      real.append(li);
    }
    el.append(box);
  };
  draw(getProfile());
  void problems;
  return { el, dispose: onProfileChange(draw) };
}

/** Page « Dans la vraie vie » : des projets réels, reliés aux problèmes du bac à sable. */
export function renderApplications(root: HTMLElement, problems: readonly ProblemInfo[]): () => void {
  const page = h(`
    <div class="apps">
      <div class="problem-head">
        <h2>Dans la vraie vie</h2>
        <p class="lead">Où le reinforcement learning sert-il vraiment ? Pour chaque projet : qui est l’agent, ce qu’il peut faire, ce qu’on récompense, et le problème du bac à sable qui montre la même idée en petit.</p>
      </div>
      <div class="apps-list"></div>
    </div>`);
  const list = page.querySelector('.apps-list')!;
  const draw = (id: ProfileId) => {
    list.replaceChildren();
    for (const app of APPLICATIONS) {
      const card = h(`
        <article class="panel app-card">
          <p class="profile-kicker"></p>
          <h3></h3>
          <p class="app-story"></p>
          <dl class="app-rl">
            <div><dt>L’agent</dt><dd data-k="agent"></dd></div>
            <div><dt>Ses actions</dt><dd data-k="actions"></dd></div>
            <div><dt>La récompense</dt><dd data-k="reward"></dd></div>
            <div><dt>Le plus dur</dt><dd data-k="limits"></dd></div>
          </dl>
          <p class="app-angle"><strong></strong><span></span></p>
          <p class="app-links">Même idée en petit : </p>
        </article>`);
      card.id = `app-${app.id}`;
      card.querySelector('.profile-kicker')!.textContent = app.sector;
      card.querySelector('h3')!.textContent = app.title;
      card.querySelector('.app-story')!.textContent = app.story;
      for (const k of ['agent', 'actions', 'reward', 'limits'] as const) card.querySelector(`[data-k="${k}"]`)!.textContent = app[k];
      card.querySelector('.app-angle strong')!.textContent = `Pour vous (${label(id)}) : `;
      card.querySelector('.app-angle span')!.textContent = app.angle[id];
      const links = card.querySelector('.app-links')!;
      app.problemIds.forEach((pid, i) => {
        const p = problems.find((x) => x.id === pid);
        if (!p) return;
        if (i > 0) links.append(', ');
        const a = h<HTMLAnchorElement>(`<a></a>`);
        a.href = `#/${p.id}`;
        a.textContent = p.title;
        links.append(a);
      });
      list.append(card);
    }
  };
  draw(getProfile());
  root.append(page);
  return onProfileChange(draw);
}
