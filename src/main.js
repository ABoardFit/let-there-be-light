import './style.css';
import { freshGame, place, progress, gather, growLight, parseSave, STORAGE_KEY, COSTS, GOALS, GATHER_DELAY, SIZE } from './game.js';
import { createWorld } from './scene.js';

const sun = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="5" fill="currentColor"/><path d="M16 2v5m0 18v5M2 16h5m18 0h5M6 6l3.5 3.5m13 13L26 26M6 26l3.5-3.5m13-13L26 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const icons = {
  tree: '<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M25 37h6v15h-6z" fill="#80502e"/><path d="m28 5 14 22h-6l12 17H8l12-17h-6z" fill="#6c8f47"/><path d="m28 5 2 39H8l12-17h-6z" fill="#9cae5d"/><path d="m28 13 9 14h-5l10 13H17l9-13h-5z" fill="#c1c878" opacity=".35"/></svg>',
  flower: '<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M28 29v23m0-11C15 41 15 31 18 32c8 0 10 9 10 9m0 5c12-1 12-11 9-10-7 1-9 10-9 10" stroke="#82965b" fill="#82965b" stroke-width="2"/><g fill="#e7ad9d"><ellipse cx="28" cy="16" rx="6" ry="10"/><ellipse cx="28" cy="16" rx="6" ry="10" transform="rotate(72 28 25)"/><ellipse cx="28" cy="16" rx="6" ry="10" transform="rotate(144 28 25)"/><ellipse cx="28" cy="16" rx="6" ry="10" transform="rotate(216 28 25)"/><ellipse cx="28" cy="16" rx="6" ry="10" transform="rotate(288 28 25)"/></g><circle cx="28" cy="25" r="6" fill="#ffde93"/></svg>',
  lantern: '<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M27 42h3v10h-3z" fill="#9a7041"/><path d="M20 12a8 8 0 0 1 16 0" stroke="#c39c64" stroke-width="2" fill="none"/><path d="m15 18 5-7h16l5 7-4 23H19z" fill="#ffe4a0"/><path d="m15 18 13-3 13 3-4 23H19z" fill="#efbd65"/><path d="M21 19h14l-2 18H23z" fill="#fff2bd"/><path d="M14 18h28M18 41h20M28 17v22" stroke="#977142" stroke-width="2"/><path d="M28 26c-7 7-3 10 0 10s6-3 0-10" fill="#f6c056"/></svg>',
  erase: '<svg viewBox="0 0 56 56" aria-hidden="true"><path d="m34 8 6 4-20 30-6-4z" fill="#c9ac7e"/><path d="m18 32 9 6-8 14H8L4 46z" fill="#a9a99a"/><path d="m18 32 3 2-9 17H8l-4-5z" fill="#d5d2b9"/><path d="m33 9 8 5 4-6-8-5z" fill="none" stroke="#c9ac7e" stroke-width="3"/></svg>',
};
const names = { tree: '소나무', flower: '들꽃', lantern: '등불', erase: '비우기' };
const app = document.querySelector('#app');
app.innerHTML = `
  <main class="garden" aria-label="빛이 있으라 정원 게임">
    <canvas id="world" tabindex="0" aria-label="공중섬 정원. 방향키로 칸을 고르고 Enter로 배치하세요." aria-describedby="keyboard-help"></canvas>
    <div class="vignette" aria-hidden="true"></div>
    <header class="masthead">
      <div class="brand"><span class="brand-mark" aria-hidden="true">${sun}</span><div><h1>빛이 있으라</h1><p>구름 위에, 나만의 작은 정원</p></div></div>
      <div class="top-controls">
        <div class="light-wallet" aria-label="보유한 빛"><span class="wallet-icon">${sun}</span><span><strong id="light-count">36</strong><span class="wallet-label">모은 빛</span></span></div>
        <button class="icon-button" id="help-button" aria-label="놀이 방법" title="놀이 방법"><span>?</span></button>
        <button class="icon-button sound-button" id="sound-button" aria-label="효과음 켜기" aria-pressed="false" title="효과음 켜기"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path class="sound-waves" d="M15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path class="sound-cross" d="m16 9 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.5"/></svg></button>
      </div>
    </header>

    <div class="garden-sidebar"><section class="journey" aria-label="정원 가꾸기 목표">
      <div class="journey-heading"><span class="tiny-sun">${sun}</span><span id="chapter-name">첫 번째 빛</span><span class="chapter-number">01</span></div>
      <h2 id="journey-title">잠든 섬을 깨워 주세요</h2>
      <p class="journey-intro" id="journey-description">작은 숲과 꽃, 따스한 빛 하나.<br>당신의 손길로 섬이 깨어나요.</p>
      <div class="quests">
        <div class="quest" id="quest-tree"><span class="quest-check" aria-hidden="true"></span><span>소나무 심기</span><span class="quest-count"><b id="count-tree">0</b> / 5</span></div>
        <div class="quest" id="quest-flower"><span class="quest-check" aria-hidden="true"></span><span>들꽃 피우기</span><span class="quest-count"><b id="count-flower">0</b> / 6</span></div>
        <div class="quest" id="quest-lantern"><span class="quest-check" aria-hidden="true"></span><span>등불 밝히기</span><span class="quest-count"><b id="count-lantern">0</b> / 4</span></div>
      </div>
      <div class="growth-track" role="progressbar" aria-label="섬을 깨운 정도" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="growth-fill"></span></div>
      <div class="journey-footer"><span id="progress-label">빛을 기다리는 정원</span><span id="progress-number">0%</span></div>
    </section>

    <div class="gather-wrap"><button id="gather-button" class="gather-button">${sun}<span>빛 모으기</span><span class="gather-value">+6</span></button><span class="gather-hint" id="gather-hint">빛은 천천히 다시 차올라요</span></div></div>
    <div class="tile-tip" id="tile-tip" hidden></div>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>

    <footer class="workbench">
      <p class="tool-hint" id="tool-hint"><span>소나무</span>를 골랐어요. 빈 땅을 눌러 심어 보세요.</p>
      <div class="tool-tray" role="group" aria-label="정원 도구">
        ${Object.entries(names).map(([type, name], i) => `<button class="tool ${i === 0 ? 'selected' : ''}" data-tool="${type}" aria-pressed="${i === 0}" aria-label="${name}${COSTS[type] ? `, 빛 ${COSTS[type]}개` : ', 배치한 것 치우기'}"><span class="tool-shortcut">${i + 1}</span><span class="tool-art">${icons[type]}</span><span class="tool-name">${name}</span><span class="tool-cost">${COSTS[type] ? `${sun}${COSTS[type]}` : '½ 돌려받기'}</span></button>`).join('')}
        <span class="tray-end left" aria-hidden="true"></span><span class="tray-end right" aria-hidden="true"></span>
      </div>
    </footer>
    <div class="page-foot"><span id="save-label">이 브라우저에 자동 저장</span><button id="reset-button">새 정원</button></div>
    <span class="world-caption" aria-hidden="true">노을이 머무는 섬</span>
    <p id="keyboard-help" class="sr-only">숫자 1부터 4로 도구 선택. 정원에 초점을 맞춘 다음 방향키로 칸 이동, Enter 또는 Space로 배치. Escape로 선택 표시 해제. 화면의 빛 모으기 버튼 또는 가운데 샘에서 빛을 모을 수 있습니다.</p>

    <div class="loading-screen" id="loading-screen"><span class="loading-sun">${sun}</span><p>구름 사이로 섬을 찾고 있어요</p></div>
    <dialog id="help-dialog" class="garden-dialog"><button class="dialog-close" data-close="help-dialog" aria-label="닫기">×</button><span class="dialog-sun">${sun}</span><h2>작은 빛에서 시작해요</h2><p>아래에서 소나무, 들꽃, 등불을 고르고<br>섬의 비어 있는 칸에 놓아 보세요.</p><div class="help-steps"><p><strong>빛을 모으세요</strong>빛 모으기나 가운데 샘을 누르면 빛 6개를 얻어요. 빛은 6초마다 1개씩 저절로 모여요.</p><p><strong>섬을 깨우세요</strong>나무 5그루, 들꽃 6곳, 등불 4개를 놓으면 정원에 축복이 내려요. 그 뒤에도 계속 꾸밀 수 있어요.</p><p><strong>마음껏 바꿔 보세요</strong>비우기로 직접 놓은 것을 치우면 빛의 절반을 돌려받아요. 원래 있던 나무와 바위는 그대로 남아요.</p></div><p class="keyboard-note">키보드: 도구 <kbd>1</kbd>–<kbd>4</kbd> · 칸 이동 <kbd>방향키</kbd> · 배치 <kbd>Enter</kbd><br>정원을 한 번 누르거나 Tab으로 정원에 초점을 맞춰 주세요.</p><button class="primary-button" data-close="help-dialog">정원으로 돌아가기</button></dialog>
    <dialog id="reset-dialog" class="garden-dialog compact-dialog"><h2>새로운 섬에서 시작할까요?</h2><p>지금 정원과 모은 빛은 사라져요.<br>새로운 섬에는 빛 36개가 기다려요.</p><div class="dialog-actions"><button class="quiet-button" data-close="reset-dialog">계속 가꾸기</button><button class="primary-button" id="confirm-reset">새 정원 만들기</button></div></dialog>
    <dialog id="victory-dialog" class="garden-dialog victory-dialog"><button class="dialog-close" data-close="victory-dialog" aria-label="닫기">×</button><span class="dialog-sun">${sun}</span><p class="victory-kicker">당신이 피워 낸 첫 번째 정원</p><h2>빛이 있으라</h2><p>고요했던 섬에 숲이 자라고,<br>꽃이 피고, 따뜻한 빛이 머물러요.<br>이제 이곳은 당신의 정원입니다.</p><button class="primary-button" data-close="victory-dialog">계속 가꾸기</button></dialog>
  </main>`;

