import test from 'node:test';
import assert from 'node:assert/strict';
import { freshGame, place, progress, gather, growLight, parseSave, GATHER_DELAY } from '../src/game.js';

test('placing spends exact light and leaves prior state unchanged', () => {
  const original = freshGame();
  const result = place(original, 0, 'tree');
  assert.equal(result.success, true);
  assert.equal(result.state.light, 28);
  assert.equal(result.state.tiles[0].type, 'tree');
  assert.equal(original.tiles[0].type, 'empty');
  assert.equal(original.light, 36);
});

test('occupied cells, protected nature, insufficient funds and invalid targets cannot alter the game', () => {
  const original = freshGame();
  for (const [index, tool] of [[7, 'tree'], [15, 'erase'], [-1, 'tree'], [100, 'tree'], [0, 'invalid'], [0, 'toString'], [0, '__proto__']]) {
    const result = place(original, index, tool);
    assert.equal(result.success, false);
    assert.equal(result.state, original);
  }
  const emptyWallet = { ...original, light: 4 };
  assert.equal(place(emptyWallet, 0, 'flower').state, emptyWallet);
  assert.equal(place(original, 44, 'tree').gather, true);
});

test('erase refunds half and lowers current garden progress', () => {
  const planted = place(freshGame(), 0, 'flower').state;
  assert.equal(progress(planted).counts.flower, 1);
  const removed = place(planted, 0, 'erase').state;
  assert.equal(removed.light, 33);
  assert.equal(progress(removed).counts.flower, 0);
});

test('all three garden goals are needed; existing trees do not count', () => {
  let state = { ...freshGame(), light: 500 };
  assert.deepEqual(progress(state).counts, { tree: 0, flower: 0, lantern: 0 });
  for (const [type, amount] of [['tree', 5], ['flower', 6], ['lantern', 4]]) {
    for (let i = 0; i < amount; i++) state = place(state, state.tiles.findIndex(t => t.type === 'empty'), type).state;
  }
  assert.equal(progress(state).done, true);
  assert.equal(progress(state).fraction, 1);
});

test('gather cooldown blocks repeated requests and passive generation is capped', () => {
  const first = gather(freshGame(), 100000);
  assert.equal(first.state.light, 42);
  assert.equal(gather(first.state, 100001).success, false);
  assert.equal(gather(first.state, 100000 + GATHER_DELAY).success, true);
  assert.equal(growLight({ ...first.state, light: 9999 }).light, 9999);
});

test('saves round trip but malformed schema and impossible boards are rejected', () => {
  const original = freshGame();
  assert.deepEqual(parseSave(JSON.stringify(original)), original);
  for (const raw of ['{', 'null', '{}', JSON.stringify({ ...original, light: -1 }), JSON.stringify({ ...original, tiles: [] }), JSON.stringify({ ...original, lastGather: 'yesterday' }), JSON.stringify({ ...original, version: 2 })]) assert.equal(parseSave(raw), null);
  const malformed = freshGame();
  malformed.tiles[0].type = 'unknown';
  assert.equal(parseSave(JSON.stringify(malformed)), null);
  const shrineMissing = freshGame();
  shrineMissing.tiles[44].type = 'empty';
  assert.equal(parseSave(JSON.stringify(shrineMissing)), null);
  const unprotectedRock = freshGame();
  unprotectedRock.tiles[15] = { type: 'rock' };
  assert.equal(parseSave(JSON.stringify(unprotectedRock)), null);
  const injectedRock = freshGame();
  injectedRock.tiles[0] = { type: 'rock' };
  assert.equal(parseSave(JSON.stringify(injectedRock)), null);
  const injectedNature = freshGame();
  injectedNature.tiles[0] = { type: 'tree', natural: true };
  assert.equal(parseSave(JSON.stringify(injectedNature)), null);
});

test('reset creates independent starting gardens', () => {
  const first = freshGame();
  first.tiles[0].type = 'flower';
  assert.equal(freshGame().tiles[0].type, 'empty');
  assert.equal(freshGame().victorySeen, false);
});
