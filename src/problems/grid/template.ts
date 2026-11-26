// Gabarit HTML du labyrinthe (injecté dans le conteneur fourni par le shell).
// Tous les identifiants sont préfixés par « grid- » pour éviter les collisions.
export const TEMPLATE = `
<div class="layout grid-root">
  <div class="col">
    <section class="panel" aria-label="Grille">
      <div class="toolbar" role="radiogroup" aria-label="Outil d’édition">
        <span class="toolbar-label">Clic sur la grille :</span>
        <label class="tool"><input type="radio" name="grid-tool" value="wall" checked /><span class="swatch sw-wall"></span>Mur</label>
        <label class="tool"><input type="radio" name="grid-tool" value="trap" /><span class="swatch sw-trap"></span>Piège</label>
        <label class="tool"><input type="radio" name="grid-tool" value="start" /><span class="swatch sw-start"></span>Départ</label>
        <label class="tool"><input type="radio" name="grid-tool" value="goal" /><span class="swatch sw-goal"></span>Grand trésor</label>
        <label class="tool"><input type="radio" name="grid-tool" value="bonus" /><span class="swatch grid-sw-bonus"></span>Petit trésor</label>
        <label class="tool"><input type="radio" name="grid-tool" value="empty" /><span class="swatch sw-empty"></span>Effacer</label>
      </div>

      <div class="grid-board-wrap">
        <canvas id="grid-board" class="grid-board" aria-label="Grille 8 par 8 de l’environnement"></canvas>
      </div>

      <div class="controls">
        <button id="grid-btn-run" class="primary">Démarrer</button>
        <button id="grid-btn-step">Pas à pas</button>
        <button id="grid-btn-reset">Réinitialiser</button>
      </div>

      <div class="map-actions">
        <button id="grid-btn-map-default" class="ghost">Carte par défaut</button>
        <button id="grid-btn-map-clear" class="ghost">Vider la grille</button>
        <label class="check"><input type="checkbox" id="grid-show-arrows" checked /> Flèches</label>
        <label class="check"><input type="checkbox" id="grid-show-values" /> Valeurs</label>
        <label class="check"><input type="checkbox" id="grid-show-greedy" checked /> Meilleur chemin</label>
      </div>

      <dl class="stats">
        <div><dt>Épisode</dt><dd id="grid-st-episode">0</dd></div>
        <div><dt>Pas (épisode)</dt><dd id="grid-st-step">0</dd></div>
        <div><dt>ε actuel</dt><dd id="grid-st-eps">1,00</dd></div>
        <div><dt>Dernière récompense</dt><dd id="grid-st-last">–</dd></div>
      </dl>
      <p id="grid-status" class="status" role="status"></p>

      <div class="legend grid-legend">
        <span><span class="grad"></span> Valeur apprise V(s) = max Q : rouge = mauvais, vert = bon.</span>
        <span>Pointillés bleus : meilleur chemin appris. Trait orange : trajet de l’épisode en cours.</span>
      </div>
    </section>

    <section class="panel" aria-label="Graphique">
      <h2>Récompense par épisode</h2>
      <canvas id="grid-chart" class="grid-chart" aria-label="Courbe de la récompense totale par épisode"></canvas>
      <p class="help">
        Points clairs : récompense de chaque épisode. Ligne : moyenne glissante sur 20 épisodes.
        Une courbe qui monte puis se stabilise = l’agent a appris.
      </p>
    </section>

    <section class="panel" aria-label="Comparer Q-learning et SARSA">
      <h2>Comparer Q-learning et SARSA</h2>
      <p class="help">
        Deux agents identiques apprennent en même temps sur la carte ci-dessus, avec les mêmes réglages :
        seule leur façon de tirer les leçons diffère. Essayez sur « La falaise » ou « Le grand détour ».
      </p>
      <div class="controls">
        <button id="grid-cmp-run" class="primary">Comparer</button>
        <button id="grid-cmp-reset">Réinitialiser</button>
      </div>
      <div class="grid-cmp-boards">
        <figure class="grid-cmp-fig">
          <figcaption><span class="grid-dot grid-dot-q"></span>Q-learning</figcaption>
          <canvas id="grid-cmp-q" class="grid-cmp-board" aria-label="Grille apprise par Q-learning"></canvas>
          <p class="grid-cmp-info" id="grid-cmp-q-info">–</p>
        </figure>
        <figure class="grid-cmp-fig">
          <figcaption><span class="grid-dot grid-dot-s"></span>SARSA</figcaption>
          <canvas id="grid-cmp-s" class="grid-cmp-board" aria-label="Grille apprise par SARSA"></canvas>
          <p class="grid-cmp-info" id="grid-cmp-s-info">–</p>
        </figure>
      </div>
      <canvas id="grid-cmp-chart" class="grid-cmp-chart" aria-label="Récompense moyenne par épisode des deux algorithmes"></canvas>
      <p class="help">Courbes : moyenne glissante (20 épisodes) de la récompense de chaque agent, pendant l’apprentissage (exploration comprise).</p>
      <p id="grid-cmp-status" class="status" role="status"></p>
    </section>
  </div>

  <div class="col">
    <section class="panel" aria-label="Personnalité de l’agent">
      <h2>Personnalité de l’agent</h2>
      <p class="help grid-intro">
        Réglez le caractère de l’agent en langage courant. Chaque trait modifie un ou deux paramètres techniques,
        affichés après la flèche (et dans « Paramètres experts » plus bas). Les changements s’appliquent tout de suite ;
        « Réinitialiser » fait tout réapprendre avec la nouvelle personnalité.
      </p>
      <div id="grid-traits" class="grid-traits"></div>
    </section>

    <section class="panel" aria-label="Scénarios">
      <h2>Scénarios</h2>
      <p class="help">Chaque scénario charge une carte et une personnalité, puis raconte quoi observer.</p>
      <div class="presets" id="grid-scenarios"></div>
      <p id="grid-scenario-info" class="preset-info">Choisissez un scénario, puis cliquez sur « Démarrer ».</p>
    </section>

    <section class="panel" aria-label="Réglages techniques">
      <h2>Expériences sur les réglages</h2>
      <p class="help">Ces boutons ne changent pas la carte : ils montrent l’effet de réglages extrêmes.</p>
      <div class="presets" id="grid-presets"></div>
      <p id="grid-preset-info" class="preset-info">Choisissez une expérience pour voir l’effet des paramètres, puis cliquez sur « Démarrer ».</p>

      <details class="expert" id="grid-expert">
        <summary>Paramètres experts</summary>
        <div class="group-title">Algorithme</div>
        <div class="algo">
          <label><input type="radio" name="grid-algo" value="qlearning" checked /> Q-learning</label>
          <label><input type="radio" name="grid-algo" value="sarsa" /> SARSA</label>
        </div>
        <p class="help" id="grid-algo-help"></p>
        <div id="grid-sliders" class="sliders"></div>
      </details>
    </section>

    <section class="panel explain-panel">
      <h2>Comment ça marche ?</h2>
      <p>
        L’agent garde un tableau <strong>Q(case, action)</strong> : pour chaque case et chacune des 4 directions, une
        estimation de « combien je vais gagner au total si je fais ça ». À chaque pas, il compare ce qu’il espérait à ce
        qu’il vient de vivre et corrige son estimation :
      </p>
      <p class="formula">Q(s, a) ← Q(s, a) + α · [ r + γ · Q(s′, a′) − Q(s, a) ]</p>
      <ul>
        <li><strong>Q-learning</strong> prend pour Q(s′, a′) la <em>meilleure</em> action possible ensuite : il apprend la
          stratégie optimale comme s’il ne faisait jamais d’écart, même pendant qu’il explore.</li>
        <li><strong>SARSA</strong> prend l’action qu’il va <em>réellement</em> jouer, exploration comprise : tant qu’il
          explore, il apprend une stratégie plus prudente, qui garde ses distances avec les pièges. Si ε tombe presque
          à zéro, ses choix rejoignent ceux de Q-learning.</li>
        <li>Pour choisir, l’agent suit la règle <strong>ε-greedy</strong> : avec une probabilité ε il tente une direction au
          hasard (exploration), sinon il prend la meilleure connue (exploitation).</li>
      </ul>
      <h3>Que veulent dire les traits de personnalité ?</h3>
      <ul>
        <li><strong>Curiosité</strong> = ε et sa décroissance : la part de pas joués au hasard. Avec peu de curiosité, l’agent
          risque de se contenter du premier trésor trouvé, sans jamais découvrir qu’un meilleur existe plus loin.</li>
        <li><strong>Vision à long terme</strong> = γ : chaque pas d’attente multiplie la valeur d’une récompense par γ.
          Avec γ = 0,5, un gain 5 pas plus loin ne vaut déjà plus que 3&nbsp;% ; avec γ = 0,99, encore 95&nbsp;%.</li>
        <li><strong>Prudence</strong> = l’algorithme (Q-learning ou SARSA) et la pénalité des pièges.</li>
        <li><strong>Impatience</strong> = le coût de chaque pas : plus il est élevé, plus les longs trajets coûtent cher.</li>
        <li><strong>Mémoire</strong> = α, la part de l’écart « attendu / vécu » corrigée à chaque expérience.</li>
        <li><strong>Monde imprévisible</strong> = la glissance : une partie des actions part dans une direction au hasard.
          Contrairement à l’exploration, l’agent subit ce hasard même quand il veut bien faire : Q-learning en tient donc
          compte lui aussi.</li>
      </ul>
    </section>
  </div>
</div>
`;
