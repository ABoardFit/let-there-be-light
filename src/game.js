export const SIZE = 10;
export const STORAGE_KEY = 'let-there-be-light:v1';
export const COSTS = Object.freeze({ tree: 8, flower: 5, lantern: 12, erase: 0 });
export const GOALS = Object.freeze({ tree: 5, flower: 6, lantern: 4 });
export const GATHER_DELAY = 4500;
const TYPES = new Set(['empty', 'tree', 'flower', 'lantern', 'rock', 'shrine']);
const NAMES = { tree: '소나무', flower: '들꽃', lantern: '빛의 등불' };

export function freshGame() {
  const tiles = Array.from({ length: SIZE * SIZE }, () => ({ type: 'empty' }));
  for (const i of [7, 20, 28, 72, 89]) tiles[i] = { type: 'tree', natural: true };
  for (const i of [15, 33, 60, 86, 97]) tiles[i] = { type: 'rock', natural: true };
  tiles[44] = { type: 'shrine', natural: true };
  return { version: 1, light: 36, tiles, lastGather: 0, victorySeen: false };
}

export function progress(state) {
  const counts = { tree: 0, flower: 0, lantern: 0 };
  state.tiles.forEach(tile => { if (!tile.natural && Object.hasOwn(counts, tile.type)) counts[tile.type]++; });
  const done = Object.keys(GOALS).every(type => counts[type] >= GOALS[type]);
  const fraction = Object.keys(GOALS).reduce((sum, type) => sum + Math.min(counts[type] / GOALS[type], 1), 0) / 3;
  return { counts, done, fraction };
}

export function place(state, index, tool) {
  if (!Number.isInteger(index) || index < 0 || index >= SIZE * SIZE || typeof tool !== 'string' || !Object.hasOwn(COSTS, tool)) {
    return { state, success: false, message: '섬 안의 칸을 골라 주세요.' };
  }
  const tile = state.tiles[index];
  if (tile.type === 'shrine') return { state, success: false, gather: true, message: '빛의 샘에서 빛을 모아 보세요.' };
  if (tool === 'erase') {
    if (tile.type === 'empty') return { state, success: false, message: '아직 아무것도 없는 자리예요.' };
    if (tile.natural) return { state, success: false, message: '섬에 원래 있던 나무와 바위는 남겨 두어요.' };
    const tiles = state.tiles.slice();
    tiles[index] = { type: 'empty' };
    return { state: { ...state, tiles, light: Math.min(9999, state.light + Math.floor(COSTS[tile.type] / 2)) }, success: true, message: '자리를 비웠어요. 사용한 빛의 절반을 돌려받았어요.' };
  }
  if (tile.type !== 'empty') return { state, success: false, message: '비어 있는 칸을 골라 주세요.' };
  if (state.light < COSTS[tool]) return { state, success: false, message: '빛이 조금 더 필요해요. 빛 모으기를 눌러 주세요.' };
  const tiles = state.tiles.slice();
  tiles[index] = { type: tool };
  return { state: { ...state, tiles, light: state.light - COSTS[tool] }, success: true, message: `${NAMES[tool]}${tool === 'tree' ? '를' : '을'} 놓았어요.` };
}

export function gather(state, now = Date.now()) {
  if (now - state.lastGather < GATHER_DELAY) return { state, success: false };
  return { state: { ...state, light: Math.min(9999, state.light + 6), lastGather: now }, success: true };
}

export function growLight(state) {
  return { ...state, light: Math.min(9999, state.light + 1) };
}

export function parseSave(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Number.isInteger(data.light) || data.light < 0 || data.light > 9999 ||
      !Array.isArray(data.tiles) || data.tiles.length !== SIZE * SIZE ||
      !Number.isFinite(data.lastGather) || data.lastGather < 0 || data.lastGather > Date.now() + GATHER_DELAY ||
      typeof data.victorySeen !== 'boolean') return null;
    const initialTiles = freshGame().tiles;
    const tiles = data.tiles.map((tile, index) => {
      if (!tile || !TYPES.has(tile.type) || (tile.natural !== undefined && typeof tile.natural !== 'boolean')) throw new Error('Invalid tile');
      if (initialTiles[index].natural) {
        if (tile.type !== initialTiles[index].type || tile.natural !== true) throw new Error('Changed protected tile');
      } else if (tile.natural || tile.type === 'shrine' || tile.type === 'rock') throw new Error('Invalid player tile');
      return tile.natural ? { type: tile.type, natural: true } : { type: tile.type };
    });
    return { version: 1, light: data.light, tiles, lastGather: data.lastGather, victorySeen: data.victorySeen };
  } catch { return null; }
}