let state = freshGame();
let storageAvailable = true;
let invalidSave = false;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) { const saved = parseSave(raw); if (saved) state = saved; else invalidSave = true; }
} catch { storageAvailable = false; }
let world;
let tool = 'tree';
let focused = null;
let toastTimer;
let victoryTimer;
let soundEnabled = false;
let audio;
let disposed = false;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.querySelector('#world');
const gatherButton = document.querySelector('#gather-button');
const dialogs = [...document.querySelectorAll('dialog')];

function announce(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3300);
}

function save() {
  if (storageAvailable) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { storageAvailable = false; }
  }
  document.querySelector('#save-label').textContent = storageAvailable ? '이 브라우저에 자동 저장' : '이 브라우저에서는 저장할 수 없어요';
}

function tone(kind = 'place') {
  if (!soundEnabled || !audio) return;
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  const now = audio.currentTime;
  const notes = kind === 'gather' ? [523.25, 783.99] : kind === 'victory' ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 880];
  notes.forEach((frequency, i) => {
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0, now + i * 0.11);
    envelope.gain.linearRampToValueAtTime(0.07, now + i * 0.11 + 0.025);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + i * 0.11 + 0.65);
    oscillator.connect(envelope).connect(audio.destination);
    oscillator.start(now + i * 0.11);
    oscillator.stop(now + i * 0.11 + 0.7);
  });
}

