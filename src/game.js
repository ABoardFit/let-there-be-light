export const SIZE = 5;
export const COLS = SIZE;
export const ROWS = SIZE;
export const STORAGE_KEY = 'let-there-be-light:battle:v1';
export const CARDS = Object.freeze(Object.fromEntries([
  { id: 'lance', name: '빛의 찌르기', cost: 1, damage: 8, range: 3, pattern: '직선 3칸', type: 'attack', description: '상하좌우 한 방향의 3칸에 피해 8.', flavor: '어둠을 꿰뚫는 한 줄기 빛.', color: '#e6bd6d' },
  { id: 'sweep', name: '새벽의 횡베기', cost: 1, damage: 6, range: 1, pattern: '전방 3칸', type: 'attack', description: '바로 앞칸과 그 양옆에 피해 6.', flavor: '새벽이 검끝을 따라 번진다.', color: '#dca576' },
  { id: 'cross', name: '낙광', cost: 2, damage: 7, range: 4, pattern: '십자 5칸', type: 'attack', description: '4칸 안의 중심과 상하좌우에 피해 7.', flavor: '하늘이 전장을 가른다.', color: '#b8a0de' },
  { id: 'step', name: '빛의 발걸음', cost: 1, damage: 0, range: 2, pattern: '이동 2칸', type: 'move', description: '빈칸을 따라 최대 2칸 이동.', flavor: '그림자가 닿기 전에.', color: '#8fc4c1' },
  { id: 'guard', name: '수호의 문장', cost: 1, damage: 0, block: 8, range: 0, pattern: '방어 8', type: 'guard', description: '이번 적 턴까지 방어도 8을 얻는다.', flavor: '작은 빛도 굳건한 성벽이 된다.', color: '#91afd4' },
  { id: 'nova', name: '여명의 폭발', cost: 2, damage: 5, range: 3, pattern: '주변 9칸', type: 'attack', description: '3칸 안의 중심을 둘러싼 9칸에 피해 5.', flavor: '빛이 있으라.', color: '#e2c28c' },
].map(card => [card.id, Object.freeze(card)])));

