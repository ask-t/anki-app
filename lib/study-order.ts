export type StudyPriority = { repetitions: number; ease_factor: number; interval_days: number; due_at: string };

// Weighted random ordering without replacement: every eligible card appears once,
// but cards with fewer successful repetitions and lower ease tend to appear earlier.
export function prioritizeCards<T extends StudyPriority>(cards: T[], random: () => number = Math.random): T[] {
  return cards.map((card) => {
    const difficulty = Math.max(0.5, Math.min(3, 2.5 / Math.max(1.3, card.ease_factor)));
    const familiarity = 1 / Math.sqrt(1 + Math.max(0, card.repetitions));
    const weight = Math.max(0.1, difficulty * familiarity);
    return { card, key: -Math.log(Math.max(Number.EPSILON, random())) / weight };
  }).sort((a, b) => a.key - b.key).map(({ card }) => card);
}
