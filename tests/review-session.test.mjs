import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBatch, answer, restoreAnswer } from '../lib/review-session.ts';

test('only ten unique cards start, and forgotten cards return until mastered', () => {
 const cards=Array.from({length:13},(_,i)=>({id:String(i),word:`word-${i}`}));
 let batch=makeBatch(cards);
 assert.equal(batch.total,10); assert.equal(batch.remaining.length,3);
 batch=answer(batch,'Again');
 assert.equal(batch.done,0); assert.equal(batch.queue.length,10); assert.equal(batch.queue.at(-1).id,'0');
 for(let i=0;i<9;i++) batch=answer(batch,'Good');
 assert.equal(batch.done,9); assert.equal(batch.queue[0].id,'0');
 batch=answer(batch,'Again'); assert.equal(batch.done,9); assert.equal(batch.queue.length,1);
 batch=answer(batch,'Good'); assert.equal(batch.done,10); assert.equal(batch.queue.length,0);
 assert.deepEqual(batch.tally,{Again:2,Good:10});
 assert.equal(makeBatch(batch.remaining).total,3);
});

test('a failed save restores a card without duplication or false completion', () => {
 const card={id:'a',word:'test'};
 let batch=makeBatch([card]);
 batch=answer(batch,'Again'); batch=restoreAnswer(batch,card,'Again');
 assert.equal(batch.queue.length,1); assert.equal(batch.done,0); assert.equal(batch.tally.Again,0);
 batch=answer(batch,'Good'); batch=restoreAnswer(batch,card,'Good');
 assert.equal(batch.queue.length,1); assert.equal(batch.done,0); assert.equal(batch.tally.Good,0);
});
