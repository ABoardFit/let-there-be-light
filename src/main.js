import './style.css';
import { freshGame, previewCard, validTargets, playCard, endTurn, parseSave, STORAGE_KEY, CARDS, SIZE } from './game.js';
import { createWorld } from './scene.js';

const sun = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="5" fill="currentColor"/><path d="M16 2v5m0 18v5M2 16h5m18 0h5M6 6l3.5 3.5m13 13L26 26M6 26l3.5-3.5m13-13L26 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const art = {
  lance: '<g stroke-linecap="round"><path d="M21 86 104 13" stroke="#edb75f" stroke-width="8" opacity=".2"/><path d="M27 80 101 17" stroke="#fff5bf" stroke-width="3"/><path d="m84 22 25-11-13 24 1-12Z" fill="#fff7d0"/><path d="m23 72 12 13m-19 1 11-11" stroke="#c59a59" stroke-width="4"/><path d="M50 28v11m-5-6h11m20 28v13m-6-7h12" stroke="#ebd4a0" stroke-width="1.5"/><path d="M38 71C62 35 77 54 101 30" stroke="#f2c65f" stroke-width="1" fill="none" opacity=".6"/></g>',
  sweep: '<path d="M15 81C12 24 74-4 113 34 62 17 42 53 15 81Z" fill="#dcb36b" opacity=".34"/><path d="M17 79C30 26 82 10 111 35 73 20 44 43 17 79Z" fill="#ffecb7"/><path d="m44 78 44-46-17 32-21 20Z" fill="#e4dcc1"/><path d="m37 72 18 16m-20 4 10-12" stroke="#a7804a" stroke-width="5" stroke-linecap="round"/><path d="M10 50C33 9 85 6 111 27" stroke="#d9b777" stroke-width="1.5" fill="none" opacity=".7"/>',
  cross: '<path d="M60 1 70 47 116 54 70 61 60 103 50 61 6 54 50 47Z" fill="#e6c982" opacity=".25"/><path d="m60 15 5 35 29 5-29 5-5 29-5-29-29-5 29-5Z" fill="#fff2c1"/><path d="M31 5 44 85M84 3 77 89M13 17l20 60M105 16 91 77" stroke="#ecc977" stroke-width="1" opacity=".55"/><ellipse cx="60" cy="83" rx="35" ry="8" fill="none" stroke="#eed497" opacity=".5"/>',
  step: '<path d="M19 91C75 95 24 55 64 51S108 27 96 9" stroke="#bcdfc1" stroke-width="2" stroke-dasharray="3 7" fill="none"/><g fill="#e1efcc" transform="rotate(-23 60 50)"><ellipse cx="48" cy="67" rx="7" ry="13"/><ellipse cx="73" cy="38" rx="7" ry="13"/><circle cx="47" cy="84" r="5"/><circle cx="73" cy="55" r="5"/></g><path d="m94 11 11 6-14 2" fill="none" stroke="#e6edbf" stroke-width="2"/><path d="M22 29v10m-5-5h10" stroke="#e1edb4"/>',
  guard: '<path d="m60 7 34 13v33C94 78 60 96 60 96S26 78 26 53V20Z" fill="#edcc93" opacity=".17" stroke="#f2d59e"/><path d="m60 17 25 10v25c0 19-25 34-25 34S35 71 35 52V27Z" fill="#2e4946" stroke="#e0c68e" stroke-width="3"/><path d="m60 31 5 18 15 5-15 5-5 16-5-16-15-5 15-5Z" fill="#ffebac"/><path d="M60 20v11m0 44v8" stroke="#d9bf86" stroke-width="1.5"/>',
  nova: '<circle cx="60" cy="51" r="34" fill="none" stroke="#e4c18b" stroke-width="1"/><circle cx="60" cy="51" r="24" fill="#f7dc9b" opacity=".13"/><path d="m60 13 7 24 22-13-12 23 24 6-25 6 12 23-22-13-6 24-7-24-23 13 13-24-24-6 24-6-12-22 23 13Z" fill="#f9e7b6"/><circle cx="60" cy="51" r="8" fill="#fff9dc"/>',
};
const patterns = {
  lance: { hero: 22, area: [7, 12, 17] }, sweep: { hero: 17, area: [11, 12, 13] },
  cross: { hero: 22, area: [2, 6, 7, 8, 12] }, step: { hero: 22, area: [12, 17] },
  guard: { hero: 12, area: [12] }, nova: { hero: 22, area: [6, 7, 8, 11, 12, 13, 16, 17, 18] },
};
function diagram(id) {
  const pattern = patterns[id] ?? patterns.lance;
  return `<svg viewBox="0 0 45 45" class="pattern-diagram" aria-hidden="true">${Array.from({ length: 25 }, (_, i) => `<rect x="${i % 5 * 9 + 1}" y="${Math.floor(i / 5) * 9 + 1}" width="7" height="7" rx="1" fill="${i === pattern.hero ? '#f7e2ac' : pattern.area.includes(i) ? '#bd824c' : '#443e2e'}" opacity="${i === pattern.hero || pattern.area.includes(i) ? 1 : .26}"/>`).join('')}</svg>`;
}

