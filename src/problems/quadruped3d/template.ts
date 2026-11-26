// Gabarit HTML du robot 3D. Tous les identifiants sont préfixés par « quadruped3d- ».
// Les chiffres marqués {{…}} sont remplacés au montage (voir index.ts) par ceux des cerveaux livrés.
export const TEMPLATE = `
<section class="quadruped3d-start" aria-label="Commencez ici">
  <p class="quadruped3d-start-title">Commencez ici</p>
  <ol>
    <li>Le robot marche déjà : chaque patte a son propre <strong>métronome</strong>, décalé comme un trot, et un petit
      réseau de neurones a appris à l’avance à les régler. Environ {{healthy}} en 8&nbsp;s.</li>
    <li>Ouvrez les <strong>Moments clés</strong> sous le robot : cliquez sur « Génération 0 » puis sur les suivantes
      pour revoir comment il a appris à marcher.</li>
    <li>Cliquez sur <button type="button" id="quadruped3d-start-injury" class="primary quadruped3d-start-btn">Casser une patte</button>
      puis sur <strong>Réapprendre</strong>. Il boite ({{broken0}}), puis la distance remonte en quelques dizaines de
      <em>générations</em> (à chaque génération, 24 variantes du cerveau sont essayées).</li>
  </ol>
  <p class="quadruped3d-start-key"><strong>L’idée clé :</strong> même recette que le <strong>Robot marcheur 2D</strong>
    (essayer des variantes au hasard, garder ce qui avance), mais en 3D, avec un rythme de marche « inné » que
    l’apprentissage n’a plus qu’à régler. <strong>Sa limite :</strong> chaque essai coûte beaucoup de calcul.</p>
</section>
<div class="layout quadruped3d-root">
  <div class="col">
    <section class="panel" aria-label="Robot en 3D">
      <p class="quadruped3d-badge"><strong>Expérimental.</strong> Chaque essai simule 8 secondes de physique 3D complète.
        Les essais sont répartis sur <span id="quadruped3d-cores">plusieurs</span> fils de calcul de votre appareil ;
        selon sa puissance, comptez de une à quelques générations par seconde.</p>
      <div class="quadruped3d-stage" id="quadruped3d-stage">
        <div class="quadruped3d-hud" id="quadruped3d-hud" aria-live="off"></div>
        <div class="quadruped3d-viewing" id="quadruped3d-viewing" hidden>
          <span id="quadruped3d-viewing-text"></span>
          <button type="button" id="quadruped3d-live" class="primary">Revenir au direct</button>
        </div>
        <p class="quadruped3d-turbo" id="quadruped3d-turbo" hidden>Mode turbo : l’animation est en pause pour laisser tout le
          calcul à l’apprentissage. Les chiffres et la courbe continuent d’avancer.</p>
        <p class="quadruped3d-loading" id="quadruped3d-loading">Chargement du moteur physique…</p>
      </div>
      <p class="help">Faites glisser pour tourner autour du robot, molette ou pincement pour zoomer. La bande verte marque l’avant.</p>

      <div class="controls">
        <button id="quadruped3d-btn-train" class="primary">Réapprendre</button>
        <button id="quadruped3d-btn-replay">Rejouer l’essai</button>
        <button id="quadruped3d-btn-pretrained">Cerveau pré-entraîné</button>
        <button id="quadruped3d-btn-scratch">Repartir de zéro</button>
      </div>
      <div class="quadruped3d-speed" role="radiogroup" aria-label="Vitesse d’apprentissage" id="quadruped3d-speed">
        <span class="quadruped3d-speed-label">Vitesse d’apprentissage</span>
      </div>
      <p class="help" id="quadruped3d-speed-help"></p>

      <dl class="stats">
        <div><dt>Génération</dt><dd id="quadruped3d-st-gen">0</dd></div>
        <div><dt>Distance (8 s)</dt><dd id="quadruped3d-st-dist">–</dd></div>
        <div title="Meilleure distance en 8 s depuis le dernier changement de cerveau ou de monde"><dt>Record</dt><dd id="quadruped3d-st-best">–</dd></div>
        <div><dt>Énergie (8 s)</dt><dd id="quadruped3d-st-energy">–</dd></div>
        <div title="Générations terminées par seconde (moyenne récente)"><dt>Vitesse</dt><dd id="quadruped3d-st-speed">–</dd></div>
      </dl>
      <p id="quadruped3d-status" class="status" role="status"></p>
    </section>

    <section class="panel" aria-label="Moments clés">
      <h2>Moments clés : revoir l’évolution</h2>
      <p class="help">Pendant l’apprentissage, on met de côté le cerveau de certaines générations : la première, chaque cap de
        distance franchi, le premier essai sans chute, les records nets, et les générations juste avant et juste après chaque
        changement. Cliquez sur un moment pour le revoir : l’apprentissage continue pendant ce temps.</p>
      <ol class="quadruped3d-moments" id="quadruped3d-moments"></ol>
      <div class="quadruped3d-scrub">
        <div class="slider-head"><label for="quadruped3d-scrub">Parcourir les générations gardées</label>
          <output for="quadruped3d-scrub" id="quadruped3d-scrub-out">–</output></div>
        <input type="range" id="quadruped3d-scrub" min="0" max="0" step="1" value="0" />
      </div>
      <div class="quadruped3d-compare">
        <label for="quadruped3d-ghost">Comparer avec un fantôme (robot gris, couloir voisin)</label>
        <select id="quadruped3d-ghost"></select>
        <button type="button" id="quadruped3d-compare-quick">Comparer le début et la fin</button>
      </div>
    </section>

    <section class="panel" aria-label="Progrès de l’apprentissage">
      <h2>Progrès de l’apprentissage</h2>
      <canvas id="quadruped3d-chart" class="quadruped3d-chart" aria-label="Distance parcourue en 8 secondes à chaque génération"></canvas>
      <p class="help">
        Points : distance parcourue en 8 s par le cerveau de chaque génération. Ligne pleine : moyenne sur les 10 dernières générations.
        Pointillés : la note (la « récompense » que l’apprentissage cherche à augmenter) : distance moins les pénalités d’énergie,
        d’inclinaison et de chute. Quand la ligne pleine ne monte plus, l’apprentissage a fini de progresser.
      </p>
    </section>

    <section class="panel" aria-label="Perceptions et commandes">
      <h2>Ce que le robot perçoit et commande</h2>
      <canvas id="quadruped3d-brain" class="quadruped3d-brain" aria-label="Métronomes des pattes, entrées et sorties du cerveau, en direct"></canvas>
      <p class="help">
        En haut, les <strong>4 métronomes</strong>, un par patte : l’aiguille tourne au tempo de la marche, décalée d’une
        patte à l’autre (les pattes en diagonale battent ensemble, comme au trot) ; sa longueur montre l’amplitude du
        mouvement de la hanche. Au milieu, les 20 nombres que reçoit le réseau correcteur : le rythme, la direction de la
        gravité vue depuis le tronc (pour savoir s’il penche), la vitesse et la rotation du tronc, sa hauteur, l’angle des
        8 articulations. En bas, pour chaque hanche (h) et genou (g) : la part du <strong>rythme</strong> (barre large),
        la <strong>correction</strong> du réseau (barre fine, au plus 30&nbsp;%) et la consigne finale (trait).
        Av/Ar = avant/arrière, G/D = gauche/droite. Un trait rouge : articulation absente ou bloquée.
      </p>
    </section>
  </div>

  <div class="col">
    <section class="panel" aria-label="Interventions">
      <h2>Interventions sur le robot et le monde</h2>
      <p class="help">
        Cochez une intervention : le robot recommence aussitôt avec le <em>même</em> cerveau, et vous voyez ce que ça casse.
        Cliquez ensuite sur « Réapprendre » pour que l’évolution adapte ce cerveau à la nouvelle situation.
      </p>
      <div class="quadruped3d-interventions" id="quadruped3d-interventions"></div>
    </section>

    <section class="panel" aria-label="Objectifs de l’agent">
      <h2>Personnalité et objectifs</h2>
      <p class="help">Ces réglages changent ce que l’on récompense ou la façon d’explorer. Ils agissent pendant l’apprentissage, pas sur le cerveau déjà appris.</p>
      <div class="quadruped3d-traits" id="quadruped3d-traits"></div>
    </section>

    <section class="panel" aria-label="Scénarios">
      <h2>Scénarios</h2>
      <p class="help">Chaque scénario prépare le robot, son monde et son cerveau, puis vous dit quoi observer.</p>
      <div class="presets" id="quadruped3d-scenarios"></div>
      <p id="quadruped3d-scenario-info" class="preset-info">Choisissez un scénario pour commencer, ou regardez simplement le robot marcher.</p>
      <details class="expert" id="quadruped3d-expert">
        <summary>Paramètres experts</summary>
        <div id="quadruped3d-sliders" class="sliders"></div>
      </details>
    </section>

    <section class="panel explain-panel">
      <h2>Comment ça marche ?</h2>
      <p>
        Le robot est simulé par un vrai moteur physique 3D (Rapier) : un tronc et quatre pattes de deux segments, reliés par
        8 articulations motorisées (une hanche et un genou par patte), qui pivotent d’avant en arrière. Chaque moteur reçoit une
        <strong>consigne d’angle</strong> et pousse comme un ressort amorti pour l’atteindre, avec un couple limité.
      </p>
      <p>
        <strong>Chaque patte a son propre métronome, décalé comme un trot</strong> : avant gauche et arrière droite battent
        ensemble, l’autre diagonale à contretemps. À chaque battement, la hanche va et vient et le genou plie un peu plus tard,
        pour lever le pied quand la patte revient vers l’avant. Les animaux ont un tel <em>générateur de rythme</em> dans la
        moelle épinière : ils n’ont pas à réinventer la marche à chaque pas.
      </p>
      <p>
        Le « cerveau » apprend à <strong>régler</strong> ces métronomes : le tempo, l’amplitude et la position de repos de
        chaque hanche et de chaque genou, le retard du genou, le décalage de chaque patte (environ 30 réglages, communs aux
        4 pattes ou propres à chacune). Un petit <strong>réseau de neurones</strong> (20 entrées → 8 neurones → 8 sorties)
        ajoute des corrections limitées à 30&nbsp;% du débattement, selon ce que le robot ressent : il penche, il tourne,
        il s’affaisse… C’est lui qui garde l’équilibre et la direction.
      </p>
      <p>Il n’y a pas de professeur : seule une note (la <strong>récompense</strong>) est donnée à la fin de chaque essai de 8 secondes.
        Apprendre par essais et erreurs à partir d’une telle note, c’est le principe du <em>reinforcement learning</em>
        (apprentissage par renforcement).</p>
      <p class="formula">note = distance − a·énergie − b·inclinaison − chute</p>
      <ul>
        <li><strong>Stratégie d’évolution</strong> : à chaque génération, on crée 24 variantes du cerveau en ajoutant un petit
          bruit aléatoire à tous ses réglages (par paires opposées +bruit / −bruit), on les essaie toutes, puis on déplace le
          cerveau vers les variantes les mieux classées. Aucune dérivée de la physique n’est nécessaire.</li>
        <li><strong>Pourquoi des métronomes ?</strong> Une version précédente laissait un réseau libre inventer tous les gestes à
          partir d’une seule horloge. Elle avait trouvé une démarche où les pattes avant tiraient le robot pendant que
          l’arrière droite traînait presque immobile : une solution « qui marche », mais un piège dont l’évolution ne sortait
          plus. Avec un métronome par patte, toutes les pattes participent dès le départ, et il y a beaucoup moins de
          réglages à trouver : l’apprentissage va bien plus vite.</li>
        <li><strong>En parallèle</strong> : les 25 essais d’une génération sont répartis entre plusieurs fils de calcul
          (workers) de votre appareil. Le résultat ne dépend pas de leur nombre : chaque variante est notée à sa place.</li>
        <li><strong>Énergie</strong> : estimée en additionnant, à chaque instant, |couple × vitesse de rotation| de chaque moteur.
          C’est le travail mécanique des moteurs, pas leur consommation électrique réelle.</li>
        <li><strong>Inclinaison</strong> : angle moyen entre le dos du robot et l’horizontale. Une chute (tronc trop penché ou trop bas)
          arrête l’essai.</li>
        <li><strong>Pourquoi un cerveau sain échoue après une blessure ?</strong> Ses réglages conviennent à <em>son</em> corps.
          Avec une patte en moins ou un genou raide, les mêmes gestes déséquilibrent le robot. L’évolution repart du cerveau
          existant et ajuste ce qui sait déjà presque marcher : l’amplitude ou le décalage d’une patte, la posture, le tempo.</li>
        <li><strong>Ses limites.</strong> Chaque essai demande 480 pas de physique 3D (8 s à 60 images par seconde), bien plus
          coûteux qu’en 2D. Deux apprentissages de zéro n’aboutissent pas toujours à la même démarche, et il arrive qu’un essai
          reste coincé un moment (le robot se jette en avant et tombe, ou piétine sans avancer). Les chercheurs entraînent ce
          genre de robot sur des milliers d’essais en parallèle ; ici tout tourne dans votre navigateur.</li>
        <li><strong>Pré-entraînement</strong> : le cerveau chargé au départ a été entraîné hors ligne avec exactement la même
          simulation ({{healthyGen}} générations), et quelques générations intermédiaires ont été gardées : ce sont les moments
          « hors ligne » de la frise. La simulation est déterministe : un même cerveau refait exactement le même essai.</li>
      </ul>
    </section>
  </div>
</div>
`;
