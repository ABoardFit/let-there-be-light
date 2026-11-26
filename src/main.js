import './style.css';
import { freshGame, previewCard, validTargets, playCard, endTurn, parseSave, STORAGE_KEY, CARDS, SIZE } from './game.js';
import { createWorld } from './scene.js';

const sun = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="5" fill="currentColor"/><path d="M16 2v5m0 18v5M2 16h5m18 0h5M6 6l3.5 3.5m13 13L26 26M6 26l3.5-3.5m13-13L26 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const shield = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Z" stroke="currentColor" stroke-width="1.5"/><path d="M12 7v9m-4-5h8" stroke="currentColor" stroke-width="1.5"/></svg>';
const sword = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 16 11-13h3v3L10 19M4 13l7 7m-6-2-3 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
  <div class="scene-shade" aria-hidden="true"></div><div id="unit-labels" aria-hidden="true"></div>
  <header class="battle-header">
    <div class="brand"><span class="brand-sun">${sun}</span><div><h1>빛이 있으라</h1><p>잊힌 성역의 수호자</p></div></div>
    <div class="turn-banner"><span class="turn-ornament" aria-hidden="true"></span><div><span id="turn-count">첫 번째 전투</span><strong id="turn-phase">당신의 차례</strong></div><span class="turn-ornament" aria-hidden="true"></span></div>
    <div class="header-actions"><button class="round-button" id="sound-button" aria-label="효과음 켜기" aria-pressed="false" title="효과음 켜기"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path class="sound-waves" d="M15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path class="sound-cross" d="m16 9 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.5"/></svg></button><button class="round-button" id="help-button" aria-label="전투 방법" title="전투 방법">?</button><button class="text-button" id="restart-button">새 전투</button></div>
  </header>
  <section class="hero-hud" aria-label="수호자 상태"><div class="hero-crest" aria-hidden="true">${sun}</div><div class="hero-vitals"><div class="hero-name"><span>빛의 수호자</span><span class="hero-armor" title="방어도">${shield}<b id="hero-block">0</b></span></div><div class="hp-track"><span id="hero-hp-fill"></span><span id="hero-hp">36 / 36</span></div></div></section>
  <aside class="enemy-panel" aria-label="적의 다음 행동"><div class="enemy-panel-title">적의 다음 행동 <span id="enemy-count">3</span></div><div id="enemy-intents"></div><p class="intent-note">붉은 칸은 다음 공격 범위</p></aside>
  <div class="battle-log" id="battle-log" aria-label="최근 전투 기록"></div>
  <div class="target-prompt" id="target-prompt"><span class="prompt-icon">${sun}</span><span id="prompt-text">카드를 고르고, 전장의 칸을 선택하세요</span><button id="cancel-card" hidden aria-label="카드 선택 취소">취소 <kbd>Esc</kbd></button></div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <footer class="battle-dock">
    <div class="energy-area"><div class="energy-orb" aria-label="에너지"><span class="energy-rays" aria-hidden="true">${sun}</span><strong id="energy-count">3</strong><span class="energy-max">/ <span id="energy-max">3</span></span></div><span class="energy-label">에너지</span><span class="energy-hint">턴마다 회복</span></div>
    <div class="hand-wrap"><div class="hand-label"><span>당신의 손패</span><span id="hand-count">5장</span></div><div class="card-hand" id="card-hand" role="group" aria-label="손에 든 카드"></div></div>
    <div class="turn-actions"><button id="end-turn" class="end-turn"><span>턴 종료</span><span class="end-turn-key">E</span></button><div class="pile-counts"><span title="뽑을 카드"><span class="pile-icon" aria-hidden="true"></span>뽑기 <b id="draw-count">7</b></span><span title="버린 카드"><span class="pile-icon discard" aria-hidden="true"></span>버림 <b id="discard-count">0</b></span></div><span id="save-label" class="save-label">자동 저장됨</span></div>
  </footer>
  <p class="sr-only" id="keyboard-help">숫자 1부터 5로 카드 선택, 방향키로 전장 칸 이동, Enter 또는 Space로 사용, Escape 또는 오른쪽 클릭으로 취소, E로 턴 종료. 빛나는 칸은 지정 가능한 위치이며 붉은 칸은 적의 다음 공격 위치입니다.</p>
  <div class="loading-screen" id="loading-screen"><span class="loading-sun">${sun}</span><h2>빛이 있으라</h2><p>구름 너머, 성역으로 향하는 중</p></div>
  <dialog id="help-dialog" class="battle-dialog"><button class="dialog-close" data-close="help-dialog" aria-label="닫기">×</button><span class="dialog-mark">${sun}</span><h2>한 장의 카드, 한 번의 선택</h2><p>5 × 5 전장에서 카드를 사용해<br>그림자들을 물리치세요.</p><div class="help-steps"><p><strong>1. 카드를 선택하세요</strong>왼쪽 위 숫자만큼 에너지를 사용해요. 공격, 이동, 방어를 한 턴 안에 조합할 수 있습니다.</p><p><strong>2. 전장의 칸을 고르세요</strong>빛나는 칸은 지정 가능한 곳입니다. 칸에 커서를 올리면 실제 공격 범위가 보여요. 카드의 작은 격자는 범위 모양을 나타냅니다.</p><p><strong>3. 적의 행동을 살피세요</strong>붉은 칸은 적이 다음에 공격할 곳입니다. 이동해 피하거나 방어를 쌓으세요. 턴 종료를 누르면 적이 행동하고 새 카드를 뽑습니다.</p></div><p class="keyboard-note"><kbd>1</kbd>–<kbd>5</kbd> 카드 · <kbd>방향키</kbd> 칸 이동 · <kbd>Enter</kbd> 사용<br><kbd>Esc</kbd> / 오른쪽 클릭 취소 · <kbd>E</kbd> 턴 종료</p><button class="primary-button" data-close="help-dialog">전장으로 돌아가기</button></dialog>
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
let busy = false, disposed = false, soundEnabled = false, audio, toastTimer;
const canvas = document.querySelector('#world');
const handRoot = document.querySelector('#card-hand');
const dialogs = [...document.querySelectorAll('dialog')];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

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
function tone(kind = 'select') {
  if (!soundEnabled || !audio) return;
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  const now = audio.currentTime;
  const notes = kind === 'attack' ? [329.63, 493.88, 659.25] : kind === 'victory' ? [523.25, 659.25, 783.99, 1046.5] : kind === 'defeat' ? [293.66, 220, 146.83] : [659.25];
  notes.forEach((frequency, i) => {
    const oscillator = audio.createOscillator(), envelope = audio.createGain();
    oscillator.type = kind === 'attack' ? 'triangle' : 'sine';
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0, now + i * .09);
    envelope.gain.linearRampToValueAtTime(.045, now + i * .09 + .018);
    envelope.gain.exponentialRampToValueAtTime(.001, now + i * .09 + .45);
    oscillator.connect(envelope).connect(audio.destination);
    oscillator.start(now + i * .09); oscillator.stop(now + i * .09 + .5);
  });
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
  handRoot.scrollLeft = scroll;
  if (hadFocus) ([...handRoot.querySelectorAll('[data-card]')].find(button => button.dataset.card === hadFocus) ?? canvas).focus({ preventScroll: true });
  document.querySelector('#hand-count').textContent = `${state.hand.length}장`;
}
function renderHud() {
  document.querySelector('#turn-count').textContent = `${state.turn}번째 턴`;
  document.querySelector('#turn-phase').textContent = busy ? '행동하는 중' : state.phase === 'victory' ? '성역을 지켰습니다' : state.phase === 'defeat' ? '빛이 사그라들었습니다' : '당신의 차례';
  document.querySelector('#hero-hp').textContent = `${state.hero.hp} / ${state.hero.maxHp}`;
  document.querySelector('#hero-hp-fill').style.width = `${Math.max(0, state.hero.hp / state.hero.maxHp * 100)}%`;
  document.querySelector('#hero-block').textContent = state.hero.block;
  document.querySelector('#energy-count').textContent = state.energy;
  document.querySelector('#energy-max').textContent = state.maxEnergy;
  document.querySelector('.energy-orb').classList.toggle('depleted', state.energy === 0);
  document.querySelector('#draw-count').textContent = state.drawPile.length;
  document.querySelector('#discard-count').textContent = state.discardPile.length;
  const enemies = state.enemies.filter(enemy => enemy.hp > 0);
  document.querySelector('#enemy-count').textContent = enemies.length;
  document.querySelector('#enemy-intents').innerHTML = enemies.map(enemy => {
    const attack = enemy.intent?.type === 'attack';
    return `<div class="enemy-intent ${attack ? 'will-attack' : 'will-move'}"><span class="intent-symbol">${attack ? sword : '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.5"/></svg>'}</span><div><span class="intent-enemy-name">${esc(enemy.name)}</span><span class="intent-action">${attack ? `공격 <b>${enemy.intent.damage}</b>` : '접근 중'}</span></div><span class="enemy-hp-small">${enemy.hp}<span> / ${enemy.maxHp}</span></span></div>`;
  }).join('');
  document.querySelector('#battle-log').replaceChildren(...state.log.slice(-2).map(entry => { const line = document.createElement('p'); line.textContent = typeof entry === 'string' ? entry : entry.message ?? ''; return line; }));
  document.querySelector('#end-turn').disabled = busy || state.phase !== 'player' || !world;
  document.querySelector('#restart-button').disabled = busy;
  renderHand(); updateTargeting();
}
function updateTargeting(tile = hoverTile) {
  const prompt = document.querySelector('#prompt-text'), cancel = document.querySelector('#cancel-card');
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
  if (busy || state.phase !== 'player' || !world || dialogs.some(dialog => dialog.open)) return;
  selectedUid = selectedUid === uid ? null : uid; hoverTile = null;
  renderHand(); updateTargeting();
  if (keyboard) { canvas.focus({ preventScroll: true }); world.setFocus(focusTile); updateTargeting(focusTile); }
  tone();
}
function cancelSelection() {
  if (busy) return;
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
  tone(victory ? 'victory' : 'defeat');
}
async function execute(result, enemyTurn = false) {
  if (!result.ok) { announce(result.message || '지금은 사용할 수 없습니다.'); return; }
  busy = true; selectedUid = null; hoverTile = null; renderHud();
  if (enemyTurn) document.querySelector('#turn-phase').textContent = '그림자의 차례';
  tone('attack');
  try { await world.playEvents(result.events, result.state); }
  catch (error) { console.error('Battle animation failed:', error); announce('전투 효과를 건너뛰고 이어갑니다.'); }
  finally {
    state = result.state; busy = false; world.sync(state); focusTile = state.hero.tile; save(); renderHud();
  }
  if (result.message) announce(result.message);
  showOutcome();
}
function clickTile(tile) {
  if (!world || busy || state.phase !== 'player' || dialogs.some(dialog => dialog.open)) return;
  focusTile = tile;
  if (!selectedUid) { announce('아래에서 사용할 카드를 먼저 골라 주세요.'); return; }
  execute(playCard(state, selectedUid, tile));
}
function finishTurn() {
  if (!world || busy || state.phase !== 'player' || dialogs.some(dialog => dialog.open)) return;
  execute(endTurn(state), true);
}
function restart() {
  if (busy) return;
  state = freshGame(); selectedUid = null; hoverTile = null; focusTile = state.hero.tile;
  dialogs.forEach(dialog => { if (dialog.open) dialog.close(); });
  world?.sync(state); world?.setFocus(null); save(); renderHud(); announce('새로운 전투가 시작되었습니다.');
}