document.querySelector('#app').innerHTML = `
<main class="battle" aria-label="빛이 있으라 전술 카드 전투">
  <canvas id="world" tabindex="0" aria-label="5 곱하기 5 전장. 카드 선택 후 방향키로 칸 이동, Enter로 사용." aria-describedby="keyboard-help"></canvas>
  <div class="scene-shade" aria-hidden="true"></div><div id="unit-labels"></div>
  <div class="board-layout-controls" role="group" aria-label="블록 배열과 전장 보기">
    <div class="board-layout-buttons">
      ${[1, 2, 3, 4, 5].map(size => `<button type="button" data-board-size="${size}" aria-pressed="false" aria-label="${size} 곱하기 ${size} 블록 배열 미리보기" disabled>${size}×${size}</button>`).join('')}
      <button type="button" id="return-to-battle" aria-pressed="true" aria-label="전투 화면으로 돌아가기" disabled>전투로</button>
    </div>
    <div class="board-layout-buttons board-view-buttons" role="group" aria-label="전장 회전과 높이">
      <button type="button" data-board-rotate="90" aria-label="전장을 시계 방향으로 90도 회전" disabled>90° 회전</button>
      <button type="button" data-board-rotate="180" aria-label="전장을 시계 방향으로 180도 회전" disabled>180° 회전</button>
      <button type="button" id="tile-drop-mode" aria-pressed="false" aria-describedby="board-view-status" disabled>한 칸 내리기</button>
      <button type="button" id="reset-board-view" aria-label="전장 회전과 블록 높이를 원위치로" disabled>원위치</button>
    </div>
    <p id="board-view-status" role="status" aria-live="polite" hidden></p>
    <p id="board-preview-status" class="sr-only" hidden></p>
  </div>
  <header class="battle-header">
    <div class="turn-banner"><span class="turn-ornament" aria-hidden="true"></span><div><span id="turn-count">첫 번째 전투</span><strong id="turn-phase">당신의 차례</strong></div><span class="turn-ornament" aria-hidden="true"></span></div>
    <div class="header-actions"><button class="text-button" id="restart-button">새 전투</button></div>
  </header>
  <div class="battle-log" id="battle-log" aria-label="최근 전투 기록"></div>
  <div class="target-prompt" id="target-prompt"><span class="prompt-icon">${sun}</span><span id="prompt-text">카드를 고르고, 전장의 칸을 선택하세요</span><button id="cancel-card" hidden aria-label="카드 선택 취소">취소 <kbd>Esc</kbd></button></div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <footer class="battle-dock">
    <div class="energy-area"><div class="energy-orb" aria-label="에너지"><span class="energy-rays" aria-hidden="true">${sun}</span><strong id="energy-count">3</strong><span class="energy-max">/ <span id="energy-max">3</span></span></div><span class="energy-label">에너지</span><span class="energy-hint">턴마다 회복</span></div>
    <div class="hand-wrap"><div class="hand-label"><span>당신의 손패</span><span id="hand-count">5장</span></div><div class="card-hand" id="card-hand" role="group" aria-label="손에 든 카드"></div></div>
    <div class="turn-actions"><button id="end-turn" class="end-turn"><span>턴 종료</span><span class="end-turn-key">E</span></button><div class="pile-counts"><span title="뽑을 카드"><span class="pile-icon" aria-hidden="true"></span>뽑기 <b id="draw-count">7</b></span><span title="버린 카드"><span class="pile-icon discard" aria-hidden="true"></span>버림 <b id="discard-count">0</b></span></div><span id="save-label" class="save-label">자동 저장됨</span></div>
  </footer>
  <p class="sr-only" id="keyboard-help">숫자 1부터 5로 카드 선택, 방향키로 전장 칸 이동, Enter 또는 Space로 사용, Escape 또는 오른쪽 클릭으로 취소, E로 턴 종료. 빛나는 칸은 지정 가능한 위치이며 붉은 칸은 적의 다음 공격 위치입니다.</p>
  <p class="sr-only" id="board-drop-help">방향키로 칸 이동, Enter 또는 Space로 높이 변경, Escape로 한 칸 내리기 종료.</p>
  <div class="loading-screen" id="loading-screen"><span class="loading-sun">${sun}</span><h2>빛이 있으라</h2><p>구름 너머, 성역으로 향하는 중</p></div>
  <dialog id="restart-dialog" class="battle-dialog compact-dialog"><h2>새 전투를 시작할까요?</h2><p>진행 중인 전투가 초기화됩니다.<br>수호자의 체력과 덱이 다시 채워져요.</p><div class="dialog-actions"><button class="quiet-button" data-close="restart-dialog">계속 싸우기</button><button class="primary-button" id="confirm-restart">새 전투 시작</button></div></dialog>
  <dialog id="outcome-dialog" class="battle-dialog outcome-dialog"><span class="dialog-mark">${sun}</span><p class="outcome-kicker" id="outcome-kicker">성역에 찾아온 새벽</p><h2 id="outcome-title">빛이 있으라</h2><p id="outcome-message"></p><div class="outcome-stats" id="outcome-stats"></div><button class="primary-button" id="play-again">다시 도전하기</button></dialog>
</main>`;