const DECK = ['lance', 'sweep', 'cross', 'step', 'guard', 'lance', 'lance', 'sweep', 'cross', 'step', 'guard', 'nova'];
const ENEMIES = [
  { id: 'e1', kind: 'archer', name: '그림자 사수', tile: 8, hp: 18, maxHp: 18 },
  { id: 'e2', kind: 'brute', name: '잿빛 파수꾼', tile: 13, hp: 22, maxHp: 22 },
  { id: 'e3', kind: 'shade', name: '어둠의 잔영', tile: 19, hp: 16, maxHp: 16 },
];
const DAMAGE = { archer: 5, brute: 8, shade: 6 };
const isTile = tile => Number.isInteger(tile) && tile >= 0 && tile < SIZE * SIZE;
const xy = tile => [tile % SIZE, Math.floor(tile / SIZE)];
const tileAt = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE ? y * SIZE + x : null;
const distance = (a, b) => { const [ax, ay] = xy(a); const [bx, by] = xy(b); return Math.abs(ax - bx) + Math.abs(ay - by); };
const neighbors = tile => { const [x, y] = xy(tile); return [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => tileAt(x + dx, y + dy)).filter(isTile); };
const alive = state => state.enemies.filter(enemy => enemy.hp > 0);
const result = (state, message, events = [], ok = true) => ({ ok, state, message, events });
const addLog = (state, message) => { state.log = [...state.log, message].slice(-8); };
const direction = (from, to) => {
  const [x, y] = xy(from); const [tx, ty] = xy(to);
  if (from === to || (x !== tx && y !== ty)) return null;
  return [Math.sign(tx - x), Math.sign(ty - y)];
};
const frontCells = (from, [dx, dy]) => {
  const [x, y] = xy(from);
  return [-1, 0, 1].map(offset => tileAt(x + dx - dy * offset, y + dy + dx * offset)).filter(isTile);
};
function shuffle(state, cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
    const j = Math.floor(state.rng / 4294967296 * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function planEnemies(state) {
  const occupied = new Set(alive(state).map(enemy => enemy.tile));
  const reserved = new Set();
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) { enemy.intent = { type: 'attack', damage: 0, tiles: [] }; continue; }
    const range = enemy.kind === 'archer' ? 6 : 1;
    if (distance(enemy.tile, state.hero.tile) <= range) {
      enemy.intent = { type: 'attack', damage: DAMAGE[enemy.kind], tiles: enemy.kind === 'brute' ? frontCells(enemy.tile, direction(enemy.tile, state.hero.tile)) : [state.hero.tile] };
    } else {
      const options = neighbors(enemy.tile).filter(tile => tile !== state.hero.tile && !occupied.has(tile) && !reserved.has(tile));
      options.sort((a, b) => distance(a, state.hero.tile) - distance(b, state.hero.tile) || a - b);
      const to = options[0] ?? enemy.tile;
      reserved.add(to);
      enemy.intent = { type: 'move', damage: 0, tiles: [to], to };
    }
  }
}
export function freshGame(seed = 12345) {
  const deck = DECK.map((cardId, index) => ({ uid: `c${index + 1}`, cardId }));
  const state = { version: 2, turn: 1, energy: 3, maxEnergy: 3, phase: 'player', hero: { id: 'hero', tile: 16, hp: 36, maxHp: 36, block: 0 }, enemies: ENEMIES.map(enemy => ({ ...enemy, block: 0 })), hand: deck.slice(0, 5), drawPile: [], discardPile: [], log: ['다가올 공격을 확인하고 카드를 선택하세요.'], rng: Number.isFinite(seed) ? seed >>> 0 : 12345 };
  state.drawPile = shuffle(state, deck.slice(5));
  planEnemies(state);
  return state;
}
function reachable(state, target, range) {
  const blocked = new Set(alive(state).map(enemy => enemy.tile));
  const visited = new Set([state.hero.tile]);
  const queue = [[state.hero.tile, 0]];
  for (let i = 0; i < queue.length; i++) {
    const [tile, steps] = queue[i];
    if (tile === target) return true;
    if (steps === range) continue;
    for (const next of neighbors(tile)) {
      if (!blocked.has(next) && !visited.has(next)) { visited.add(next); queue.push([next, steps + 1]); }
    }
  }
  return false;
}
export function previewCard(state, handUid, targetTile) {
  const held = state.hand.find(card => card.uid === handUid);
  const card = held ? CARDS[held.cardId] : null;
  const preview = { valid: false, reason: '', tiles: [], targetTile, type: card?.type ?? null, damage: card?.damage ?? 0, cost: card?.cost ?? 0, block: card?.block ?? 0 };
  const invalid = reason => ({ ...preview, reason });
  if (state.phase !== 'player') return invalid('전투가 끝났습니다.');
  if (!card) return invalid('손에 없는 카드입니다.');
  if (!isTile(targetTile)) return invalid('전장 안의 타일을 선택하세요.');
  const from = state.hero.tile;
  if (card.type === 'guard') {
    if (targetTile !== from) return invalid('영웅의 타일을 선택하세요.');
    preview.tiles = [from];
  } else if (card.type === 'move') {
    if (targetTile === from || distance(from, targetTile) > card.range || !reachable(state, targetTile, card.range)) return invalid('빈칸을 따라 2칸 안으로 이동할 수 있습니다.');
    preview.tiles = [targetTile];
  } else if (card.id === 'lance' || card.id === 'sweep') {
    const vector = direction(from, targetTile);
    if (!vector || distance(from, targetTile) > card.range) return invalid('사거리 안의 상하좌우 타일을 선택하세요.');
    if (card.id === 'sweep') preview.tiles = frontCells(from, vector);
    else {
      const [x, y] = xy(from); const [dx, dy] = vector;
      preview.tiles = [1, 2, 3].map(n => tileAt(x + dx * n, y + dy * n)).filter(isTile);
    }
  } else {
    if (distance(from, targetTile) > card.range) return invalid(`${card.range}칸 안의 타일을 선택하세요.`);
    if (card.id === 'cross') preview.tiles = [targetTile, ...neighbors(targetTile)];
    else {
      const [x, y] = xy(targetTile);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const tile = tileAt(x + dx, y + dy);
        if (isTile(tile)) preview.tiles.push(tile);
      }
    }
  }
  if (state.energy < card.cost) return invalid('에너지가 부족합니다.');
  return { ...preview, valid: true };
}
export function validTargets(state, handUid) {
  return Array.from({ length: SIZE * SIZE }, (_, tile) => tile).filter(tile => previewCard(state, handUid, tile).valid);
}
function hurt(target, damage, events) {
  const blocked = Math.min(target.block, damage);
  target.block -= blocked;
  const amount = Math.min(target.hp, damage - blocked);
  target.hp -= amount;
  events.push({ type: 'hit', targetId: target.id, amount, blocked });
  if (target.hp === 0) events.push({ type: 'death', targetId: target.id });
}
export function playCard(state, handUid, targetTile) {
  const preview = previewCard(state, handUid, targetTile);
  if (!preview.valid) return result(state, preview.reason, [], false);
  const next = structuredClone(state);
  const index = next.hand.findIndex(card => card.uid === handUid);
  const [held] = next.hand.splice(index, 1);
  const card = CARDS[held.cardId];
  next.discardPile.push(held);
  next.energy -= card.cost;
  const events = [];
  if (card.type === 'move') {
    events.push({ type: 'move', actorId: 'hero', from: next.hero.tile, to: targetTile });
    next.hero.tile = targetTile;
  } else if (card.type === 'guard') {
    next.hero.block += card.block;
    events.push({ type: 'block', actorId: 'hero', amount: card.block });
  } else {
    events.push({ type: 'attack', actorId: 'hero', from: next.hero.tile, to: targetTile, tiles: preview.tiles, cardId: card.id });
    for (const enemy of alive(next)) if (preview.tiles.includes(enemy.tile)) hurt(enemy, card.damage, events);
  }
  if (!alive(next).length) next.phase = 'victory';
  const message = next.phase === 'victory' ? '어둠을 몰아냈습니다. 빛이 있으라.' : `${card.name} 사용`;
  addLog(next, message);
  return result(next, message, events);
}
export function endTurn(state) {
  if (state.phase !== 'player') return result(state, '전투가 끝났습니다.', [], false);
  const next = structuredClone(state);
  const events = [];
  for (const enemy of next.enemies) {
    if (enemy.hp <= 0) continue;
    const intent = enemy.intent;
    if (intent.type === 'move') {
      const occupied = next.hero.tile === intent.to || alive(next).some(other => other.id !== enemy.id && other.tile === intent.to);
      if (!occupied && enemy.tile !== intent.to) { events.push({ type: 'move', actorId: enemy.id, from: enemy.tile, to: intent.to }); enemy.tile = intent.to; }
    } else {
      events.push({ type: 'attack', actorId: enemy.id, from: enemy.tile, to: intent.tiles[0], tiles: [...intent.tiles], cardId: enemy.kind });
      if (intent.tiles.includes(next.hero.tile)) hurt(next.hero, intent.damage, events);
      if (next.hero.hp === 0) {
        next.phase = 'defeat';
        const message = '빛이 사그라들었습니다. 다시 도전하세요.';
        addLog(next, message);
        return result(next, message, events);
      }
    }
  }
  next.turn++;
  next.energy = next.maxEnergy;
  next.hero.block = 0;
  next.discardPile.push(...next.hand);
  next.hand = [];
  while (next.hand.length < 5) {
    if (!next.drawPile.length) { next.drawPile = shuffle(next, next.discardPile); next.discardPile = []; }
    if (!next.drawPile.length) break;
    next.hand.push(next.drawPile.shift());
  }
  planEnemies(next);
  events.push({ type: 'turn', turn: next.turn });
  const message = `${next.turn}번째 턴 · 에너지와 손패를 채웠습니다.`;
  addLog(next, message);
  return result(next, message, events);
}
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
export function parseSave(raw) {
  if (typeof raw !== 'string' || raw.length > 16000) return null;
  try {
    const state = JSON.parse(raw);
    if (!state || state.version !== 2 || !integer(state.turn, 1, 9999) || state.maxEnergy !== 3 || !integer(state.energy, 0, 3) || !['player', 'victory', 'defeat'].includes(state.phase) || !integer(state.rng, 0, 4294967295)) return null;
    const h = state.hero;
    if (!h || h.id !== 'hero' || !isTile(h.tile) || h.maxHp !== 36 || !integer(h.hp, 0, 36) || !integer(h.block, 0, 24)) return null;
    if (!Array.isArray(state.enemies) || state.enemies.length !== ENEMIES.length) return null;
    const occupied = new Set(h.hp > 0 ? [h.tile] : []);
    const enemies = [];
    for (let i = 0; i < ENEMIES.length; i++) {
      const enemy = state.enemies[i]; const base = ENEMIES[i];
      if (!enemy || enemy.id !== base.id || enemy.kind !== base.kind || !isTile(enemy.tile) || enemy.maxHp !== base.maxHp || !integer(enemy.hp, 0, base.maxHp) || enemy.block !== 0) return null;
      if (enemy.hp > 0) { if (occupied.has(enemy.tile)) return null; occupied.add(enemy.tile); }
      const intent = enemy.intent;
      if (!intent || !['attack', 'move'].includes(intent.type) || !Array.isArray(intent.tiles) || intent.tiles.length > 3 || !intent.tiles.every(isTile) || new Set(intent.tiles).size !== intent.tiles.length || !integer(intent.damage, 0, 8)) return null;
      if (intent.type === 'move' && (!isTile(intent.to) || distance(enemy.tile, intent.to) > 1 || intent.damage !== 0 || intent.tiles.length !== 1 || intent.tiles[0] !== intent.to)) return null;
      if (intent.type === 'attack' && enemy.hp > 0 && (intent.damage !== DAMAGE[enemy.kind] || !intent.tiles.length)) return null;
      enemies.push({ ...base, tile: enemy.tile, hp: enemy.hp, block: 0, intent: { type: intent.type, damage: intent.damage, tiles: [...intent.tiles], ...(intent.type === 'move' ? { to: intent.to } : {}) } });
    }
    const seen = new Set(); const piles = {};
    for (const name of ['hand', 'drawPile', 'discardPile']) {
      if (!Array.isArray(state[name]) || state[name].length > (name === 'hand' ? 5 : 12)) return null;
      piles[name] = [];
      for (const card of state[name]) {
        if (!card || typeof card.uid !== 'string' || !/^c([1-9]|1[0-2])$/.test(card.uid) || seen.has(card.uid) || !Object.hasOwn(CARDS, card.cardId) || DECK[Number(card.uid.slice(1)) - 1] !== card.cardId) return null;
        seen.add(card.uid); piles[name].push({ uid: card.uid, cardId: card.cardId });
      }
    }
    if (seen.size !== DECK.length || !Array.isArray(state.log) || state.log.length > 8 || state.log.some(line => typeof line !== 'string' || line.length > 180)) return null;
    if ((state.phase === 'victory') !== enemies.every(enemy => enemy.hp === 0) || (state.phase === 'defeat') !== (h.hp === 0)) return null;
    return { version: 2, turn: state.turn, energy: state.energy, maxEnergy: 3, phase: state.phase, hero: { id: 'hero', tile: h.tile, hp: h.hp, maxHp: 36, block: h.block }, enemies, ...piles, log: [...state.log], rng: state.rng };
  } catch { return null; }
}
