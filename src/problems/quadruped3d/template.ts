// Gabarit HTML du robot 3D. Tous les identifiants sont préfixés par « quadruped3d- ».
export const TEMPLATE = `
<section class="quadruped3d-start" aria-label="Commencez ici">
  <p class="quadruped3d-start-title">Commencez ici</p>
  <ol>
    <li>Le robot marche déjà : son « cerveau » (un petit réseau de neurones) a appris à l’avance. Environ 9&nbsp;m en 8&nbsp;s.</li>
    <li>Cliquez sur <button type="button" id="quadruped3d-start-injury" class="primary quadruped3d-start-btn">Casser une patte</button>
      puis sur <strong>Réapprendre</strong>. Il boite (environ 1&nbsp;m), puis la distance remonte vers 5 à 7&nbsp;m en 20 à 50
      <em>générations</em> (à chaque génération, 24 variantes du cerveau sont essayées), soit moins d’une minute.</li>
    <li>Quand la <strong>courbe</strong> ne monte plus, l’adaptation est faite.</li>
  </ol>
  <p class="quadruped3d-start-key"><strong>L’idée clé :</strong> même recette que le <strong>Robot marcheur 2D</strong>
    (essayer des variantes au hasard, garder ce qui avance), mais en 3D. <strong>Sa limite :</strong> chaque essai coûte
    beaucoup de calcul, donc apprendre de zéro prend des minutes, d’où le cerveau entraîné à l’avance.</p>
</section>
<div class="layout quadruped3d-root">
  <div class="col">
    <section class="panel" aria-label="Robot en 3D">
      <p class="quadruped3d-badge"><strong>Expérimental.</strong> Chaque essai simule 8 secondes de physique 3D complète :
        une à deux générations par seconde seulement, selon votre appareil.</p>
      <div class="quadruped3d-stage" id="quadruped3d-stage">
        <div class="quadruped3d-hud" id="quadruped3d-hud" aria-live="off"></div>
        <p class="quadruped3d-loading" id="quadruped3d-loading">Chargement du moteur physique…</p>
      </div>
      <p class="help">Faites glisser pour tourner autour du robot, molette ou pincement pour zoomer. La bande verte marque l’avant.</p>

      <div class="controls">
        <button id="quadruped3d-btn-train" class="primary">Réapprendre</button>
        <button id="quadruped3d-btn-replay">Rejouer l’essai</button>
        <button id="quadruped3d-btn-pretrained">Cerveau pré-entraîné</button>
        <button id="quadruped3d-btn-scratch">Repartir de zéro</button>
      </div>

      <dl class="stats">
        <div><dt>Génération</dt><dd id="quadruped3d-st-gen">0</dd></div>
        <div><dt>Distance (8 s)</dt><dd id="quadruped3d-st-dist">–</dd></div>
        <div title="Meilleure distance en 8 s depuis le dernier changement de cerveau ou de monde"><dt>Record</dt><dd id="quadruped3d-st-best">–</dd></div>
        <div><dt>Énergie (8 s)</dt><dd id="quadruped3d-st-energy">–</dd></div>
      </dl>
      <p id="quadruped3d-status" class="status" role="status"></p>
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
      <canvas id="quadruped3d-brain" class="quadruped3d-brain" aria-label="Entrées et sorties du réseau de neurones, en direct"></canvas>
      <p class="help">
        En haut, les 20 nombres que reçoit le réseau à chaque instant : son horloge interne (sinus et cosinus du rythme),
        la direction de la gravité vue depuis le tronc (pour savoir s’il penche), la vitesse et la rotation du tronc, sa hauteur,
        et l’angle de ses 8 articulations. En bas, les 8 consignes d’angle qu’il envoie aux moteurs des hanches (h) et des genoux (g)
        de chaque patte (Av/Ar = avant/arrière, G/D = gauche/droite). Un trait rouge : articulation absente ou bloquée.
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
        Le « cerveau » est un petit réseau de neurones (20 entrées → 24 neurones → 8 sorties, environ 700 poids).
        Parmi ses entrées, une <strong>horloge interne</strong> (sinus et cosinus d’un rythme à 1,6 Hz) joue le rôle d’un
        générateur de rythme, comme les circuits de la moelle épinière qui cadencent la marche des animaux :
        le réseau n’a plus qu’à apprendre quelle posture prendre à chaque instant du cycle, corrigée par ce qu’il ressent.
      </p>
      <p>Il n’y a pas de professeur : seule une note (la <strong>récompense</strong>) est donnée à la fin de chaque essai de 8 secondes.
        Apprendre par essais et erreurs à partir d’une telle note, c’est le principe du <em>reinforcement learning</em>
        (apprentissage par renforcement).</p>
      <p class="formula">note = distance − a·énergie − b·inclinaison − chute</p>
      <ul>
        <li><strong>Stratégie d’évolution</strong> : à chaque génération, on crée des variantes du cerveau en ajoutant un petit
          bruit aléatoire à tous ses poids (par paires opposées +bruit / −bruit), on les essaie toutes, puis on déplace le cerveau
          vers les variantes les mieux classées. Aucune dérivée de la physique n’est nécessaire.</li>
        <li><strong>Énergie</strong> : estimée en additionnant, à chaque instant, |couple × vitesse de rotation| de chaque moteur.
          C’est le travail mécanique des moteurs, pas leur consommation électrique réelle.</li>
        <li><strong>Inclinaison</strong> : angle moyen entre le dos du robot et l’horizontale. Une chute (tronc trop penché ou trop bas)
          arrête l’essai.</li>
        <li><strong>Pourquoi un cerveau sain échoue après une blessure ?</strong> Il a appris des gestes adaptés à <em>son</em> corps.
          Avec une patte en moins ou un genou raide, ces mêmes gestes déséquilibrent le robot. L’évolution repart du cerveau
          existant : elle ne réinvente pas tout, elle ajuste ce qui sait déjà presque marcher, ce qui va bien plus vite que de zéro.</li>
        <li><strong>Même principe qu’en 2D, et ses limites.</strong> L’algorithme est le même que pour le Robot marcheur 2D ; seuls
          le corps et le monde changent. Mais une génération demande ici 25 essais de 480 pas de physique 3D (8 s à 60 images par
          seconde), et chaque pas de physique 3D coûte bien plus cher qu’en 2D : partir de zéro demande une centaine de générations ou plus avant une
          vraie démarche, et deux apprentissages identiques en apparence n’aboutissent pas à la même démarche. Les chercheurs
          entraînent ce genre de robot sur des milliers d’essais en parallèle ; ici tout tourne dans votre navigateur.</li>
        <li><strong>Pré-entraînement</strong> : le cerveau chargé au départ a été entraîné hors ligne avec exactement la même
          simulation, puis enregistré (environ 25 minutes de calcul). Sa généalogie est instructive : appris de zéro sur le robot intact,
          puis adapté à la patte cassée, puis réadapté au robot intact ; ce détour lui a fait découvrir une démarche plus rapide que celle
          trouvée directement. La simulation est déterministe : un même cerveau refait exactement le même essai.</li>
      </ul>
    </section>
  </div>
</div>
`;
