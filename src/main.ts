import './style.css';
import { PROBLEMS } from './problems/index';
import { h } from './shared/ui';

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
  for (const p of PROBLEMS) {
    const a = h<HTMLAnchorElement>(`<a></a>`);
    a.href = `#/${p.id}`;
    a.dataset.id = p.id;
    a.textContent = p.title;
    nav.append(a);
  }
}

function renderHome(root: HTMLElement) {
  const page = h(`
    <div class="home">
      <p class="lead">
        Le <strong>reinforcement learning</strong> (apprentissage par renforcement), c’est apprendre par essais et erreurs :
        un agent agit, reçoit une récompense ou une punition, et ajuste son comportement pour gagner davantage.
        Chaque problème ci-dessous illustre une idée différente, du plus simple au plus ambitieux.
      </p>
      <div class="cards"></div>
    </div>`);
  const cards = page.querySelector('.cards')!;
  PROBLEMS.forEach((p, i) => {
    const card = h<HTMLAnchorElement>(`
      <a class="card">
        <span class="card-top"><span class="card-num"></span><span class="badge"></span></span>
        <strong class="card-title"></strong>
        <span class="card-tagline"></span>
        <span class="card-concept"></span>
        <span class="card-algo"></span>
      </a>`);
    card.href = `#/${p.id}`;
    card.querySelector('.card-num')!.textContent = String(i + 1);
    const badge = card.querySelector('.badge')!;
    badge.textContent = p.level;
    badge.classList.add(`lvl-${p.level.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}`);
    card.querySelector('.card-title')!.textContent = p.title;
    card.querySelector('.card-tagline')!.textContent = p.tagline;
    card.querySelector('.card-concept')!.textContent = `Idée : ${p.concept}`;
    card.querySelector('.card-algo')!.textContent = `Algorithmes : ${p.algorithms}`;
    cards.append(card);
  });
  root.append(page);
}

async function route() {
  const token = ++navToken;
  const id = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  cleanup?.();
  cleanup = null;
  app.replaceChildren();
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', (a as HTMLElement).dataset.id === id));
  // Sur mobile le menu défile horizontalement : on amène l'onglet actif en vue.
  nav.querySelector('a.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });

  const problem = PROBLEMS.find((p) => p.id === id);
  if (!problem) {
    document.title = 'Bac à sable RL';
    renderHome(app);
    return;
  }
  document.title = `${problem.title} · Bac à sable RL`;
  const head = h(`<div class="problem-head"><h2></h2><p class="lead"></p></div>`);
  head.querySelector('h2')!.textContent = problem.title;
  head.querySelector('.lead')!.textContent = `${problem.tagline} ${problem.concept}`;
  app.append(head);
  const loading = h(`<p class="loading">Chargement…</p>`);
  app.append(loading);
  try {
    const mod = await problem.load();
    if (token !== navToken) return; // l'utilisateur a changé de page entre-temps
    loading.remove();
    const root = h(`<div class="problem-root"></div>`);
    app.append(root);
    cleanup = mod.mount(root);
  } catch (err) {
    if (token !== navToken) return;
    loading.textContent = 'Impossible de charger ce problème. Rechargez la page.';
    console.error(err);
  }
}

buildNav();
window.addEventListener('hashchange', route);
route();