function renderHud() {
  document.querySelector('#light-count').textContent = state.light;
  const goal = progress(state);
  for (const type of Object.keys(GOALS)) {
    document.querySelector(`#count-${type}`).textContent = Math.min(goal.counts[type], GOALS[type]);
    document.querySelector(`#quest-${type}`).classList.toggle('complete', goal.counts[type] >= GOALS[type]);
  }
  const percent = Math.round(goal.fraction * 100);
  document.querySelector('#growth-fill').style.width = `${percent}%`;
  document.querySelector('.growth-track').setAttribute('aria-valuenow', percent);
  document.querySelector('#progress-number').textContent = `${percent}%`;
  document.querySelector('#progress-label').textContent = goal.done ? '빛이 머무는 정원' : goal.fraction > 0.5 ? '섬에 온기가 번져요' : goal.fraction > 0 ? '작은 생명이 자라나요' : '빛을 기다리는 정원';
  document.querySelector('#journey-title').textContent = goal.done ? '당신의 정원이 깨어났어요' : '잠든 섬을 깨워 주세요';
  document.querySelector('#chapter-name').textContent = goal.done ? '빛이 머무는 곳' : '첫 번째 빛';
  document.querySelector('#journey-description').innerHTML = goal.done ? '마음이 머무는 곳에 심어 보세요.<br>정원 이야기는 계속됩니다.' : '작은 숲과 꽃, 따스한 빛 하나.<br>당신의 손길로 섬이 깨어나요.';
  document.querySelectorAll('.tool').forEach(button => {
    const unaffordable = state.light < COSTS[button.dataset.tool];
    button.classList.toggle('unaffordable', unaffordable);
  });
  world?.setRadiance(goal.fraction);
}

