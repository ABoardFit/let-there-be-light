import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZE, COLS, ROWS, STORAGE_KEY, freshGame, previewCard, validTargets, playCard, endTurn, parseSave } from '../src/game.js';

const card = (state, id) => state.hand.find(held => held.cardId === id).uid;
const sorted = array => [...array].sort((a, b) => a - b);
const allCards = state => [...state.hand, ...state.drawPile, ...state.discardPile];

test('fresh battle is deterministic with guaranteed starter cards and locked intent', () => {
  const state = freshGame();
  assert.deepEqual(state, freshGame());
  assert.equal(SIZE, 5); assert.equal(COLS, 5); assert.equal(ROWS, 5);
  assert.equal(STORAGE_KEY, 'let-there-be-light:battle:v1');
  assert.equal(state.energy, 3);
  assert.deepEqual(state.hand.map(held => held.cardId), ['lance', 'sweep', 'cross', 'step', 'guard']);
  assert.deepEqual(state.enemies[0].intent.tiles, [16]);
  assert.equal(allCards(state).length, 12);
});

test('straight and sweep patterns respect orientation, edges and range', () => {
  const state = freshGame();
  assert.deepEqual(previewCard(state, 'c1', 17).tiles, [17, 18, 19]);
  assert.deepEqual(previewCard(state, 'c1', 15).tiles, [15]);
  assert.deepEqual(previewCard(state, 'c1', 1).tiles, [11, 6, 1]);
  assert.equal(previewCard(state, 'c1', 14).valid, false);
  assert.equal(previewCard(state, 'c1', 16).valid, false);
  assert.deepEqual(sorted(previewCard(state, 'c2', 11).tiles), [10, 11, 12]);
  state.hero.tile = 0;
  assert.deepEqual(previewCard(state, 'c2', 1).tiles, [1, 6]);
  assert.equal(previewCard(state, 'c1', 4).valid, false);
  assert.equal(previewCard(state, 'c2', 2).valid, false);
});

test('cross and nova clip footprints and damage every enemy without self damage', () => {
  const state = freshGame();
  const before = structuredClone(state);
  const action = playCard(state, 'c3', 13);
  assert.equal(action.ok, true);
  assert.deepEqual(action.state.enemies.map(enemy => enemy.hp), [11, 15, 16]);
  assert.equal(action.state.energy, 1);
  assert.equal(action.state.hero.hp, 36);
  assert.equal(action.events.filter(event => event.type === 'hit').length, 2);
  assert.deepEqual(state, before);
  state.hero.tile = 0;
  assert.deepEqual(sorted(previewCard(state, 'c3', 0).tiles), [0, 1, 5]);
  const nova = state.drawPile.find(held => held.cardId === 'nova');
  state.hand.push(nova);
  assert.deepEqual(previewCard(state, nova.uid, 0).tiles, [0, 1, 5, 6]);
  assert.equal(previewCard(state, nova.uid, 24).valid, false);
});

test('invalid targets, unknown cards and insufficient energy are immutable failures', () => {
  const state = freshGame();
  for (const [uid, tile] of [['c1', -1], ['c1', 25], ['c1', 12], ['missing', 17], ['c5', 15]]) {
    const action = playCard(state, uid, tile);
    assert.equal(action.ok, false); assert.equal(action.state, state); assert.deepEqual(action.events, []);
  }
  state.energy = 0;
  assert.deepEqual(validTargets(state, 'c1'), []);
  assert.equal(playCard(state, 'c1', 17).ok, false);
  assert.equal(state.hand.length, 5);
});

test('movement follows clear paths and dodges an attack whose tiles stay locked', () => {
  const state = freshGame();
  assert.equal(previewCard(state, 'c4', 13).valid, false);
  assert.equal(previewCard(state, 'c4', 16).valid, false);
  const moved = playCard(state, 'c4', 15);
  assert.equal(moved.state.hero.tile, 15);
  assert.deepEqual(moved.state.enemies[0].intent.tiles, [16]);
  assert.equal(endTurn(moved.state).state.hero.hp, 36);
  state.hero.tile = 0; state.enemies[0].tile = 1; state.enemies[1].tile = 5;
  assert.equal(previewCard(state, 'c4', 6).valid, false);
});

