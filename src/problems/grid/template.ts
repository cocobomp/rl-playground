// Gabarit HTML du labyrinthe (injecté dans le conteneur fourni par le shell).
export const TEMPLATE = `
<div class="layout">
      <div class="col">
      <section class="panel board-panel" aria-label="Grille">
        <div class="toolbar" role="radiogroup" aria-label="Outil d’édition">
          <span class="toolbar-label">Clic sur la grille :</span>
          <label class="tool"><input type="radio" name="tool" value="wall" checked /><span class="swatch sw-wall"></span>Mur</label>
          <label class="tool"><input type="radio" name="tool" value="trap" /><span class="swatch sw-trap"></span>Piège</label>
          <label class="tool"><input type="radio" name="tool" value="start" /><span class="swatch sw-start"></span>Départ</label>
          <label class="tool"><input type="radio" name="tool" value="goal" /><span class="swatch sw-goal"></span>Arrivée</label>
          <label class="tool"><input type="radio" name="tool" value="empty" /><span class="swatch sw-empty"></span>Effacer</label>
        </div>

        <div class="board-wrap">
          <canvas id="board" aria-label="Grille 8 par 8 de l’environnement"></canvas>
        </div>

        <div class="controls">
          <button id="btn-run" class="primary">Démarrer</button>
          <button id="btn-step">Pas à pas</button>
          <button id="btn-reset">Réinitialiser</button>
        </div>

        <div class="map-actions">
          <button id="btn-map-default" class="ghost">Carte par défaut</button>
          <button id="btn-map-clear" class="ghost">Vider la grille</button>
          <label class="check"><input type="checkbox" id="show-arrows" checked /> Flèches</label>
          <label class="check"><input type="checkbox" id="show-values" /> Valeurs</label>
          <label class="check"><input type="checkbox" id="show-greedy" checked /> Meilleur chemin</label>
        </div>

        <dl class="stats">
          <div><dt>Épisode</dt><dd id="st-episode">0</dd></div>
          <div><dt>Pas (épisode)</dt><dd id="st-step">0</dd></div>
          <div><dt>ε actuel</dt><dd id="st-eps">1.00</dd></div>
          <div><dt>Dernière récompense</dt><dd id="st-last">–</dd></div>
        </dl>
        <p id="status" class="status" role="status"></p>

        <div class="legend">
          <span><span class="grad"></span> Valeur apprise V(s) = max Q : rouge = mauvais, vert = bon</span>
        </div>
      </section>

      <section class="panel chart-panel" aria-label="Graphique">
        <h2>Récompense par épisode</h2>
        <canvas id="chart" aria-label="Courbe de la récompense totale par épisode"></canvas>
        <p class="help">
          Points clairs : récompense de chaque épisode. Ligne : moyenne glissante sur 20 épisodes.
          Une courbe qui monte puis se stabilise = l’agent a appris.
        </p>
      </section>
      </div>
      <div class="col">
      <section class="panel params-panel" aria-label="Paramètres">
        <h2>Préréglages</h2>
        <div class="presets">
          <button data-preset="explore">Explore trop</button>
          <button data-preset="fast">Apprend trop vite</button>
          <button data-preset="balanced">Équilibré</button>
        </div>
        <p id="preset-info" class="preset-info">Choisissez un préréglage pour voir l’effet des paramètres, puis cliquez sur « Démarrer ».</p>

        <h2>Algorithme</h2>
        <div class="algo">
          <label><input type="radio" name="algo" value="qlearning" checked /> Q-learning</label>
          <label><input type="radio" name="algo" value="sarsa" /> SARSA</label>
        </div>
        <p class="help" id="algo-help"></p>

        <h2>Paramètres</h2>
        <div id="sliders" class="sliders"></div>
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
            stratégie optimale même s’il explore (il « suppose » qu’il jouera parfaitement).</li>
          <li><strong>SARSA</strong> prend l’action qu’il va <em>réellement</em> jouer, exploration comprise : il apprend une
            stratégie plus prudente, qui garde ses distances avec les pièges.</li>
          <li>Pour choisir, l’agent suit la règle <strong>ε-greedy</strong> : avec une probabilité ε il tente une direction au
            hasard (exploration), sinon il prend la meilleure connue (exploitation).</li>
        </ul>
      </section>
      </div>
    </div>
`;
