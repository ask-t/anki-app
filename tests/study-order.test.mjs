import test from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeCards } from '../lib/study-order.ts';
import { schedule } from '../lib/scheduling.ts';

test('difficulty prioritizes less familiar cards without dropping or duplicating any', () => {
 const cards = [ { id: 'easy', repetitions: 9, ease_factor: 3, interval_days: 20, due_at: '' }, { id: 'hard', repetitions: 0, ease_factor: 1.3, interval_days: 0, due_at: '' } ];
 assert.deepEqual(prioritizeCards(cards, () => .5).map(c => c.id), ['hard', 'easy']);
 assert.deepEqual(cards.map(c => c.id), ['easy','hard']);
});
test('forgotten cards become due earlier than easy cards', () => {
 const now = new Date('2026-01-01T00:00:00Z');
 assert.ok(schedule('Again', 3, 10, 2.5, now).due_at < schedule('Easy', 3, 10, 2.5, now).due_at);
});
