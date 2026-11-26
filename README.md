# Bac à sable du reinforcement learning

Application web statique et pédagogique, en français, qui montre **en direct** comment un agent apprend par
renforcement (Q-learning ou SARSA) dans une grille 8×8. Tout tourne dans le navigateur : pas de backend, pas de
service payant, aucune dépendance à l'exécution.

## Fonctionnalités

- **Grille 8×8 éditable** : cliquez (ou glissez) pour placer murs, pièges, départ et arrivée.
- **Agent Q-learning / SARSA** qui apprend pas à pas, en temps réel.
- **Curseurs commentés** : taux d'apprentissage α, facteur d'actualisation γ, exploration ε et sa décroissance,
  glissance du sol (monde aléatoire), récompenses (arrivée, piège, coût par pas), vitesse, nombre d'épisodes.
- **Visualisation** : couleur des cases selon la valeur apprise V(s) = max Q(s, a), flèche de la meilleure action,
  valeurs numériques (optionnel), trajet animé de l'agent, meilleur chemin appris en pointillés.
- **Graphique** de la récompense par épisode avec moyenne glissante (canvas, sans librairie).
- **Boutons** Démarrer / Pause, Pas à pas, Réinitialiser.
- **3 préréglages** : « Explore trop », « Apprend trop vite », « Équilibré », chacun avec une explication de ce
  qu'on doit observer.
- **Responsive**, thème clair/sombre automatique, **intégrable en iframe**.

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

| Fichier | Rôle |
| --- | --- |
| `src/rl.ts` | Environnement `GridWorld` et agent `Trainer` (Q-learning / SARSA, ε-greedy). Sans DOM, testé. |
| `src/config.ts` | Carte par défaut, préréglages, définition des curseurs et de la vitesse. |
| `src/chart.ts` | Graphique de récompense en canvas. |
| `src/main.ts` | Interface : édition de la grille, rendu, boucle d'animation. |
| `tests/rl.test.ts` | Tests : déplacements, formules de mise à jour, décroissance de ε, convergence. |

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

Le paramètre `?embed=1` masque l'en-tête, le pied de page et le bloc d'explication pour une intégration compacte.

## Licence

MIT — voir [LICENSE](LICENSE).
