import type { ProblemInfo } from '../shared/types';

// Ordre = progression pédagogique conseillée.
export const PROBLEMS: ProblemInfo[] = [
  {
    id: 'bandit',
    title: 'Machines à sous',
    tagline: 'Quelle machine rapporte le plus ? Il faut jouer pour le savoir.',
    concept: 'Le dilemme exploration / exploitation, à l’état pur.',
    algorithms: 'ε-greedy, UCB, Thompson',
    level: 'Découverte',
    load: () => import('./bandit/index'),
  },
  {
    id: 'grid',
    title: 'Labyrinthe',
    tagline: 'Un agent apprend à rejoindre l’arrivée en évitant les pièges.',
    concept: 'Valeurs apprises case par case, récompenses retardées.',
    algorithms: 'Q-learning, SARSA',
    level: 'Découverte',
    load: () => import('./grid/index'),
  },
  {
    id: 'cartpole',
    title: 'Pendule inversé',
    tagline: 'Garder un bâton en équilibre sur un chariot.',
    concept: 'États continus : un réseau de neurones remplace le tableau.',
    algorithms: 'Stratégie d’évolution, REINFORCE',
    level: 'Intermédiaire',
    load: () => import('./cartpole/index'),
  },
  {
    id: 'mountaincar',
    title: 'Voiture dans la vallée',
    tagline: 'Trop faible pour monter d’un coup : il faut prendre de l’élan.',
    concept: 'Récompense rare et stratégie contre-intuitive (reculer pour avancer).',
    algorithms: 'Q-learning avec tuiles, curiosité',
    level: 'Intermédiaire',
    load: () => import('./mountaincar/index'),
  },
  {
    id: 'walker',
    title: 'Robot marcheur 2D',
    tagline: 'Un robot apprend à marcher. Blessez-le : il invente une autre démarche.',
    concept: 'Contrôle moteur, objectifs de haut niveau, adaptation à une blessure.',
    algorithms: 'Neuroévolution (stratégie d’évolution)',
    level: 'Avancé',
    load: () => import('./walker/index'),
  },
  {
    id: 'quadruped3d',
    title: 'Robot 3D',
    tagline: 'Un robot à quatre pattes en 3D, avec physique réaliste.',
    concept: 'Le même principe que le marcheur 2D, dans un monde en trois dimensions.',
    algorithms: 'Neuroévolution (stratégie d’évolution)',
    level: 'Expérimental',
    load: () => import('./quadruped3d/index'),
  },
];