test('enemy movement cannot enter a tile the hero now occupies', () => {
  const state = freshGame();
  const planned = state.enemies[1].intent.to;
  assert.equal(planned, 12);
  const moved = playCard(state, 'c4', planned);
  assert.equal(moved.ok, true);
  const next = endTurn(moved.state).state;
  assert.equal(next.enemies[1].tile, 13);
  assert.equal(new Set([next.hero.tile, ...next.enemies.filter(enemy => enemy.hp > 0).map(enemy => enemy.tile)]).size, 4);
});

test('block absorbs enemy damage, resets next turn and resources replenish', () => {
  const guarded = playCard(freshGame(), 'c5', 16).state;
  assert.equal(guarded.hero.block, 8);
  const action = endTurn(guarded);
  assert.equal(action.state.hero.hp, 36);
  assert.equal(action.state.hero.block, 0);
  assert.equal(action.state.energy, 3);
  assert.equal(action.state.turn, 2);
  assert.equal(action.state.hand.length, 5);
  const hit = action.events.find(event => event.type === 'hit');
  assert.equal(hit.blocked, 5); assert.equal(hit.amount, 0);
});

test('draw and reshuffle preserve all unique cards deterministically', () => {
  let a = freshGame(44); let b = freshGame(44);
  for (let i = 0; i < 4; i++) {
    a.hero.hp = 36; b.hero.hp = 36;
    a = endTurn(a).state; b = endTurn(b).state;
    assert.deepEqual(a, b);
    assert.equal(a.hand.length, 5);
    assert.equal(allCards(a).length, 12);
    assert.equal(new Set(allCards(a).map(held => held.uid)).size, 12);
  }
});

test('victory and defeat freeze subsequent actions', () => {
  const state = freshGame();
  state.enemies[0].hp = 0; state.enemies[1].hp = 0; state.enemies[2].hp = 8;
  const won = playCard(state, 'c1', 19);
  assert.equal(won.state.phase, 'victory');
  assert.equal(won.events.some(event => event.type === 'death' && event.targetId === 'e3'), true);
  assert.equal(endTurn(won.state).ok, false);
  assert.equal(playCard(won.state, 'c5', 16).ok, false);
  const losing = freshGame(); losing.hero.hp = 5;
  const lost = endTurn(losing);
  assert.equal(lost.state.phase, 'defeat'); assert.equal(lost.state.hero.hp, 0);
  assert.equal(endTurn(lost.state).ok, false);
});

test('save round trips preserve a shifted hero and telegraphs across turns', () => {
  const moved = playCard(freshGame(), 'c4', 15).state;
  assert.deepEqual(parseSave(JSON.stringify(moved)), moved);
  const next = endTurn(moved).state;
  assert.deepEqual(parseSave(JSON.stringify(next)), next);
});

test('save validation rejects old gardens, malformed cards and impossible boards', () => {
  for (const raw of ['', 'bad', 'null', JSON.stringify({ version: 1, tiles: [] })]) assert.equal(parseSave(raw), null);
  const edits = [
    state => { state.hero.tile = 25; }, state => { state.hero.hp = -1; },
    state => { state.energy = 99; }, state => { state.enemies[0].tile = state.hero.tile; },
    state => { state.enemies[0].intent.tiles = [25]; }, state => { state.enemies[1].intent.to = 24; },
    state => { state.hand[0].cardId = 'unknown'; }, state => { state.hand[1].uid = state.hand[0].uid; },
    state => { state.drawPile.pop(); }, state => { state.phase = 'victory'; },
    state => { state.log.push('x'.repeat(181)); },
  ];
  for (const edit of edits) { const state = freshGame(); edit(state); assert.equal(parseSave(JSON.stringify(state)), null); }
});
