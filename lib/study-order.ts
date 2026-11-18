export type MasteryLevel = "difficult" | "challenging" | "okay" | "perfect";
export type StudyPriority = {
  repetitions: number; ease_factor: number; interval_days: number; due_at: string;
  mastery_level?: MasteryLevel | null; last_reviewed_at?: string | null; review_failures?: number;
};

// Heuristic ordering for due cards, not a prediction of individual recall probability.
// Greater overdue time and the previous attempt category raise a card's priority.
export function prioritizeCards<T extends StudyPriority>(cards: T[], random: () => number = Math.random, now = Date.now()): T[] {
  const categoryWeight: Record<MasteryLevel, number> = { difficult: 3, challenging: 2, okay: 1.4, perfect: 1 };
  return cards.map((card) => {
    const due = Date.parse(card.due_at);
    const reviewed = card.last_reviewed_at ? Date.parse(card.last_reviewed_at) : NaN;
    const gap = Number.isFinite(reviewed) && Number.isFinite(due) ? Math.max(3_600_000, due - reviewed) : 86_400_000;
    const overdue = Number.isFinite(due) ? Math.max(0, now - due) / gap : 0;
    const priorDifficulty = card.mastery_level ? categoryWeight[card.mastery_level] : Math.max(0.7, Math.min(2, 2.5 / Math.max(1.3, card.ease_factor)));
    const difficulty = card.review_failures ? Math.max(priorDifficulty, Math.min(3, 1.5 + card.review_failures * .5)) : priorDifficulty;
    const familiarity = 1 / Math.sqrt(1 + Math.max(0, card.repetitions));
    const weight = Math.max(0.1, difficulty * familiarity * (1 + Math.min(3, overdue)));
    return { card, key: -Math.log(Math.max(Number.EPSILON, random())) / weight };
  }).sort((a, b) => a.key - b.key).map(({ card }) => card);
}
