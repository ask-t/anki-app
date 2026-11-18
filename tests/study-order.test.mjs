import test from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeCards } from '../lib/study-order.ts';

test('difficulty prioritizes less familiar cards without dropping or duplicating any', () => {
 const cards = [ { id: 'easy', repetitions: 9, ease_factor: 3, interval_days: 20, due_at: '' }, { id: 'hard', repetitions: 0, ease_factor: 1.3, interval_days: 0, due_at: '' } ];
 assert.deepEqual(prioritizeCards(cards, () => .5).map(c => c.id), ['hard', 'easy']);
 assert.deepEqual(cards.map(c => c.id), ['easy','hard']);
});
test('more overdue cards and harder categories are prioritized, without duplication', () => {
 const now = Date.parse('2026-01-11T00:00:00Z');
 const base = { repetitions: 1, ease_factor: 2.5, interval_days: 1, last_reviewed_at: '2026-01-09T00:00:00Z' };
 const cards = [ { ...base, id: 'fresh', due_at: '2026-01-11T00:00:00Z', mastery_level: 'perfect' }, { ...base, id: 'late', due_at: '2026-01-10T00:00:00Z', mastery_level: 'difficult' } ];
 assert.deepEqual(prioritizeCards(cards, () => .5, now).map(c => c.id), ['late', 'fresh']);
});

test('an unfinished relearning cycle raises priority even if the previous category was perfect', () => {
 const base = { repetitions: 0, ease_factor: 2.5, interval_days: 0, due_at: '2026-01-10T00:00:00Z', mastery_level: 'perfect' };
 const cards = [ { ...base, id: 'finished', review_failures: 0 }, { ...base, id: 'retry', review_failures: 2 } ];
 assert.deepEqual(prioritizeCards(cards, () => .5, Date.parse('2026-01-10T00:00:00Z')).map(c => c.id), ['retry', 'finished']);
});
