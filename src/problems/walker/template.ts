// Gabarit HTML du robot marcheur. Tous les identifiants sont préfixés par « walker- ».
export const TEMPLATE = `
<section class="walker-start" aria-label="Commencez ici">
  <p class="walker-start-title">Commencez ici</p>
  <ol>
    <li>Regardez le robot : son «&nbsp;cerveau&nbsp;» a déjà appris à marcher. Sa démarche est étrange, mais il parcourt environ 27&nbsp;m en 10&nbsp;s.</li>
    <li>Blessez-le : cochez <strong>Bloquer le genou gauche</strong> (ou choisissez le scénario <strong>Blessure au genou</strong>). Le même cerveau ne fait plus qu’environ 11&nbsp;m.</li>
    <li>Cliquez sur <strong>Réapprendre</strong> et suivez la courbe : en quelques dizaines de «&nbsp;générations&nbsp;» (tours d’essais),
      il invente une nouvelle démarche et retrouve sa distance.</li>
  </ol>
  <p class="walker-start-key">L’idée clé : on ne lui explique jamais <em>comment</em> marcher. On lui donne seulement un <strong>score</strong>
    (la «&nbsp;récompense&nbsp;») : aller loin, sans trop dépenser d’énergie, sans tomber. Il cherche tout ce qui fait monter ce score… au pied de la lettre,
    d’où ces démarches bizarres mais efficaces.</p>
</section>
<div class="layout walker-root">
  <div class="col">
    <section class="panel" aria-label="Simulation du robot">
      <div class="walker-stage-wrap">
        <canvas id="walker-stage" class="stage-canvas walker-stage" role="img" aria-label="Le robot marcheur vu de côté, la caméra le suit"></canvas>
      </div>
      <p class="legend walker-legend">
        <span><span class="walker-sw walker-sw-left"></span>jambe gauche</span>
        <span><span class="walker-sw walker-sw-right"></span>jambe droite</span>
        <span><span class="walker-sw walker-sw-contact"></span>pied au sol</span>
        <span><span class="walker-sw walker-sw-ghost"></span>fantôme : robot intact, cerveau sain</span>
      </p>

      <div class="controls">
        <button id="walker-btn-run" class="primary" type="button">Apprendre</button>
        <button id="walker-btn-adapt" type="button" title="Continue l’évolution à partir du cerveau affiché, dans le monde actuel">Réapprendre</button>
        <button id="walker-btn-scratch" type="button">Repartir de zéro</button>
      </div>
      <div class="map-actions">
        <label class="check"><input type="checkbox" id="walker-ghost" checked /> Fantôme</label>
        <span class="walker-inline-label" id="walker-speed-label">Lecture :</span>
        <div class="segmented" id="walker-speed" role="group" aria-labelledby="walker-speed-label"></div>
        <button id="walker-btn-replay" class="ghost" type="button">Revoir l’essai</button>
      </div>

      <dl class="stats">
        <div><dt title="Un tour d’essais : plusieurs variantes du cerveau sont testées, puis le cerveau est amélioré">Génération (tour d’essais)</dt><dd id="walker-st-gen">0</dd></div>
        <div><dt>Distance (essai affiché)</dt><dd id="walker-st-dist">–</dd></div>
        <div><dt>Vitesse moyenne</dt><dd id="walker-st-speed">–</dd></div>
        <div><dt>Énergie dépensée</dt><dd id="walker-st-energy">–</dd></div>
      </dl>
      <p id="walker-status" class="status" role="status"></p>
    </section>

    <section class="panel" aria-label="Mesures">
      <h2>Tableau des mesures</h2>
      <p class="help">Chaque essai affiché (10 s au plus) est noté ici. Même cerveau + même monde = exactement le même essai : la simulation est déterministe.</p>
      <div class="walker-table-wrap">
        <table class="walker-table">
          <thead><tr><th scope="col">Cerveau · monde</th><th scope="col">Distance</th><th scope="col">Vitesse</th><th scope="col">Énergie</th></tr></thead>
          <tbody id="walker-measures"><tr><td colspan="4" class="walker-empty">Aucun essai terminé pour l’instant.</td></tr></tbody>
        </table>
      </div>
    </section>

    <section class="panel" aria-label="Graphique">
      <div class="walker-chart-head">
        <h2 id="walker-chart-title">Progrès de l’apprentissage</h2>
        <div class="segmented" id="walker-chart-mode" role="group" aria-label="Grandeur affichée">
          <button type="button" data-mode="score" class="active" aria-pressed="true">Score</button>
          <button type="button" data-mode="distance" aria-pressed="false">Distance</button>
        </div>
      </div>
      <canvas id="walker-chart" class="walker-chart" aria-label="Courbe du meilleur score et du score moyen par génération"></canvas>
      <p class="help walker-chart-legend">
        <span><span class="walker-line walker-line-mean"></span>moyenne des variantes testées</span>
        <span><span class="walker-line walker-line-best"></span>meilleure variante</span>
      </p>
      <p class="help" id="walker-chart-help"></p>
    </section>
  </div>

  <div class="col">
    <section class="panel" aria-label="Scénarios">
      <h2>Scénarios</h2>
      <p class="help">Une histoire en quatre étapes : un robot qui marche, une blessure, puis l’adaptation.</p>
      <div class="presets" id="walker-scenarios"></div>
      <p id="walker-scenario-info" class="preset-info"></p>
    </section>

    <section class="panel" aria-label="Interventions">
      <h2>Interventions</h2>
      <p class="help walker-intro">
        Modifiez le corps ou le monde. Le cerveau ne change pas : vous voyez d’abord comment il s’en sort
        <em>sans</em> réapprendre. Cliquez ensuite sur «&nbsp;Réapprendre&nbsp;» pour qu’il s’adapte.
      </p>
      <div id="walker-interventions" class="walker-interventions"></div>
      <div class="map-actions"><button id="walker-btn-heal" class="ghost" type="button">Tout réparer</button></div>
    </section>

    <section class="panel" aria-label="Objectifs du robot">
      <h2>Ce que le robot cherche</h2>
      <p class="help walker-intro">
        Le robot ne reçoit aucune leçon de marche : seulement un score à la fin de chaque essai
        (en reinforcement learning, on parle de <strong>récompense</strong> : on décrit le but, pas la méthode).
        Ces réglages changent ce score, donc la démarche qu’il finira par trouver. Ils agissent sur l’apprentissage
        à venir, pas sur le cerveau déjà appris.
      </p>
      <div id="walker-knobs" class="walker-knobs"></div>
      <p class="formula walker-formula" id="walker-formula"></p>

      <details class="expert" id="walker-expert">
        <summary>Paramètres experts</summary>
        <div id="walker-sliders" class="sliders"></div>
      </details>
    </section>

    <section class="panel explain-panel" aria-label="Explications">
      <h2>Comment ça marche ?</h2>
      <ul>
        <li><strong>Le corps.</strong> Un torse et deux jambes (cuisse + tibia + pied rond), simulés par le moteur physique
          planck.js (un portage de Box2D) : gravité, frottements, chocs. Quatre articulations motorisées :
          deux hanches et deux genoux, chacune avec des butées et un couple maximal. Le monde est en 2D :
          le robot ne peut pas tomber sur le côté.</li>
        <li><strong>Ce qu’il perçoit.</strong> 17 nombres, 60 fois par seconde : inclinaison et rotation du torse,
          vitesse, hauteur, angle et vitesse de chaque articulation, quel pied touche le sol… et une horloge interne
          (sinus et cosinus d’un rythme à 1,4 Hz). Ce métronome l’aide beaucoup à produire un mouvement qui se répète.</li>
        <li><strong>Ce qu’il décide.</strong> Pour chaque articulation, un angle visé. Un petit asservissement transforme
          l’écart entre l’angle visé et l’angle actuel en vitesse de moteur, dans la limite de sa force.</li>
        <li><strong>Son cerveau.</strong> Un réseau de neurones (une fonction de calcul réglable) 17 → 16 → 4, soit 356 nombres (poids et biais).
          Apprendre à marcher, c’est trouver de bonnes valeurs pour ces 356 nombres.</li>
        <li><strong>Comment il apprend : la stratégie d’évolution.</strong> À chaque génération, on fabrique des variantes
          du cerveau actuel en ajoutant un petit bruit aléatoire à ses poids (par paires : +bruit et −bruit). Le groupe de variantes d’une génération s’appelle la <em>population</em>. Chaque variante
          fait un essai de 10 s et reçoit un score. On déplace ensuite le cerveau vers les variantes les mieux classées.
          Aucune leçon pas à pas : seul compte le score final de chaque essai. Les essais sont répartis sur plusieurs
          Web Workers pour ne pas figer la page.</li>
        <li><strong>Le score.</strong>
          <span class="formula walker-formula-inline">score = distance − énergie × poids ÷ 100 − pénalité si chute − poids × inclinaison moyenne</span>
          La distance est en mètres, l’énergie en joules (travail mécanique des moteurs : |couple × vitesse| additionné
          au fil du temps). L’essai s’arrête si le torse touche le sol ou penche de plus d’environ 70°.</li>
        <li><strong>Pourquoi des démarches bizarres ?</strong> Le score ne dit jamais « marche comme un humain ».
          Sautiller, traîner une jambe, avancer à petits pas pressés : tout ce qui avance sans tomber est bon à prendre.
          Et l’évolution améliore pas à pas le cerveau actuel : une fois un style trouvé, elle le perfectionne plutôt
          que d’en inventer un autre. Deux entraînements partis de hasards différents donnent souvent deux démarches différentes.</li>
        <li><strong>Blessure et adaptation.</strong> Bloquer un genou change la physique, pas le cerveau : ses ordres au
          genou ne servent plus à rien et le rythme appris ne convient plus. « Réapprendre » repart du cerveau actuel,
          qui sait déjà garder l’équilibre et tenir un rythme : il suffit souvent de quelques dizaines de générations
          pour retrouver une démarche correcte, alors que « Repartir de zéro » doit tout redécouvrir. Revers de la médaille :
          le cerveau adapté se spécialise. Remis sur un robot intact, il marche moins bien qu’avant la blessure.</li>
        <li><strong>Limites honnêtes.</strong> Moteurs idéalisés, un seul terrain, aucune perturbation : un cerveau appris ici
          ne ferait pas marcher un vrai robot sans beaucoup d’autres précautions. L’« énergie » est le travail des moteurs,
          pas la consommation d’une vraie batterie.</li>
      </ul>
    </section>
  </div>
</div>`;
