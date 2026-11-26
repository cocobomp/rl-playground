// Pages rendues par le shell : accueil (parcours), bloc « Et ensuite ? », glossaire.
import type { ProblemInfo } from '../shared/types';
import { h } from '../shared/ui';
import { GLOSSARY } from './glossary';
import { GLOSSARY_ID, nextInPath } from './route';

function levelClass(level: string): string {
  return `lvl-${level.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}`;
}

/** Accueil : introduction en quatre lignes puis le parcours numéroté. */
export function renderHome(root: HTMLElement, problems: readonly ProblemInfo[]): void {
  const first = problems[0];
  const page = h(`
    <div class="home">
      <section class="intro" aria-labelledby="intro-title">
        <h2 id="intro-title">Le reinforcement learning en 30 secondes</h2>
        <p>
          Un <strong>agent</strong> (un petit programme) essaie des <strong>actions</strong> dans un monde qu’il ne connaît pas.
          Après chaque action, il reçoit une <strong>récompense</strong> : un nombre, positif si c’est bien, négatif sinon.
          Personne ne lui montre la solution : par <strong>essais et erreurs</strong>, il ajuste ses choix pour gagner
          le plus de récompenses possible. C’est l’apprentissage par renforcement.
        </p>
        <p class="intro-start">
          <a class="btn-primary start-link"></a>
          <span class="intro-hint">Jamais fait de RL ? Commencez par le n°&nbsp;1, puis suivez le parcours.
            Un mot vous échappe&nbsp;? <a href="#/${GLOSSARY_ID}">Le glossaire</a>.</span>
        </p>
      </section>
      <h2 class="path-title">Le parcours : une idée par étape</h2>
      <ol class="cards path"></ol>
    </div>`);
  if (first) {
    const start = page.querySelector<HTMLAnchorElement>('.start-link')!;
    start.href = `#/${first.id}`;
    start.textContent = `Commencer : ${first.title}${first.duration ? ` (${first.duration})` : ''} →`;
  } else {
    page.querySelector('.intro-start')!.remove();
  }
  const cards = page.querySelector('.cards')!;
  problems.forEach((p, i) => {
    const li = h(`
      <li class="path-step">
        <a class="card">
          <span class="card-top"><span class="card-num"></span><span class="card-meta"><span class="card-time"></span><span class="badge"></span></span></span>
          <strong class="card-title"></strong>
          <span class="card-idea"><span class="card-idea-label">L’idée</span> <span class="card-idea-text"></span></span>
          <span class="card-tagline"></span>
          <span class="card-algo"></span>
        </a>
      </li>`);
    const card = li.querySelector<HTMLAnchorElement>('.card')!;
    card.href = `#/${p.id}`;
    if (i === 0) li.classList.add('path-first');
    card.querySelector('.card-num')!.textContent = `Étape ${i + 1}`;
    const time = card.querySelector('.card-time')!;
    if (p.duration) time.textContent = `≈ ${p.duration}`;
    else time.remove();
    const badge = card.querySelector('.badge')!;
    badge.textContent = p.level;
    badge.classList.add(levelClass(p.level));
    card.querySelector('.card-title')!.textContent = p.title;
    card.querySelector('.card-idea-text')!.textContent = p.concept;
    card.querySelector('.card-tagline')!.textContent = p.tagline;
    card.querySelector('.card-algo')!.textContent = `Algorithmes : ${p.algorithms}`;
    cards.append(li);
  });
  root.append(page);
}

/** Bloc de fin de page d'un problème : ce qu'on vient d'apprendre, et la suite. */
export function renderNext(problems: readonly ProblemInfo[], current: ProblemInfo): HTMLElement {
  const next = nextInPath(problems, current.id);
  const idx = problems.findIndex((p) => p.id === current.id);
  const block = h(`
    <section class="next-block" aria-labelledby="next-title">
      <h2 id="next-title">Et ensuite ?</h2>
      <p class="next-learned"><span class="next-label">Ce que vous venez de voir</span> <span class="next-learned-text"></span></p>
      <div class="next-actions"></div>
      <p class="next-links"></p>
    </section>`);
  block.querySelector('.next-learned-text')!.textContent = current.concept;
  const actions = block.querySelector('.next-actions')!;
  if (next) {
    const a = h<HTMLAnchorElement>(`
      <a class="next-card">
        <span class="next-kicker"></span>
        <strong class="next-title"></strong>
        <span class="next-idea"></span>
      </a>`);
    a.href = `#/${next.id}`;
    a.querySelector('.next-kicker')!.textContent =
      `Étape suivante (${idx + 2}/${problems.length})${next.duration ? ` · ≈ ${next.duration}` : ''}`;
    a.querySelector('.next-title')!.textContent = `${next.title} →`;
    a.querySelector('.next-idea')!.textContent = next.concept;
    actions.append(a);
  } else {
    const done = h(`
      <div class="next-done">
        <p>Bravo, vous avez fait tout le parcours ! Chaque agent a appris seul, par essais et erreurs, à partir d’un simple nombre : la récompense.</p>
        <a class="btn-primary" href="#/">Retour à l’accueil</a>
      </div>`);
    actions.append(done);
  }
  // Sur la dernière étape, « Retour à l’accueil » suffit : pas de doublon.
  block.querySelector('.next-links')!.innerHTML = next
    ? `<a href="#/">← Revenir au parcours</a> <span aria-hidden="true">·</span> <a href="#/${GLOSSARY_ID}">Glossaire</a>`
    : `<a href="#/${GLOSSARY_ID}">Revoir les mots clés dans le glossaire</a>`;
  return block;
}

/** Page glossaire (#/glossaire, #/glossaire/<terme> pour arriver sur un terme). */
export function renderGlossary(root: HTMLElement, problems: readonly ProblemInfo[], focus?: string): void {
  const byId = new Map(problems.map((p) => [p.id, p]));
  const page = h(`
    <div class="glossary">
      <div class="problem-head">
        <h2>Glossaire</h2>
        <p class="lead">Les mots du reinforcement learning, en une phrase chacun. Les liens mènent au problème où l’on voit la notion à l’œuvre.</p>
      </div>
      <dl class="glossary-list"></dl>
      <p class="next-links"><a href="#/">← Revenir au parcours</a></p>
    </div>`);
  const list = page.querySelector('.glossary-list')!;
  for (const t of GLOSSARY) {
    const item = h(`
      <div class="glossary-item">
        <dt><a class="glossary-anchor"></a></dt>
        <dd><span class="glossary-def"></span></dd>
      </div>`);
    item.id = `terme-${t.id}`;
    const anchor = item.querySelector<HTMLAnchorElement>('.glossary-anchor')!;
    anchor.href = `#/${GLOSSARY_ID}/${t.id}`;
    anchor.textContent = t.term;
    item.querySelector('.glossary-def')!.textContent = t.definition;
    const seen = (t.seeIn ?? []).map((id) => byId.get(id)).filter((p): p is ProblemInfo => !!p);
    if (seen.length) {
      const see = h(`<span class="glossary-see">À voir dans : </span>`);
      seen.forEach((p, i) => {
        if (i) see.append(', ');
        const a = h<HTMLAnchorElement>(`<a></a>`);
        a.href = `#/${p.id}`;
        a.textContent = p.title;
        see.append(a);
      });
      item.querySelector('dd')!.append(see);
    }
    if (focus === t.id) item.classList.add('is-focus');
    list.append(item);
  }
  root.append(page);
  if (focus) page.querySelector('.is-focus')?.scrollIntoView({ block: 'center' });
}
