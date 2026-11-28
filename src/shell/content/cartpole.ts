import type { ProblemContent } from './types';

const A = { intro: 'À rédiger.', watch: ['À rédiger.'], takeaway: 'À rédiger.' };

export const CONTENT: ProblemContent = {
  byProfile: { curieux: A, etudiant: A, dev: A, decideur: A },
  realWorld: [{ title: 'À rédiger', text: 'À rédiger.' }],
};
