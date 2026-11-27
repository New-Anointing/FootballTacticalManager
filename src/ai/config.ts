/** Model used by the optional AI coach. Kept separate so the SDK loads only when needed. */
export const AI_MODEL = 'claude-opus-5-5';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}