let state = freshGame();
let storageAvailable = true, invalidSave = false;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) { const restored = parseSave(raw); if (restored) state = restored; else invalidSave = true; }
} catch { storageAvailable = false; }
let world, selectedUid = null, hoverTile = null, focusTile = state.hero.tile;
let busy = false, disposed = false, toastTimer, previewSize = null, viewActionPending = false;
let boardView = { rotation: 0, dropMode: false, droppedTiles: [], busy: false, previewSize: null };
const canvas = document.querySelector('#world');
const handRoot = document.querySelector('#card-hand');
const dialogs = [...document.querySelectorAll('dialog')];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const battleCanvasLabel = canvas.getAttribute('aria-label');
const layoutButtons = [...document.querySelectorAll('[data-board-size], #return-to-battle')];
const viewButtons = [...document.querySelectorAll('[data-board-rotate], #tile-drop-mode, #reset-board-view')];
const viewBusy = () => viewActionPending || boardView.busy;
const combatBlocked = () => previewSize !== null || busy || viewBusy() || boardView.dropMode;

function renderBoardControls() {
  [...layoutButtons, ...viewButtons].forEach(button => { button.disabled = busy || viewBusy() || !world; });
  document.querySelector('.board-layout-controls').setAttribute('aria-busy', String(busy || viewBusy()));
  document.querySelector('#tile-drop-mode').setAttribute('aria-pressed', String(boardView.dropMode));
  const status = document.querySelector('#board-view-status');
  const details = [previewSize !== null ? `${previewSize}×${previewSize} · ${previewSize ** 2}개 블록` : '', boardView.rotation ? `${boardView.rotation}°` : '', boardView.droppedTiles.length ? `내린 칸 ${boardView.droppedTiles.length}개` : ''].filter(Boolean).join(' · ');
  status.textContent = viewBusy() ? '전장을 움직이는 중' : boardView.dropMode ? '칸을 눌러 내리기 · 다시 누르면 복원' : details;
  status.hidden = !status.textContent;
  canvas.tabIndex = previewSize === null || boardView.dropMode ? 0 : -1;
  canvas.setAttribute('aria-describedby', boardView.dropMode ? 'board-view-status board-drop-help' : previewSize !== null ? 'board-preview-status board-view-status' : 'keyboard-help board-view-status');
  canvas.style.cursor = boardView.dropMode ? 'pointer' : 'default';
}
function receiveBoardView(next) {
  boardView = next;
  if (!disposed) renderHud();
}
async function changeBoardView(action) {
  if (!world || busy || viewBusy() || dialogs.some(dialog => dialog.open)) return;
  viewActionPending = true;
  hoverTile = null;
  world.setFocus(null);
  renderHud();
  try { await action(); }
  catch (error) { console.error('Board view change failed:', error); announce('전장을 움직이지 못했어요. 다시 시도해 주세요.'); }
  finally {
    viewActionPending = false;
    boardView = world.getBoardViewState();
    if (!disposed) renderHud();
    if (!disposed && document.activeElement === canvas) world.setFocus(focusTile);
  }
}
function toggleDropMode() {
  if (!world || busy || viewBusy() || dialogs.some(dialog => dialog.open)) return;
  world.setTileDropMode(!boardView.dropMode);
  boardView = world.getBoardViewState();
  hoverTile = null;
  focusTile = Math.min(focusTile, (previewSize ?? SIZE) ** 2 - 1);
  world.setFocus(null);
  renderHud();
}

