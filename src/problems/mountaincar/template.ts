// Gabarit HTML de « Voiture dans la vallée ». Identifiants préfixés par « mountaincar- ».
export const TEMPLATE = `
<section class="mountaincar-start" aria-label="Commencez ici">
  <p class="mountaincar-start-title">Commencez ici</p>
  <ol>
    <li>Cliquez sur <strong>Démarrer</strong>. La voiture doit atteindre le drapeau à droite, mais son moteur est trop faible pour
      monter d’un coup. Son premier essai (un « épisode ») dure souvent 1000 pas, la limite, sans jamais voir le drapeau.</li>
    <li>Passez la vitesse sur <strong>Turbo</strong> et regardez la courbe du bas chuter : après une cinquantaine d’essais,
      120 à 150 pas suffisent. Cliquez alors sur <strong>Tester</strong> : la voiture recule d’abord vers la gauche pour prendre de l’élan.</li>
    <li>Puis essayez le scénario <strong>Récompense mal conçue</strong> : un « coup de pouce » maladroit lui fait oublier le drapeau.</li>
  </ol>
  <p class="mountaincar-start-key">L’idée clé : la seule <strong>récompense</strong> (le signal « bien / pas bien » que reçoit l’agent) est −1 à
    chaque pas, jusqu’au drapeau. Aucun indice en chemin : c’est une <strong>récompense rare</strong>. L’agent doit découvrir seul une stratégie
    <strong>contre-intuitive</strong> : reculer pour avancer. Et si l’on « aide » avec une récompense mal pensée, il optimise ce qu’on lui a
    demandé, pas ce qu’on voulait.</p>
</section>
<div class="layout mountaincar-root">
  <div class="col">
    <section class="panel" aria-label="La vallée">
      <canvas id="mountaincar-scene" class="stage-canvas mountaincar-scene" aria-label="La voiture dans la vallée, le drapeau à droite"></canvas>

      <div class="controls">
        <button id="mountaincar-run" class="primary">Démarrer</button>
        <button id="mountaincar-step">Pas à pas</button>
        <button id="mountaincar-test" title="Rejoue la stratégie actuelle sans exploration ni apprentissage">Tester</button>
        <button id="mountaincar-reset">Réinitialiser</button>
      </div>
      <div class="map-actions mountaincar-speed-row">
        <span class="mountaincar-speed-label" id="mountaincar-speed-label">Vitesse :</span>
        <div class="segmented mountaincar-seg" id="mountaincar-speed" role="group" aria-labelledby="mountaincar-speed-label"></div>
      </div>
      <p class="help" id="mountaincar-speed-help"></p>

      <dl class="stats">
        <div><dt>Essais (épisodes)</dt><dd id="mountaincar-st-episode">0</dd></div>
        <div><dt>Pas (essai en cours)</dt><dd id="mountaincar-st-step">0</dd></div>
        <div><dt>Pas pour arriver (moy. 20 essais)</dt><dd id="mountaincar-st-avg">–</dd></div>
        <div><dt>Score perçu (dernier essai)</dt><dd id="mountaincar-st-ret">–</dd></div>
      </dl>
      <p class="help mountaincar-stats-help">Score perçu : total des récompenses reçues par l’agent pendant l’essai (−1 par pas, plus l’éventuel « coup de pouce »).</p>
      <p id="mountaincar-status" class="status" role="status" aria-live="polite"></p>
    </section>

    <section class="panel" aria-label="Carte position × vitesse">
      <div class="mountaincar-phase-head">
        <h2>Ce que l’agent a appris : la carte position × vitesse</h2>
        <div class="segmented mountaincar-seg" id="mountaincar-phase-mode" role="group" aria-label="Carte affichée">
          <button type="button" data-mode="value" class="active" aria-pressed="true">Coût restant</button>
          <button type="button" data-mode="policy" aria-pressed="false">Action choisie</button>
        </div>
      </div>
      <canvas id="mountaincar-phase" class="mountaincar-phase" aria-label="Carte position × vitesse : valeurs apprises et trajectoire de l’essai"></canvas>
      <div class="legend mountaincar-legend" id="mountaincar-legend"></div>
      <p class="help">
        Chaque point est une situation possible (un « état », que les physiciens appellent l’espace des phases) : la <strong>position</strong> (horizontalement) et la <strong>vitesse</strong> (verticalement,
        vers le haut = vers la droite). Le trait coloré est le trajet de l’essai en cours : une <strong>spirale</strong> qui s’élargit,
        car chaque aller-retour gagne de l’élan, jusqu’à toucher le bord droit (le drapeau). Cliquez sur la carte pour tester
        la stratégie apprise à partir de cet état.
      </p>
    </section>

    <section class="panel" aria-label="Graphique">
      <h2>Pas nécessaires pour atteindre le drapeau</h2>
      <canvas id="mountaincar-chart" class="mountaincar-chart" aria-label="Nombre de pas par essai"></canvas>
      <p class="help">
        Points : durée de chaque essai (plus bas = mieux ; un essai interrompu à la limite compte pour la limite).
        Ligne : moyenne des 20 derniers essais. Cette courbe mesure le vrai but, quel que soit le « coup de pouce ».
      </p>
    </section>
  </div>

  <div class="col">
    <section class="panel" aria-label="Le monde">
      <h2>Le monde</h2>
      <div class="sliders" id="mountaincar-world"></div>
      <p class="mountaincar-mapping" id="mountaincar-engine-info"></p>
    </section>

    <section class="panel" aria-label="Caractère et objectifs de l’agent">
      <h2>Caractère et objectifs de l’agent</h2>
      <p class="help mountaincar-intro">
        Chaque réglage se traduit en paramètres techniques, affichés après la flèche. Les changements s’appliquent tout de suite ;
        « Réinitialiser » fait tout réapprendre de zéro.
      </p>
      <div id="mountaincar-traits" class="mountaincar-traits"></div>
    </section>

    <section class="panel" aria-label="Scénarios">
      <h2>Scénarios</h2>
      <p class="help">Chaque scénario remet l’agent à zéro, change un réglage et raconte quoi observer.</p>
      <div class="presets" id="mountaincar-scenarios"></div>
      <p id="mountaincar-scenario-info" class="preset-info">Choisissez un scénario, puis cliquez sur « Démarrer ».</p>

      <details class="expert" id="mountaincar-expert">
        <summary>Paramètres experts</summary>
        <div class="group-title">Algorithme</div>
        <div class="algo">
          <label><input type="radio" name="mountaincar-algo" value="sarsa" checked /> Sarsa(λ)</label>
          <label><input type="radio" name="mountaincar-algo" value="qlearning" /> Q(λ) (Watkins)</label>
        </div>
        <p class="help" id="mountaincar-algo-help"></p>
        <div id="mountaincar-sliders" class="sliders"></div>
      </details>
    </section>

    <section class="panel explain-panel">
      <h2>Comment ça marche ?</h2>
      <p>
        La voiture connaît sa <strong>position</strong> x et sa <strong>vitesse</strong> v. À chaque pas, elle choisit : pousser à
        gauche, ne rien faire ou pousser à droite. Le moteur est faible, la pente forte :
      </p>
      <p class="formula">v ← v + 0,001 · action<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;− 0,0025 · cos(3x)<br />x ← x + v</p>
      <p>
        Chaque pas coûte <strong>−1</strong> ; atteindre le drapeau (x ≥ 0,5) termine l’épisode. Aucun indice en chemin :
        c’est une <strong>récompense rare</strong>. Et la bonne stratégie est <strong>contre-intuitive</strong> : pour aller à
        droite, il faut d’abord partir à gauche.
      </p>
      <h3>Des tuiles pour un monde continu</h3>
      <p>
        Il y a une infinité d’états (x et v sont des nombres réels) : impossible de tenir un tableau case par case comme dans le
        labyrinthe. On recouvre donc le plan (x, v) de plusieurs grilles de tuiles (par défaut 8 grilles de 8 × 8), chacune légèrement décalée. Un état active une
        tuile par grille (n tuiles actives pour n grilles), et l’estimation est la somme de leurs poids :
      </p>
      <p class="formula">Q(s, a) = w<sub>a</sub>[tuile₁(s)] + …<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ w<sub>a</sub>[tuile<sub>n</sub>(s)]</p>
      <p>
        Deux états proches partagent la plupart de leurs tuiles : ce qui est appris quelque part se <strong>généralise</strong> aux
        alentours. C’est une <strong>approximation de fonction</strong>, la même idée que les réseaux de neurones des problèmes
        suivants, en plus simple.
      </p>
      <h3>Apprendre : Sarsa(λ)</h3>
      <p>Après chaque pas, l’agent compare ce qu’il prévoyait à ce qu’il vient de vivre :</p>
      <p class="formula">δ = r + γ · Q(s′, a′) − Q(s, a)<br />w ← w + (α / n) · δ · e</p>
      <p>
        δ est l’erreur de prédiction ; r la récompense du pas (−1) ; γ = 0,99 le poids du futur (un pas lointain compte un peu
        moins qu’un pas proche) ; α le pas d’apprentissage ; n le nombre de grilles (chaque poids actif reçoit sa part de la correction).
        Q(s, a) est la <strong>valeur</strong> estimée : ce que l’agent pense encore récolter en faisant a dans l’état s.
      </p>
      <p>
        Les <strong>traces d’éligibilité</strong> e retiennent les tuiles visitées récemment (en s’effaçant d’un facteur γλ à chaque
        pas) : quand la voiture atteint enfin le drapeau, le mérite remonte d’un coup vers les dizaines de décisions précédentes,
        y compris le recul qui a permis de prendre de l’élan.
      </p>
      <h3>Pourquoi l’optimisme explore</h3>
      <ul>
        <li>Toutes les estimations partent de Q₀ = 0, alors que la vraie valeur de chaque état est négative (−1 par pas restant,
          actualisé par γ) : c’est <strong>trop optimiste</strong>.</li>
        <li>Chaque fois qu’une action est essayée, son estimation baisse. Les actions et les zones jamais essayées paraissent
          donc meilleures : l’agent va les voir, même sans aucun hasard (ε = 0). Sur la carte « Coût restant », elles restent
          vertes tant qu’il n’y est pas passé.</li>
        <li>À l’inverse, avec Q₀ = −150 (en dessous de −1/(1−γ) = −100 pour γ = 0,99), chaque essai <em>remonte</em>
          l’estimation de ce qui a été fait : le déjà-vu paraît meilleur que l’inconnu, et le hasard d’ε ne suffit pas à
          trouver le drapeau en 1000 pas. C’est la curiosité « Méfiante ».</li>
      </ul>
      <h3>Le piège du coup de pouce</h3>
      <ul>
        <li>Un bonus <strong>bien conçu</strong> (« Énergie ») est de la forme γ·Φ(s′) − Φ(s) : sur un trajet, la somme des bonus
          ne dépend (à l’actualisation près) que du point de départ : la meilleure stratégie reste la même (Ng, Harada et Russell, 1999), mais
          encourage tout de suite à gagner de l’énergie.</li>
        <li>Un bonus <strong>mal conçu</strong> (« Vitesse ») paie à chaque pas : dès qu’il dépasse le coût de −1, ne jamais
          arriver devient plus rentable. L’agent fait exactement ce qu’on lui a demandé, pas ce qu’on voulait.</li>
      </ul>
    </section>
  </div>
</div>
`;
