import type { ProblemContent } from './types';
import { CONTENT as bandit } from './bandit';
import { CONTENT as grid } from './grid';
import { CONTENT as cartpole } from './cartpole';
import { CONTENT as mountaincar } from './mountaincar';
import { CONTENT as walker } from './walker';
import { CONTENT as quadruped3d } from './quadruped3d';

export { APPLICATIONS } from './applications';
export type { Application, ProblemContent, ProfileAngle, RealWorldLink } from './types';

/** Contenu par profil de chaque problème (clé = id du registre). */
export const PROBLEM_CONTENT: Record<string, ProblemContent> = { bandit, grid, cartpole, mountaincar, walker, quadruped3d };