function setBoardPreview(size) {
  if (!world || busy || viewBusy() || dialogs.some(dialog => dialog.open) || size === previewSize) return;
  if (!world.setBoardPreview(size)) return;
  previewSize = size;
  const previewing = size !== null;
  const battle = document.querySelector('.battle');
  battle.classList.toggle('board-preview', previewing);
  battle.setAttribute('aria-label', previewing ? '블록 배열 미리보기' : '빛이 있으라 전술 카드 전투');
  layoutButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.boardSize ? Number(button.dataset.boardSize) === size : !previewing)));
  const status = document.querySelector('#board-preview-status');
  status.hidden = !previewing;
  status.textContent = previewing ? `${size}×${size} · ${size * size}개 블록` : '';
  canvas.setAttribute('aria-label', previewing ? `${size} 곱하기 ${size} 블록 배열 미리보기` : battleCanvasLabel);
  canvas.setAttribute('aria-describedby', previewing ? 'board-preview-status' : 'keyboard-help');
  canvas.style.cursor = 'default';
  hoverTile = null;
  world.setFocus(null);
  clearTimeout(toastTimer);
  document.querySelector('#toast').classList.remove('visible');
  if (!previewing) world.sync(state);
  boardView = world.getBoardViewState();
  renderHud();
}