function checkVictory() {
  if (progress(state).done && !state.victorySeen) {
    state = { ...state, victorySeen: true };
    save();
    world?.celebrate();
    tone('victory');
    clearTimeout(victoryTimer);
    victoryTimer = setTimeout(() => {
      if (!disposed && progress(state).done) document.querySelector('#victory-dialog').showModal();
    }, reducedMotion ? 100 : 1300);
  }
}

function gatherLight() {
  const result = gather(state);
  if (!result.success) { announce('빛이 다시 모이는 중이에요. 잠시 기다려 주세요.'); return; }
  state = result.state;
  renderHud();
  renderGather();
  save();
  tone('gather');
  announce('작은 빛 6개가 손에 내려앉았어요.');
}

function clickTile(index) {
  if (!world || dialogs.some(dialog => dialog.open)) return;
  focused = index;
  const result = place(state, index, tool);
  if (result.gather) { gatherLight(); return; }
  if (!result.success) { announce(result.message); return; }
  state = result.state;
  world.updateTile(index, state.tiles[index].type);
  renderHud();
  save();
  tone();
  announce(result.message);
  checkVictory();
}

function selectTool(next) {
  tool = next;
  document.querySelectorAll('.tool').forEach(button => {
    const selected = button.dataset.tool === tool;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected);
  });
  document.querySelector('#tool-hint').innerHTML = tool === 'erase' ? '직접 놓은 나무, 꽃, 등불을 누르면 자리를 비워요.' : `<span>${names[tool]}</span>${tool === 'tree' ? '를' : '을'} 골랐어요. 빈 땅을 눌러 ${tool === 'lantern' ? '밝혀' : '심어'} 보세요.`;
  world?.setSelectedTool(tool);
}

function renderGather() {
  const remaining = Math.max(0, GATHER_DELAY - (Date.now() - state.lastGather));
  gatherButton.disabled = remaining > 0;
  gatherButton.style.setProperty('--charge', `${100 - remaining / GATHER_DELAY * 100}%`);
  document.querySelector('#gather-hint').textContent = remaining > 0 ? `${(remaining / 1000).toFixed(1)}초 뒤 빛이 차올라요` : '빛은 천천히 다시 차올라요';
}

