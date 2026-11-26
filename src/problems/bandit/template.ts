// Gabarit HTML du problème « machines à sous ».
export const TEMPLATE = `
<div class="layout bandit-root">
  <div class="col">
    <section class="panel" aria-label="Machines à sous">
      <div class="bandit-topbar">
        <div class="segmented bandit-seg" role="group" aria-label="Mode">
          <button data-mode="race" class="active" aria-pressed="true">Course des stratégies</button>
          <button data-mode="human" aria-pressed="false">À vous de jouer</button>
        </div>
      </div>

      <div class="bandit-viewbar" id="bandit-viewbar">
        <span class="bandit-label">Afficher ce que sait :</span>
        <div class="segmented bandit-seg" id="bandit-view" role="group" aria-label="Stratégie affichée"></div>
      </div>
      <p class="help" id="bandit-view-help"></p>
      <p class="help bandit-human-intro" id="bandit-human-intro" hidden>
        Cliquez sur une machine pour y jouer une pièce. Vous ne connaissez pas les probabilités : à vous de trouver
        le bon équilibre entre essayer les machines (explorer) et rejouer celle qui semble la meilleure (exploiter).
      </p>

      <div class="bandit-machines" id="bandit-machines"></div>
      <p class="help bandit-barlegend">
        <span class="bandit-key bandit-key-est"></span> estimation
        <span class="bandit-key bandit-key-ci"></span> incertitude (≈ 95 %)
        <span class="bandit-key bandit-key-ucb" id="bandit-key-ucb"></span><span id="bandit-key-ucb-text"> bonus UCB</span>
        <span class="bandit-key bandit-key-true"></span> vraie probabilité (si révélée)
      </p>

      <div class="controls" id="bandit-race-controls">
        <button id="bandit-run" class="primary">Démarrer</button>
        <button id="bandit-step">Un coup</button>
        <button id="bandit-restart">Recommencer</button>
      </div>
      <div class="controls" id="bandit-human-controls" hidden>
        <button id="bandit-human-restart" class="primary">Nouvelle partie</button>
      </div>

      <div class="map-actions">
        <button id="bandit-new" class="ghost">Nouvelles machines</button>
        <label class="check"><input type="checkbox" id="bandit-reveal" /> Révéler les vraies probabilités</label>
      </div>

      <dl class="stats">
        <div><dt id="bandit-dt-1">Coup</dt><dd id="bandit-st-1">0</dd></div>
        <div><dt id="bandit-dt-2">Gains</dt><dd id="bandit-st-2">0</dd></div>
        <div><dt id="bandit-dt-3">Regret</dt><dd id="bandit-st-3">0</dd></div>
        <div><dt id="bandit-dt-4">En tête</dt><dd id="bandit-st-4">–</dd></div>
      </dl>
      <p id="bandit-status" class="status" role="status"></p>

      <div id="bandit-results" class="bandit-results" hidden></div>
    </section>

    <section class="panel" id="bandit-chart-panel" aria-label="Graphique de la course">
      <div class="bandit-chart-head">
        <h2 id="bandit-chart-title">Regret cumulé</h2>
        <div class="segmented bandit-seg" role="group" aria-label="Mesure affichée">
          <button data-metric="regret" class="active" aria-pressed="true">Regret</button>
          <button data-metric="best" aria-pressed="false">% meilleure machine</button>
        </div>
      </div>
      <div class="bandit-legend" id="bandit-legend"></div>
      <canvas id="bandit-chart" class="bandit-chart" aria-label="Courbes de chaque stratégie au fil des coups"></canvas>
      <p class="help" id="bandit-chart-help"></p>
    </section>

    <section class="panel" id="bandit-beta-panel" aria-label="Croyances">
      <h2 id="bandit-beta-title">Croyances de Thompson</h2>
      <canvas id="bandit-beta" class="bandit-chart bandit-beta" aria-label="Courbes de croyance (lois Beta) de chaque machine"></canvas>
      <p class="help" id="bandit-beta-help"></p>
    </section>
  </div>

  <div class="col">
    <section class="panel" aria-label="Scénarios">
      <h2>Scénarios</h2>
      <div class="presets">
        <button data-scenario="easy">Machines très différentes</button>
        <button data-scenario="hard">Machines presque identiques</button>
        <button data-scenario="switch">Le casino change les réglages en cours de route</button>
        <button data-scenario="needle">Une seule bonne machine cachée parmi 10</button>
      </div>
      <p id="bandit-preset-info" class="preset-info"></p>
    </section>

    <section class="panel" aria-label="Réglages">
      <h2>Le casino</h2>
      <div class="sliders" id="bandit-world"></div>
      <label class="check bandit-check"><input type="checkbox" id="bandit-change" /> Le casino change les réglages à mi-partie</label>
      <p class="help">À mi-partie, le classement des machines est inversé (la meilleure devient la pire). Relance la partie.</p>

      <h2>La personnalité des joueurs</h2>
      <div class="sliders" id="bandit-agent"></div>
      <label class="check bandit-check"><input type="checkbox" id="bandit-short" /> Mémoire courte</label>
      <p class="help" id="bandit-short-help">
        Coché, chaque stratégie ne retient en gros que les ~10 derniers résultats de chaque machine (les plus anciens
        s’effacent peu à peu) : moins précis quand rien ne change, mais bien plus réactif si le casino triche.
      </p>

      <details class="expert">
        <summary>Paramètres experts</summary>
        <div class="sliders" id="bandit-expert"></div>
      </details>
    </section>

    <section class="panel explain-panel">
      <h2>Comment ça marche ?</h2>
      <p>
        Devant plusieurs machines à sous dont on ignore les chances de gain, chaque pièce pose un <strong>dilemme</strong> :
        <em>exploiter</em> la machine qui semble la meilleure, ou <em>explorer</em> une autre machine, peut-être meilleure,
        mais connue seulement par quelques essais malchanceux ? C’est le problème du <strong>bandit manchot</strong>,
        la forme la plus pure de ce dilemme en apprentissage par renforcement : une seule situation, plusieurs actions,
        une récompense aléatoire (1 pièce gagnée ou rien).
      </p>
      <p>Chaque stratégie tient une estimation de la probabilité de gain de chaque machine, mise à jour après chaque partie :</p>
      <p class="formula">Q ← Q + (r − Q) / n &nbsp;&nbsp;(moyenne de tous les résultats)</p>
      <ul>
        <li><strong>Regret</strong> : ce qu’on a perdu, en moyenne, par rapport à quelqu’un qui jouerait toujours la meilleure
          machine. À chaque coup on ajoute (p de la meilleure − p de la machine jouée). Un regret qui se stabilise = la
          stratégie a trouvé la bonne machine ; une droite qui monte = elle se trompe en permanence.</li>
        <li><strong>Glouton pur</strong> : n’explore jamais. Si la meilleure machine perd à son premier essai, son estimation
          reste à 0 : dès qu’une autre machine a gagné une fois, il ne reviendra plus jamais à la meilleure.</li>
        <li><strong>ε-greedy</strong> : explore au hasard une fois sur 1/ε environ. Il finit par tout essayer, mais continue
          à gaspiller des pièces sur des machines qu’il sait mauvaises.</li>
        <li><strong>UCB</strong> (« borne de confiance haute ») = <em>optimisme face à l’incertitude</em> : on joue la
          machine dont la valeur <em>pourrait</em> être la plus haute, compte tenu de ce qu’on sait.</li>
      </ul>
      <p class="formula">score = Q + c · √( ln t / n )</p>
      <ul>
        <li>t = nombre total de coups, n = nombre de parties sur cette machine. Une machine peu jouée a un gros bonus :
          soit elle est vraiment bonne (et on a bien fait), soit on l’apprend vite et son bonus fond.</li>
        <li><strong>Thompson</strong> = <em>jouer selon la probabilité d’être la meilleure</em>. Avec g gains et p pertes,
          la croyance sur la probabilité de gain est une loi Beta(a₀ + g, b₀ + p). On tire une valeur au hasard dans
          chaque courbe et on joue la plus haute : une courbe large (machine mal connue) produit parfois une valeur haute,
          d’où une exploration automatique qui s’éteint d’elle-même à mesure que les courbes se resserrent.</li>
        <li><strong>Mémoire courte</strong> : au lieu de la moyenne, on utilise un pas constant α,
          Q ← Q + α · (r − Q). Avec la moyenne, le n-ième résultat ne pèse que 1/n : après 200 parties, un changement
          de réglage met des centaines de coups à se voir. Avec α = 0,1, les résultats anciens perdent 10 % de leur
          poids à chaque nouvelle partie de la machine, et l’estimation suit les changements.</li>
      </ul>
      <p class="help">
        Dans la course, toutes les stratégies jouent sur les <em>mêmes</em> machines, mais chacune avec sa propre chance :
        une seule course peut donc être trompeuse. Cliquez plusieurs fois sur « Recommencer » pour voir la tendance.
      </p>
    </section>
  </div>
</div>
`;
