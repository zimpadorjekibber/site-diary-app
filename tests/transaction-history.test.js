import test from 'node:test';
import assert from 'node:assert/strict';
import { transactionHistory, filterRecipient } from '../src/workflow-model.js';

const transactions = [
  {id:'a', date:'2026-09-20', workerId:'ram', targetType:'individual', type:'cash', amount:500},
  {id:'b', date:'2026-09-22', workerId:'ram', targetType:'individual', type:'cash', amount:700},
  {id:'c', date:'2026-09-22', workerId:'shyam', targetType:'individual', type:'cash', amount:900},
  {id:'d', date:'2026-09-22', tradeId:'mason', targetType:'group', type:'ration', rationItem:'Rice', quantity:'10 kg', amount:400},
  {id:'e', date:'2026-09-22', tradeId:'mason', targetType:'group', type:'cylinder', quantity:'1', amount:1000},
  {id:'f', date:'2026-09-21', tradeId:'painter', targetType:'group', type:'ration', amount:300},
  {id:'g', date:'2026-09-21', tradeId:'mason', targetType:'group', type:'ration', quantity:'2 kg', amount:0},
];
test('recipient filters isolate a group from its individuals and reset to all', () => {
  assert.equal(filterRecipient(transactions).length, 7);
  assert.equal(filterRecipient(transactions, 'individual').length, 3);
  assert.equal(filterRecipient(transactions, 'group').length, 4);
  assert.deepEqual(filterRecipient(transactions, 'individual', 'ram').map(t => t.id), ['a','b']);
  assert.deepEqual(filterRecipient(transactions, 'group', 'mason').map(t => t.id), ['d','e','g']);
  assert.equal(filterRecipient(transactions, 'group', 'missing').length, 0);
});
test('worker history spans all dates, isolates people and sorts newest day first', () => {
  const result = transactionHistory(transactions, {targetType:'individual', recipientId:'ram'});
  assert.equal(result.total, 1200);
  assert.deepEqual(result.days.map(d => d.date), ['2026-09-22','2026-09-20']);
  assert.equal(result.count, 2);
  assert.equal(transactions[0].id, 'a');
});
test('group history includes quantity-only supplies and separates other groups and individuals', () => {
  const result = transactionHistory(transactions, {targetType:'group', recipientId:'mason'});
  assert.equal(result.count, 3);
  assert.equal(result.total, 1400);
  assert.equal(result.days[0].total, 1400);
  assert.equal(result.days[0].entries[0].quantity, '10 kg');
  assert.equal(result.days[1].entries[0].amount, 0);
});
test('date boundaries and item type filters apply to both entries and totals', () => {
  const result = transactionHistory(transactions, {targetType:'group', recipientId:'mason', from:'2026-09-22', to:'2026-09-22', type:'ration'});
  assert.equal(result.total, 400);
  assert.equal(result.count, 1);
  assert.equal(transactionHistory(transactions, {targetType:'individual', recipientId:'missing'}).count, 0);
});
