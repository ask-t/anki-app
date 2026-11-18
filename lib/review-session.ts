import type { MasteryLevel } from "./study-order.ts";

export type SwipeRating = "Again" | "Good";
export type StudyCard = { id: string; word: string };
export type StudyBatch<T extends StudyCard> = {
  queue: T[];
  remaining: T[];
  total: number;
  done: number;
  step: number;
  tally: Record<SwipeRating, number>;
  completed: Record<string, { word: string; level: MasteryLevel; attempts: number }>;
};

export function makeBatch<T extends StudyCard>(ordered: T[]): StudyBatch<T> {
  const queue = ordered.slice(0, 10);
  return { queue, remaining: ordered.slice(10), total: queue.length, done: 0, step: 0, tally: { Again: 0, Good: 0 }, completed: {} };
}

export function answer<T extends StudyCard>(state: StudyBatch<T>, rating: SwipeRating): StudyBatch<T> {
  const current = state.queue[0];
  if (!current) return state;
  const rest = state.queue.slice(1);
  if (rating === "Again") rest.push(current);
  return { ...state, queue: rest, done: state.done + (rating === "Good" ? 1 : 0), step: state.step + 1,
    tally: { ...state.tally, [rating]: state.tally[rating] + 1 } };
}

// Roll back an optimistic answer only after the server has reported a failure.
export function restoreAnswer<T extends StudyCard>(state: StudyBatch<T>, card: T, rating: SwipeRating): StudyBatch<T> {
  return { ...state, queue: [...state.queue.filter((item) => item.id !== card.id), card],
    done: Math.max(0, state.done - (rating === "Good" ? 1 : 0)),
    tally: { ...state.tally, [rating]: state.tally[rating] - 1 } };
}
