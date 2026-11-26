# Bac à sable du reinforcement learning

Application web statique et pédagogique, en français, qui montre **en direct** comment des agents apprennent par
renforcement (essais et erreurs). Tout tourne dans le navigateur : pas de backend, pas de service payant.

Le but est pédagogique : on agit d'abord avec des réglages compréhensibles par tous (curiosité, prudence, genou
bloqué, sol glissant, priorité vitesse ou énergie). Les paramètres techniques restent accessibles dans une section
« Paramètres experts » de chaque problème.

## Les problèmes

| # | Problème | Idée illustrée | Algorithmes |
| --- | --- | --- | --- |
| 1 | Machines à sous | Explorer ou exploiter ; regret ; monde qui change | Glouton, ε-greedy, UCB, Thompson |
| 2 | Labyrinthe 8×8 éditable | Valeurs apprises, personnalité de l'agent, falaise (Q-learning contre SARSA) | Q-learning, SARSA |
| 3 | Pendule inversé | États continus : un réseau de neurones remplace le tableau ; robustesse au vent | Stratégie d'évolution, REINFORCE |
| 4 | Voiture dans la vallée | Récompense rare, reculer pour prendre de l'élan, pièges de la récompense mal conçue | Q-learning à tuiles |
| 5 | Robot marcheur 2D | Apprendre à marcher, puis s'adapter à une blessure (genou bloqué, jambe affaiblie…) | Neuroévolution (planck.js) |
| 6 | Robot 3D (expérimental) | Même idée en 3D, quatre pattes | Neuroévolution (Rapier + Three.js) |

Chaque problème propose des scénarios qui racontent une histoire (« ce qu'il faut observer »), un graphique de
progression et un bloc « Comment ça marche ? ». Les robots arrivent avec un cerveau pré-entraîné pour marcher
tout de suite ; on peut ensuite les blesser, les réentraîner en direct (Web Worker) ou repartir de zéro.

## Développement

Prérequis : Node.js 20 ou plus.

```bash
npm install
```

```bash
npm run dev       # serveur de développement sur http://localhost:5173
```

```bash
npm test          # tests de l'algorithme (Vitest)
```

```bash
npm run build     # vérification TypeScript + build statique dans dist/
```

```bash
npm run preview   # sert le contenu de dist/ en local
```

### Organisation du code

| Chemin | Rôle |
| --- | --- |
| `src/main.ts` | Shell : menu, routeur (`#/<problème>`), page d'accueil, mode intégré. |
| `src/problems/index.ts` | Registre des problèmes (titres, textes des cartes, chargement paresseux). |
| `src/problems/<id>/` | Un dossier par problème : `index.ts` exporte `mount(root)` qui renvoie une fonction de nettoyage ; environnement et agent sans DOM dans des fichiers séparés, testés et réutilisés par les workers. |
| `src/shared/` | Briques communes : réseau de neurones (`nn.ts`), stratégie d'évolution, RNG déterministe, graphique, curseurs, thème. |
| `scripts/<id>/` | Scripts hors ligne (pré-entraînement des robots, bancs d'essai), lancés avec `npx --yes tsx`. |
| `tests/` | Tests Vitest des algorithmes et environnements. |

Pour ajouter un problème : créer `src/problems/<id>/index.ts` avec `export function mount(root: HTMLElement): () => void`,
puis l'ajouter au registre `src/problems/index.ts`.

### Pré-entraîner les robots

Les cerveaux pré-entraînés sont dans `src/problems/walker/pretrained/` et `src/problems/quadruped3d/pretrained/`.
La simulation est exactement le même code (`env.ts`) dans le navigateur et dans les scripts :

```bash
npx --yes tsx scripts/walker/train.ts
```

```bash
npx --yes tsx scripts/quadruped3d/train.ts
```

## Déploiement

Le build produit un site 100 % statique dans `dist/`, avec des chemins relatifs (`base: './'`) : il fonctionne à la
racine d'un domaine comme dans un sous-dossier.

### Option 1 — GitHub Pages (automatique, déjà configuré)

Le workflow `.github/workflows/deploy.yml` lance les tests, construit le site et le publie à chaque push sur `main`.

Une seule action manuelle, à faire une fois :

1. Sur GitHub, ouvrez **Settings → Pages**.
2. Dans **Build and deployment → Source**, choisissez **GitHub Actions**.
3. Relancez le workflow (onglet **Actions → Tests et déploiement GitHub Pages → Run workflow**) ou poussez un commit.

Le site est alors disponible sur `https://<utilisateur>.github.io/rl-playground/`.

### Option 2 — Cloudflare Pages (gratuit)

1. Sur le tableau de bord Cloudflare : **Workers & Pages → Create → Pages → Connect to Git**, puis choisissez ce dépôt.
2. Réglages de build :
   - Framework preset : **Vite** (ou None)
   - Build command : `npm run build`
   - Build output directory : `dist`
   - Variable d'environnement (si besoin) : `NODE_VERSION` = `22`
3. **Save and Deploy**. Chaque push sur `main` redéploie automatiquement.

Alternative en ligne de commande (sans lier le dépôt) :

```bash
npm run build && npx wrangler pages deploy dist --project-name rl-playground
```

## Intégration en iframe

```html
<iframe
  src="https://<utilisateur>.github.io/rl-playground/?embed=1"
  width="100%" height="1400" style="border:0" title="Bac à sable du reinforcement learning"
  loading="lazy"></iframe>
```

Le paramètre `?embed=1` masque le titre du site et le pied de page, mais garde le menu des problèmes et les
explications. Ajoutez `#/<problème>` pour ouvrir directement un problème (ex. `?embed=1#/walker`).

En mode intégré, l'application annonce sa hauteur au site parent par `postMessage`
(`{ type: 'rl-playground:height', height }`), ce qui permet d'ajuster l'iframe sans barre de défilement interne :

```js
window.addEventListener('message', (e) => {
  if (e.origin === 'https://cocobomp.github.io' && e.data?.type === 'rl-playground:height') {
    iframe.style.height = `${e.data.height}px`;
  }
});
```

## Licence

MIT — voir [LICENSE](LICENSE).
