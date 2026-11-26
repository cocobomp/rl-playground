// Gabarit HTML du pendule inversé. Tous les identifiants sont préfixés par « cartpole- ».
export const TEMPLATE = `
<section class="cartpole-start" aria-label="Commencez ici">
  <p class="cartpole-start-title">Commencez ici</p>
  <ol>
    <li>Cliquez sur <strong>Apprendre</strong>. Au début, l’agent pousse au hasard : le bâton tombe aussitôt.</li>
    <li>Regardez la <strong>courbe</strong> grimper en une quinzaine de secondes vers 500 pas (10&nbsp;s, le maximum) : à chaque
      « génération », 30 variantes de l’agent sont essayées et les meilleures montrent la voie.</li>
    <li>Puis essayez le scénario <strong>Tempête</strong> ou <strong>À vous de jouer</strong>.</li>
  </ol>
  <p class="cartpole-start-key">L’idée clé : la situation (position, angle, vitesses) est faite de nombres réels, jamais deux fois identiques.
    Impossible de tout noter dans un tableau comme dans le labyrinthe : un petit <strong>réseau de neurones</strong> transforme ce que l’agent
    « sent » en décision.</p>
</section>
<div class="layout cartpole-root">
  <div class="col">
    <section class="panel" aria-label="Pendule inversé">
      <div class="cartpole-modebar">
        <div class="segmented cartpole-mode" role="group" aria-label="Qui contrôle le chariot ?">
          <button type="button" data-mode="agent" class="active" aria-pressed="true">Regarder l’agent</button>
          <button type="button" data-mode="human" aria-pressed="false">À vous de jouer</button>
        </div>
        <div class="cartpole-speed" id="cartpole-speed-wrap">
          <span class="cartpole-speed-label" id="cartpole-speed-label">Vitesse du rejeu</span>
          <div class="segmented" role="group" aria-labelledby="cartpole-speed-label" id="cartpole-speed">
            <button type="button" data-speed="0.5">×0,5</button>
            <button type="button" data-speed="1" class="active">×1</button>
            <button type="button" data-speed="3">×3</button>
          </div>
        </div>
      </div>

      <canvas id="cartpole-stage" class="stage-canvas cartpole-stage" role="img" aria-label="Chariot, bâton et jauges de position et d’angle"></canvas>
      <p id="cartpole-replay-info" class="cartpole-replay-info" aria-live="polite"></p>

      <div id="cartpole-agent-controls">
        <div class="controls">
          <button id="cartpole-btn-run" class="primary" type="button">Apprendre</button>
          <button id="cartpole-btn-unit" type="button">Une génération</button>
          <button id="cartpole-btn-reset" type="button">Réinitialiser</button>
        </div>
        <dl class="stats">
          <div><dt id="cartpole-st-iter-label">Génération</dt><dd id="cartpole-st-iter">0</dd></div>
          <div><dt id="cartpole-st-last-label">Dernière moyenne</dt><dd id="cartpole-st-last">–</dd></div>
          <div><dt>Record (pas)</dt><dd id="cartpole-st-best">–</dd></div>
          <div><dt>Parties jouées (épisodes)</dt><dd id="cartpole-st-eps">0</dd></div>
        </dl>
        <p id="cartpole-status" class="status" role="status"></p>
      </div>

      <div id="cartpole-human-controls" hidden>
        <p class="help cartpole-human-help">
          Gardez le bâton droit avec les flèches <kbd>←</kbd> <kbd>→</kbd> du clavier, ou en maintenant les gros boutons.
          Sans touche appuyée, le moteur ne pousse pas (l’agent, lui, pousse toujours d’un côté ou de l’autre). Le monde est le même que celui de l’agent : bâton, moteur, vent.
        </p>
        <div class="cartpole-pads">
          <button type="button" class="cartpole-pad" id="cartpole-pad-left" aria-label="Pousser à gauche">←</button>
          <button type="button" class="cartpole-pad" id="cartpole-pad-right" aria-label="Pousser à droite">→</button>
        </div>
        <div class="controls">
          <button id="cartpole-btn-play" class="primary" type="button">Commencer</button>
          <button id="cartpole-btn-compare" type="button" disabled>Comparer avec l’agent</button>
          <label class="check"><input type="checkbox" id="cartpole-slowmo" /> Ralenti (×0,5)</label>
        </div>
        <dl class="stats cartpole-stats-human">
          <div><dt>Votre temps</dt><dd id="cartpole-h-time">–</dd></div>
          <div><dt>Votre record</dt><dd id="cartpole-h-best">–</dd></div>
          <div><dt>L’agent (même départ)</dt><dd id="cartpole-h-agent">–</dd></div>
          <div><dt>Maximum</dt><dd>10,0 s</dd></div>
        </dl>
        <p id="cartpole-h-status" class="status" role="status"></p>
      </div>
    </section>

    <section class="panel" aria-label="Graphique">
      <h2 id="cartpole-chart-title">Pas tenus par génération</h2>
      <canvas id="cartpole-chart" class="cartpole-chart" role="img" aria-label="Courbe du nombre de pas tenus au fil de l’apprentissage"></canvas>
      <p class="help" id="cartpole-chart-help"></p>
    </section>

    <section class="panel" aria-label="Cerveau de l’agent">
      <h2>Le cerveau de l’agent, en direct</h2>
      <canvas id="cartpole-net" class="cartpole-net" role="img" aria-label="Réseau de neurones de l’agent : capteurs, neurones cachés et décision"></canvas>
      <p class="help">
        À gauche, les 4 capteurs (ramenés à des nombres de l’ordre de 1) ; à droite, la décision : pousser à gauche ou à droite.
        Couleur d’un rond : signal du neurone en ce moment (<span class="cartpole-key cartpole-key-pos"></span> positif,
        <span class="cartpole-key cartpole-key-neg"></span> négatif, pâle = proche de 0). Chaque lien est un « poids » : un nombre qui
        amplifie ou inverse le signal (épaisseur = force, couleur = signe). Apprendre, c’est régler ces poids.
      </p>
    </section>
  </div>

  <div class="col">
    <section class="panel" aria-label="Scénarios">
      <h2>Scénarios</h2>
      <p class="help">Chaque scénario règle le monde et l’agent, repart de zéro et vous dit quoi regarder. Cliquez ensuite sur « Apprendre ».</p>
      <div class="presets" id="cartpole-scenarios"></div>
      <p id="cartpole-scenario-info" class="preset-info">Choisissez un scénario, ou réglez le monde et l’agent ci-dessous.</p>
    </section>

    <section class="panel" aria-label="Le monde">
      <h2>Le monde</h2>
      <p class="help cartpole-intro">Ces réglages s’appliquent immédiatement, même en plein apprentissage : l’agent doit alors s’adapter au nouveau monde.</p>
      <div id="cartpole-world-knobs" class="cartpole-knobs"></div>
    </section>

    <section class="panel" aria-label="L’agent">
      <h2>L’agent</h2>
      <p class="help cartpole-intro">« Méthode » et « Cerveau » font repartir l’agent de zéro ; les autres réglages s’appliquent tout de suite.</p>
      <div id="cartpole-agent-knobs" class="cartpole-knobs"></div>
      <details class="expert" id="cartpole-expert">
        <summary>Paramètres experts</summary>
        <label class="check cartpole-cont"><input type="checkbox" id="cartpole-continuous" /> Commande progressive (force = sortie × force max) au lieu de tout-ou-rien</label>
        <p class="help">Par défaut, l’agent pousse toujours à fond, à gauche ou à droite (comme dans la version classique du problème). Relance l’apprentissage.</p>
        <div id="cartpole-sliders" class="sliders"></div>
      </details>
    </section>

    <section class="panel explain-panel">
      <h2>Comment ça marche ?</h2>
      <p>
        Le chariot doit garder le bâton à moins de 12° de la verticale sans sortir de la piste (±2,4 m), pendant 500 pas de 0,02 s (10 s).
        Une partie s’appelle un <em>épisode</em> ; chaque pas tenu rapporte +1 point (la <em>récompense</em>), donc le score d’un épisode
        est simplement le nombre de pas tenus. L’agent « sent » 4 nombres continus : position, vitesse, angle, vitesse de rotation du bâton.
      </p>
      <h3>Pourquoi un réseau plutôt qu’un tableau ?</h3>
      <p>
        Dans le labyrinthe, il y avait 64 cases : on pouvait noter chaque case dans un tableau. Ici, l’état est fait de nombres réels :
        il y a une infinité de situations, jamais deux fois exactement les mêmes. On remplace donc le tableau par une
        <strong>fonction</strong> à quelques dizaines de paramètres, qui <em>généralise</em> : deux situations proches donnent des décisions proches.
      </p>
      <p class="formula">décision = tanh( W₂ · tanh( W₁ · capteurs + b₁ ) + b₂ ) → signe = côté où pousser</p>
      <h3>Stratégie d’évolution</h3>
      <ul>
        <li>On part d’un jeu de poids θ (tous les nombres du réseau). On fabrique une <em>population</em> de variantes θ ± σ·ε : de petites modifications au hasard (bruit gaussien ε, par paires opposées). Une ronde d’essais s’appelle une <em>génération</em>.</li>
        <li>Chaque variante joue quelques épisodes (les mêmes départs et les mêmes rafales pour toutes, pour une comparaison juste). Son score = pas tenus en moyenne.</li>
        <li>On classe les variantes et on déplace θ vers celles qui ont le mieux réussi (une direction de progrès estimée à partir des scores, appliquée avec l’optimiseur Adam). Aucune équation du chariot n’est nécessaire : seulement des scores.</li>
        <li>À l’écran, on rejoue la <strong>meilleure variante</strong> de la dernière génération. La courbe montre la moyenne de la population (points et ligne) et la meilleure variante (pointillés).</li>
      </ul>
      <h3>REINFORCE</h3>
      <p>
        Un seul agent, dont la stratégie (la <em>politique</em>) est <em>aléatoire</em> : P(pousser →) = σ(w · capteurs + b). Après chaque épisode, chaque action
        est renforcée si elle a été suivie d’une survie plus longue que la moyenne de l’épisode (cette moyenne sert de <em>ligne de base</em>) :
      </p>
      <p class="formula">w ← w + α · Σₜ Âₜ · ∇ log π(aₜ | sₜ)</p>
      <p>
        où Âₜ est le retour Gₜ = rₜ + γ·rₜ₊₁ + … centré et réduit sur l’épisode. Comme tout repose sur un seul épisode tiré au sort,
        l’estimation est très bruitée : la courbe monte, mais en dents de scie, avec des rechutes, et elle dépend beaucoup du taux d’apprentissage.
        Il faut aussi des centaines de mises à jour (une par épisode), contre quelques dizaines de générations pour l’évolution
        — mais une génération coûte, elle, 90 épisodes avec les réglages par défaut (30 variantes × 3 épisodes). Comparez la case « Parties jouées » : en nombre d’épisodes, les deux méthodes sont ici du même ordre de grandeur.
      </p>
      <h3>Ce que les réglages changent vraiment</h3>
      <ul>
        <li><strong>Bâton, chariot, moteur</strong> : les masses, la demi-longueur et la force injectées dans les équations du mouvement (Barto, Sutton et Anderson, 1983), intégrées pas à pas (méthode d’Euler).</li>
        <li><strong>Vent</strong> : une force horizontale au centre du bâton, absente des capteurs. Un agent entraîné sans vent n’a jamais appris à y résister.</li>
        <li><strong>Audace</strong> = σ ; <strong>Rythme</strong> = nombre d’épisodes simulés par seconde dans un Web Worker (le calcul ne bloque jamais la page).</li>
      </ul>
    </section>
  </div>
</div>
`;
