import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/storage.js';

/* The उधार form offers people already in the register to pick from, so a
   repeat lender is not typed again and does not turn into two people. */

function register(lending) {
  return new Store({ persist: false, data: { projects: [{ id: 'job', name: 'Test job' }], activeProjectId: 'job', lending } });
}

test('each person appears once, most recent first, whatever the spelling case', () => {
  const s = register([]);
  s.addLending({ direction: 'given', kind: 'item', personName: 'Test Person A', itemName: 'Drum' });
  s.addLending({ direction: 'taken', kind: 'money', personName: 'Test Person B', amount: 500 });
  s.addLending({ direction: 'given', kind: 'item', personName: '  test person a ', itemName: 'Farma' });

  assert.deepEqual(s.getLendingPeople().map(p => p.name), ['test person a', 'Test Person B']);
});

test('the phone comes from the latest entry that has one', () => {
  const s = register([]);
  s.addLending({ direction: 'given', kind: 'item', personName: 'Test Person A', phone: '0000000001', itemName: 'Drum' });
  s.addLending({ direction: 'given', kind: 'item', personName: 'Test Person A', itemName: 'Farma' });

  assert.equal(s.getLendingPeople()[0].phone, '0000000001');
});

test('an empty register has nobody to pick', () => {
  assert.deepEqual(register([]).getLendingPeople(), []);
});