document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => selectTool(button.dataset.tool)));
gatherButton.addEventListener('click', gatherLight);
document.querySelector('#help-button').addEventListener('click', () => document.querySelector('#help-dialog').showModal());
document.querySelector('#reset-button').addEventListener('click', () => document.querySelector('#reset-dialog').showModal());
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
dialogs.forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target === dialog) {
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  }
}));
document.querySelector('#confirm-reset').addEventListener('click', () => {
  clearTimeout(victoryTimer);
  state = freshGame();
  state.tiles.forEach((tile, index) => world?.updateTile(index, tile.type));
  selectTool('tree');
  focused = null;
  world?.setFocus(null);
  renderHud();
  renderGather();
  save();
  document.querySelector('#reset-dialog').close();
  announce('새로운 섬에 첫 빛이 내려왔어요.');
});
document.querySelector('#sound-button').addEventListener('click', async () => {
  const button = document.querySelector('#sound-button');
  if (!soundEnabled) {
    try {
      const AudioClass = window.AudioContext || window.webkitAudioContext;
      audio ??= new AudioClass();
      await audio.resume();
      soundEnabled = true;
    } catch { announce('이 브라우저에서 효과음을 켤 수 없어요.'); return; }
  } else soundEnabled = false;
  button.setAttribute('aria-pressed', soundEnabled);
  button.setAttribute('aria-label', soundEnabled ? '효과음 끄기' : '효과음 켜기');
  button.title = soundEnabled ? '효과음 끄기' : '효과음 켜기';
  tone();
});
document.addEventListener('keydown', event => {
  if (dialogs.some(dialog => dialog.open) || event.altKey || event.ctrlKey || event.metaKey) return;
  if (['1', '2', '3', '4'].includes(event.key)) selectTool(Object.keys(names)[Number(event.key) - 1]);
});
canvas.addEventListener('keydown', event => {
  if (dialogs.some(dialog => dialog.open)) return;
  const movement = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -SIZE, ArrowDown: SIZE };
  if (event.key in movement) {
    event.preventDefault();
    const current = focused ?? 44;
    const row = Math.floor(current / SIZE);
    const column = current % SIZE;
    if (event.key === 'ArrowLeft') focused = row * SIZE + Math.max(0, column - 1);
    if (event.key === 'ArrowRight') focused = row * SIZE + Math.min(SIZE - 1, column + 1);
    if (event.key === 'ArrowUp') focused = Math.max(0, row - 1) * SIZE + column;
    if (event.key === 'ArrowDown') focused = Math.min(SIZE - 1, row + 1) * SIZE + column;
    world?.setFocus(focused);
    const tile = state.tiles[focused];
    const tileName = { empty: '빈 땅', tree: '소나무', flower: '들꽃', lantern: '등불', rock: '바위', shrine: '빛의 샘' }[tile.type];
    announce(`${Math.floor(focused / SIZE) + 1}행 ${focused % SIZE + 1}열, ${tileName}`);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    clickTile(focused ?? 44);
  } else if (event.key === 'Escape') {
    focused = null;
    world?.setFocus(null);
  }
});

renderHud();
renderGather();
save();
const cooldownTimer = setInterval(renderGather, 100);
const passiveTimer = setInterval(() => {
  if (!world || document.hidden) return;
  state = growLight(state);
  renderHud();
  save();
}, 6000);

async function boot() {
  try {
    world = await createWorld(canvas, {
      tiles: state.tiles,
      onTileClick: clickTile,
      onHover: index => {
        canvas.style.cursor = index === null ? 'default' : 'pointer';
      },
      reducedMotion,
    });
    world.setSelectedTool(tool);
    renderHud();
    document.querySelector('#loading-screen').classList.add('loaded');
    if (invalidSave) announce('저장된 정원을 읽지 못해 새 정원으로 시작했어요.');
    checkVictory();
  } catch (error) {
    console.error('Garden initialization failed:', error);
    document.querySelector('#loading-screen').innerHTML = `<span class="loading-sun">${sun}</span><h2>섬을 불러오지 못했어요</h2><p>브라우저의 그래픽 가속을 켜거나<br>최신 Chrome, Edge, Safari에서 다시 열어 주세요.</p><button class="primary-button" id="retry-button">다시 불러오기</button>`;
    document.querySelector('#retry-button').addEventListener('click', () => location.reload());
  }
}
boot();
window.addEventListener('resize', () => world?.resize());
window.addEventListener('pagehide', () => save());
if (import.meta.hot) import.meta.hot.dispose(() => {
  disposed = true;
  clearInterval(cooldownTimer);
  clearInterval(passiveTimer);
  clearTimeout(toastTimer);
  clearTimeout(victoryTimer);
  world?.dispose();
  audio?.close();
});