function announce(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3400);
}
function save() {
  if (storageAvailable) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { storageAvailable = false; }
  }
  document.querySelector('#save-label').textContent = storageAvailable ? '자동 저장됨' : '이 브라우저는 저장 불가';
}
function cardMarkup(entry, index, total) {
  const card = CARDS[entry.cardId];
  const typeName = card.type === 'attack' ? '공격' : card.type === 'move' ? '이동' : '방어';
  const stat = card.type === 'attack' ? `<strong>${card.damage}</strong> 피해` : card.type === 'guard' ? `<strong>${card.block}</strong> 방어` : `<strong>${card.range}</strong>칸 이동`;
  return `<button class="battle-card card-${entry.cardId}${selectedUid === entry.uid ? ' selected' : ''}${card.cost > state.energy ? ' unaffordable' : ''}" data-card="${esc(entry.uid)}" style="--fan:${(index - (total - 1) / 2) * 3};--lift:${Math.abs(index - (total - 1) / 2) * 6}px;--order:${index}" aria-pressed="${selectedUid === entry.uid}" aria-label="${index + 1}. ${esc(card.name)}, 에너지 ${card.cost}, ${esc(card.description)}" ${busy || state.phase !== 'player' ? 'disabled' : ''}><span class="card-cost">${card.cost}</span><span class="card-hotkey">${index < 5 ? index + 1 : ''}</span><span class="card-name">${esc(card.name)}</span><span class="card-type">${typeName}</span><span class="card-illustration"><svg viewBox="0 0 120 104" aria-hidden="true">${art[entry.cardId] ?? art.lance}</svg></span><span class="card-effect"><span class="effect-main">${stat}</span><span class="card-pattern">${esc(card.pattern)}</span>${diagram(entry.cardId)}</span></button>`;
}
function renderHand() {
  const hadFocus = document.activeElement?.closest('[data-card]')?.dataset.card;
  const scroll = handRoot.scrollLeft;
  handRoot.innerHTML = state.hand.map((entry, index) => cardMarkup(entry, index, state.hand.length)).join('');
  if (combatBlocked()) handRoot.querySelectorAll('button').forEach(button => { button.disabled = true; });
  handRoot.scrollLeft = scroll;
  if (hadFocus) ([...handRoot.querySelectorAll('[data-card]')].find(button => button.dataset.card === hadFocus) ?? canvas).focus({ preventScroll: true });
  document.querySelector('#hand-count').textContent = `${state.hand.length}장`;
}
function renderHud() {
  document.querySelector('#turn-count').textContent = `${state.turn}번째 턴`;
  document.querySelector('#turn-phase').textContent = busy ? '행동하는 중' : state.phase === 'victory' ? '성역을 지켰습니다' : state.phase === 'defeat' ? '빛이 사그라들었습니다' : '당신의 차례';
  document.querySelector('#energy-count').textContent = state.energy;
  document.querySelector('#energy-max').textContent = state.maxEnergy;
  document.querySelector('.energy-orb').classList.toggle('depleted', state.energy === 0);
  document.querySelector('#draw-count').textContent = state.drawPile.length;
  document.querySelector('#discard-count').textContent = state.discardPile.length;
  document.querySelector('#battle-log').replaceChildren(...state.log.slice(-2).map(entry => { const line = document.createElement('p'); line.textContent = typeof entry === 'string' ? entry : entry.message ?? ''; return line; }));
  document.querySelector('#end-turn').disabled = combatBlocked() || state.phase !== 'player' || !world;
  document.querySelector('#restart-button').disabled = combatBlocked();
  renderBoardControls();
  renderHand(); updateTargeting();
}
function updateTargeting(tile = hoverTile) {
  const prompt = document.querySelector('#prompt-text'), cancel = document.querySelector('#cancel-card');
  if (previewSize !== null) { world?.showTargeting(null); return; }
  if (viewBusy() || boardView.dropMode) { world?.showTargeting(null); cancel.hidden = true; prompt.textContent = boardView.dropMode ? '높이를 바꾼 뒤 ‘한 칸 내리기’를 다시 누르면 전투를 이어갑니다' : '전장을 움직이고 있습니다'; return; }
  if (busy) { world?.showTargeting(null); cancel.hidden = true; prompt.textContent = '수호자와 그림자가 행동하고 있습니다'; return; }
  const entry = state.hand.find(card => card.uid === selectedUid);
  cancel.hidden = !entry;
  document.querySelector('.target-prompt').classList.toggle('has-selection', Boolean(entry));
  if (!entry || state.phase !== 'player') {
    world?.showTargeting(null);
    prompt.textContent = state.phase === 'player' ? state.hand.length ? '카드를 고르고, 전장의 칸을 선택하세요' : '손패를 모두 사용했어요. 턴을 종료하세요' : state.phase === 'victory' ? '성역에 빛이 돌아왔습니다' : '다시 한번, 빛을 향해';
    return;
  }
  const card = CARDS[entry.cardId], targets = validTargets(state, entry.uid);
  if (tile !== null) {
    const preview = previewCard(state, entry.uid, tile);
    world?.showTargeting({ tiles: preview.tiles ?? [], valid: preview.valid, targets });
    prompt.textContent = preview.valid ? `${card.name} · ${card.type === 'attack' ? `${preview.tiles.length}칸에 ${card.damage} 피해` : card.type === 'guard' ? `방어 ${card.block} 획득` : '이 칸으로 이동'} · 클릭하여 사용` : `${card.name} · ${preview.reason || '빛나는 칸을 선택하세요'}`;
  } else {
    world?.showTargeting({ tiles: [], valid: true, targets });
    prompt.textContent = state.energy < card.cost ? `${card.name} · 에너지가 부족합니다` : card.type === 'guard' ? `${card.name} · 수호자의 칸을 눌러 방어하세요` : `${card.name} · 빛나는 칸을 골라 ${card.type === 'move' ? '이동' : '공격'}하세요`;
  }
}
function selectCard(uid, keyboard = false) {
  if (combatBlocked() || state.phase !== 'player' || !world || dialogs.some(dialog => dialog.open)) return;
  selectedUid = selectedUid === uid ? null : uid; hoverTile = null;
  renderHand(); updateTargeting();
  if (keyboard) { canvas.focus({ preventScroll: true }); world.setFocus(focusTile); updateTargeting(focusTile); }
}
function cancelSelection() {
  if (combatBlocked()) return;
  selectedUid = null; hoverTile = null; world?.setFocus(null); renderHand(); updateTargeting();
}
function showOutcome() {
  if (state.phase === 'player' || disposed) return;
  const victory = state.phase === 'victory';
  document.querySelector('#outcome-kicker').textContent = victory ? '성역에 찾아온 새벽' : '아직 끝나지 않은 이야기';
  document.querySelector('#outcome-title').textContent = victory ? '빛이 있으라' : '다시, 첫 번째 빛';
  document.querySelector('#outcome-message').textContent = victory ? '모든 그림자가 물러났습니다. 당신의 선택이 성역에 빛을 되찾아 주었어요.' : '수호자의 빛이 사그라들었습니다. 적의 공격 범위를 살피고, 이동과 방어를 함께 사용해 보세요.';
  document.querySelector('#outcome-stats').textContent = `${state.turn}턴 · 남은 체력 ${state.hero.hp} / ${state.hero.maxHp}`;
  document.querySelector('#outcome-dialog').classList.toggle('defeat', !victory);
  if (!document.querySelector('#outcome-dialog').open) document.querySelector('#outcome-dialog').showModal();
}
async function execute(result, enemyTurn = false) {
  if (!result.ok) { announce(result.message || '지금은 사용할 수 없습니다.'); return; }
  busy = true; selectedUid = null; hoverTile = null; renderHud();
  if (enemyTurn) document.querySelector('#turn-phase').textContent = '그림자의 차례';
  try { await world.playEvents(result.events, result.state); }
  catch (error) { console.error('Battle animation failed:', error); announce('전투 효과를 건너뛰고 이어갑니다.'); }
  finally {
    state = result.state; busy = false; world.sync(state); focusTile = state.hero.tile; save(); renderHud();
  }
  if (result.message) announce(result.message);
  showOutcome();
}
function clickTile(tile) {
  if (combatBlocked() || !world || state.phase !== 'player' || dialogs.some(dialog => dialog.open)) return;
  focusTile = tile;
  if (!selectedUid) { announce('아래에서 사용할 카드를 먼저 골라 주세요.'); return; }
  execute(playCard(state, selectedUid, tile));
}
function finishTurn() {
  if (combatBlocked() || !world || state.phase !== 'player' || dialogs.some(dialog => dialog.open)) return;
  execute(endTurn(state), true);
}
function restart() {
  if (combatBlocked()) return;
  state = freshGame(); selectedUid = null; hoverTile = null; focusTile = state.hero.tile;
  dialogs.forEach(dialog => { if (dialog.open) dialog.close(); });
  world?.sync(state); world?.setFocus(null); save(); renderHud(); announce('새로운 전투가 시작되었습니다.');
}

