import './style.css';
import { PROBLEMS } from './problems/index';
import { h } from './shared/ui';
import { renderGlossary, renderHome, renderNext } from './shell/pages';
import { mountProfileBar, renderApplications, renderProfilePanel } from './shell/profile-ui';
import { getProfile, onProfileChange } from './shell/profiles';
import { APPLICATIONS_ID, GLOSSARY_ID, navId, parseRoute } from './shell/route';

// Mode intégré (iframe) : ?embed=1 masque le titre du site et le pied de page,
// garde le menu des problèmes et les explications, et annonce la hauteur de la
// page au site parent pour qu'il ajuste l'iframe (message « rl-playground:height »).
const embed = new URLSearchParams(location.search).has('embed');
if (embed) {
  document.documentElement.classList.add('embed');
  if (window.parent !== window) {
    let last = 0;
    const announce = () => {
      const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
      if (Math.abs(height - last) < 2) return;
      last = height;
      window.parent.postMessage({ type: 'rl-playground:height', height }, '*');
    };
    new ResizeObserver(announce).observe(document.body);
    window.addEventListener('load', announce);
  }
}

const app = document.getElementById('app')!;
const nav = document.getElementById('nav')!;
let cleanup: (() => void) | null = null;
let navToken = 0;

function buildNav() {
  nav.append(h(`<a href="#/" data-id="">Accueil</a>`));
  PROBLEMS.forEach((p, i) => {
    const a = h<HTMLAnchorElement>(`<a></a>`);
    a.href = `#/${p.id}`;
    a.dataset.id = p.id;
    a.textContent = `${i + 1}. ${p.title}`;
    nav.append(a);
  });
  nav.append(h(`<a href="#/${APPLICATIONS_ID}" data-id="${APPLICATIONS_ID}" class="nav-glossary">Dans la vraie vie</a>`));
  nav.append(h(`<a href="#/${GLOSSARY_ID}" data-id="${GLOSSARY_ID}">Glossaire</a>`));
}

let firstRoute = true;

async function route() {
  const token = ++navToken;
  const r = parseRoute(location.hash, PROBLEMS.map((p) => p.id));
  const id = navId(r);
  cleanup?.();
  cleanup = null;
  app.replaceChildren();
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', (a as HTMLElement).dataset.id === id));
  // Sur mobile le menu défile horizontalement : on amène l'onglet actif en vue.
  // (Pas de scrollIntoView : dans une iframe, il ferait aussi défiler la page hôte.)
  const active = nav.querySelector<HTMLElement>('a.active');
  if (active) nav.scrollLeft = active.offsetLeft - nav.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
  // Changer de page depuis le bas (bloc « Et ensuite ? ») : on repart du haut.
  if (!firstRoute && !(r.kind === 'glossary' && r.term)) {
    window.scrollTo(0, 0);
    // Dans une iframe agrandie à sa hauteur, c'est la page hôte qui défile :
    // on lui demande de ramener le haut de l'application en vue.
    if (embed && window.parent !== window) window.parent.postMessage({ type: 'rl-playground:navigate' }, '*');
  }
  firstRoute = false;

  if (r.kind === 'glossary') {
    document.title = 'Glossaire · Bac à sable RL';
    renderGlossary(app, PROBLEMS, r.term);
    return;
  }
  if (r.kind === 'applications') {
    document.title = 'Dans la vraie vie · Bac à sable RL';
    cleanup = renderApplications(app, PROBLEMS);
    return;
  }
  const problem = r.kind === 'problem' ? PROBLEMS.find((p) => p.id === r.id) : undefined;
  if (!problem) {
    document.title = 'Bac à sable RL';
    renderHome(app, PROBLEMS);
    return;
  }
  document.title = `${problem.title} · Bac à sable RL`;
  const head = h(`<div class="problem-head"><h2></h2><p class="lead"></p></div>`);
  head.querySelector('h2')!.textContent = problem.title;
  head.querySelector('.lead')!.textContent = `${problem.tagline} ${problem.concept}`;
  app.append(head);
  const panel = renderProfilePanel(problem, PROBLEMS);
  app.append(panel.el);
  cleanup = panel.dispose;
  const loading = h(`<p class="loading">Chargement…</p>`);
  app.append(loading);
  try {
    const mod = await problem.load();
    if (token !== navToken) return; // l'utilisateur a changé de page entre-temps
    loading.remove();
    const root = h(`<div class="problem-root"></div>`);
    app.append(root);
    const unmount = mod.mount(root);
    // Profil Développeur : les « Paramètres experts » sont ouverts d'office.
    let wasDev = false;
    const openExpert = () => {
      const dev = getProfile() === 'dev';
      // On n'y touche qu'en entrant dans le profil Développeur ou en le quittant.
      if (dev || wasDev) root.querySelectorAll<HTMLDetailsElement>('details.expert').forEach((d) => (d.open = dev));
      wasDev = dev;
    };
    openExpert();
    const offProfile = onProfileChange(openExpert);
    cleanup = () => {
      offProfile();
      panel.dispose();
      unmount();
    };
    // Rendu par le shell, après le problème : aucun code de problème à modifier.
    app.append(renderNext(PROBLEMS, problem));
  } catch (err) {
    if (token !== navToken) return;
    loading.textContent = 'Impossible de charger ce problème. Rechargez la page.';
    console.error(err);
  }
}

buildNav();
mountProfileBar(document.getElementById('profile-bar')!);
window.addEventListener('hashchange', route);
route();