handRoot.addEventListener('click', event => { const button = event.target.closest('[data-card]'); if (button) selectCard(button.dataset.card); });
document.querySelector('#cancel-card').addEventListener('click', cancelSelection);
document.querySelector('#end-turn').addEventListener('click', finishTurn);
document.querySelector('#help-button').addEventListener('click', () => document.querySelector('#help-dialog').showModal());
document.querySelector('#restart-button').addEventListener('click', () => { if (!busy) document.querySelector('#restart-dialog').showModal(); });
document.querySelector('#confirm-restart').addEventListener('click', restart);
document.querySelector('#play-again').addEventListener('click', restart);
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
document.querySelector('#outcome-dialog').addEventListener('cancel', event => event.preventDefault());
document.querySelector('#sound-button').addEventListener('click', async () => {
  const button = document.querySelector('#sound-button');
  if (!soundEnabled) {
    try { const AudioClass = window.AudioContext || window.webkitAudioContext; audio ??= new AudioClass(); await audio.resume(); soundEnabled = true; }
    catch { announce('이 브라우저에서 효과음을 켤 수 없어요.'); return; }
  } else soundEnabled = false;
  button.setAttribute('aria-pressed', soundEnabled); button.setAttribute('aria-label', soundEnabled ? '효과음 끄기' : '효과음 켜기'); button.title = soundEnabled ? '효과음 끄기' : '효과음 켜기'; tone();
});
canvas.addEventListener('contextmenu', event => { event.preventDefault(); cancelSelection(); });
document.addEventListener('keydown', event => {
  if (busy || dialogs.some(dialog => dialog.open) || event.altKey || event.ctrlKey || event.metaKey || state.phase !== 'player') return;
  if (event.key === 'Escape') { cancelSelection(); return; }
  if (event.key.toLowerCase() === 'e') { event.preventDefault(); finishTurn(); return; }
  if (/^[1-5]$/.test(event.key)) { const card = state.hand[Number(event.key) - 1]; if (card) { event.preventDefault(); selectCard(card.uid, true); } return; }
  if (event.target !== canvas) return;
  const row = Math.floor(focusTile / SIZE), column = focusTile % SIZE;
  if (event.key.startsWith('Arrow')) {
    event.preventDefault();
    if (event.key === 'ArrowLeft') focusTile = row * SIZE + Math.max(0, column - 1);
    if (event.key === 'ArrowRight') focusTile = row * SIZE + Math.min(SIZE - 1, column + 1);
    if (event.key === 'ArrowUp') focusTile = Math.max(0, row - 1) * SIZE + column;
    if (event.key === 'ArrowDown') focusTile = Math.min(SIZE - 1, row + 1) * SIZE + column;
    world?.setFocus(focusTile); hoverTile = focusTile; updateTargeting(focusTile);
  } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); clickTile(focusTile); }
});
renderHud(); save();
async function boot() {
  try {
    world = await createWorld(canvas, {
      state, onTileClick: clickTile,
      onHover: tile => { hoverTile = tile; canvas.style.cursor = selectedUid && tile !== null && !busy ? 'crosshair' : 'default'; updateTargeting(tile); },
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
if (import.meta.hot) import.meta.hot.dispose(() => { disposed = true; clearTimeout(toastTimer); world?.dispose(); audio?.close(); });