handRoot.addEventListener('click', event => { const button = event.target.closest('[data-card]'); if (button) selectCard(button.dataset.card); });
layoutButtons.forEach(button => button.addEventListener('click', () => setBoardPreview(button.dataset.boardSize ? Number(button.dataset.boardSize) : null)));
document.querySelectorAll('[data-board-rotate]').forEach(button => button.addEventListener('click', () => changeBoardView(() => world.rotateBoard(Number(button.dataset.boardRotate)))));
document.querySelector('#tile-drop-mode').addEventListener('click', toggleDropMode);
document.querySelector('#reset-board-view').addEventListener('click', () => changeBoardView(() => world.resetBoardView()));
document.querySelector('#cancel-card').addEventListener('click', cancelSelection);
document.querySelector('#end-turn').addEventListener('click', finishTurn);
document.querySelector('#restart-button').addEventListener('click', () => { if (!combatBlocked()) document.querySelector('#restart-dialog').showModal(); });
document.querySelector('#confirm-restart').addEventListener('click', restart);
document.querySelector('#play-again').addEventListener('click', restart);
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
document.querySelector('#outcome-dialog').addEventListener('cancel', event => event.preventDefault());
canvas.addEventListener('contextmenu', event => { event.preventDefault(); cancelSelection(); });
canvas.addEventListener('focus', () => { if (world && boardView.dropMode && !viewBusy()) world.setFocus(focusTile); });
document.addEventListener('keydown', event => {
  if (!world || busy || viewBusy() || dialogs.some(dialog => dialog.open) || event.altKey || event.ctrlKey || event.metaKey) return;
  if (boardView.dropMode) {
    if (event.key === 'Escape') { event.preventDefault(); toggleDropMode(); return; }
    if (event.target !== canvas) return;
    if (event.key.startsWith('Arrow')) { event.preventDefault(); focusTile = world.moveFocusTile(focusTile, event.key); world.setFocus(focusTile); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); changeBoardView(() => world.toggleTileDrop(focusTile)); }
    return;
  }
  if (previewSize !== null || state.phase !== 'player') return;
  if (event.key === 'Escape') { cancelSelection(); return; }
  if (event.key.toLowerCase() === 'e') { event.preventDefault(); finishTurn(); return; }
  if (/^[1-5]$/.test(event.key)) { const card = state.hand[Number(event.key) - 1]; if (card) { event.preventDefault(); selectCard(card.uid, true); } return; }
  if (event.target !== canvas) return;
  if (event.key.startsWith('Arrow')) {
    event.preventDefault();
    focusTile = world.moveFocusTile(focusTile, event.key);
    world?.setFocus(focusTile); hoverTile = focusTile; updateTargeting(focusTile);
  } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); clickTile(focusTile); }
});
renderHud(); save();
async function boot() {
  try {
    world = await createWorld(canvas, {
      state, onTileClick: clickTile,
      onHover: tile => { if (combatBlocked()) return; hoverTile = tile; canvas.style.cursor = selectedUid && tile !== null ? 'crosshair' : 'default'; updateTargeting(tile); },
      onViewState: receiveBoardView,
      reducedMotion, labelsRoot: document.querySelector('#unit-labels'),
    });
    world.sync(state); renderHud(); document.querySelector('#loading-screen').classList.add('loaded');
    if (invalidSave) announce('저장된 전투를 읽지 못해 새 전투로 시작했습니다.');
    showOutcome();
  } catch (error) {
    console.error('Battle initialization failed:', error);
    document.querySelector('#loading-screen').innerHTML = `<span class="loading-sun">${sun}</span><h2>전장을 불러오지 못했어요</h2><p>브라우저의 그래픽 가속을 켜거나<br>최신 Chrome, Edge, Safari에서 다시 열어 주세요.</p><button class="primary-button" id="retry-button">다시 불러오기</button>`;
    document.querySelector('#retry-button').addEventListener('click', () => location.reload());
  }
}
boot();
window.addEventListener('resize', () => world?.resize());
window.addEventListener('pagehide', save);
if (import.meta.hot) import.meta.hot.dispose(() => { disposed = true; clearTimeout(toastTimer); world?.dispose(); });
