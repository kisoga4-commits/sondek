import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { get, getDatabase, onValue, ref, runTransaction, update } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js';
import { checkWinner, resolveNight, resolveVote } from './gameEngine.js';

const firebaseConfig = {
  apiKey: 'AIzaSyC4jOmVcZp0HmmDqZCmHufnq2yyoPcvyVM',
  authDomain: 'pakdu-a26c4.firebaseapp.com',
  databaseURL: 'https://pakdu-a26c4-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'pakdu-a26c4',
  storageBucket: 'pakdu-a26c4.firebasestorage.app',
  messagingSenderId: '414809008203',
  appId: '1:414809008203:web:757dceafa78d91900d85ce',
};

const ROLES = {
  pob: { label: 'ปอบ', icon: '👹', desc: 'ฆ่า 1 คน/คืน' },
  shaman: { label: 'หมอดู', icon: '🔮', desc: 'ดูบท 1 คน/คืน' },
  monk: { label: 'หมอธรรม', icon: '🛡️', desc: 'คุ้มครอง 1 คน/คืน' },
  hunter: { label: 'นายพราน', icon: '🏹', desc: 'ยิง 1 คน/คืน' },
  police: { label: 'ตำรวจ', icon: '👮', desc: 'จับ 1 คนเข้าคุก/คืน' },
  villager: { label: 'ชาวนา', icon: '🌾', desc: 'ต้องกดทำงาน ไม่งั้นอดตาย' },
};
const ROLE_UI_TEXT = {
  pob: (partners = []) => `คุณคือปอบ จกตับชาวบ้านได้ 1 คนต่อคืน (เพื่อนของคุณคือ: ${partners.length ? partners.join(', ') : 'ไม่มี'})`,
  shaman: () => 'คุณคือหมอดู เลือกดูอาชีพจริงของเพื่อนได้ 1 คนต่อคืน',
  monk: () => 'คุณคือหมอธรรม เลือกผูกสายสิญจน์ป้องกันคนตายได้ 1 คนต่อคืน',
  hunter: () => 'คุณคือนายพราน มีกระสุน 1 นัดทุกคืน เลือกยิงใครก็ได้ (ระวังยิงพวกเดียวกัน!)',
  police: () => 'คุณคือตำรวจ เลือกจับคนเข้าคุกได้ 1 คน (ถ้าจับปอบ ปอบจะฆ่าใครไม่ได้)',
  villager: () => "คุณคือชาวนา ต้องกดปุ่ม 'ไถนา' ทุกคืน เพื่อหาข้าวกิน ไม่งั้นจะอดตาย!",
};
const ROLE_ACTION_CONFIG = {
  pob: { requiresTarget: true, allowSelfTarget: false, actionLabel: 'จกตับ' },
  shaman: { requiresTarget: true, allowSelfTarget: false, actionLabel: 'ส่องบทบาท' },
  monk: { requiresTarget: true, allowSelfTarget: true, actionLabel: 'คุ้มครอง' },
  hunter: { requiresTarget: true, allowSelfTarget: false, actionLabel: 'ยิง' },
  police: { requiresTarget: true, allowSelfTarget: false, actionLabel: 'จับเข้าคุก' },
  villager: { requiresTarget: true, allowSelfTarget: true, actionLabel: 'ไถนา' },
};

const params = new URLSearchParams(window.location.search);
const roomId = String(params.get('roomId') || '').trim();
const pin = String(params.get('pin') || roomId).trim();

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const state = {
  uid: '',
  publicState: null,
  mePrivate: null,
  duelPlayers: {},
  allPrivate: {},
  isHost: false,
  timerId: null,
  isResolvingMorning: false,
  isResolvingVote: false,
  privateAllUnsub: null,
  roleSheetRevealed: false,
  isAdvancingPhase: false,
  isSubmittingNightAction: false,
  isSubmittingVote: false,
  isRestartingGame: false,
  selectedNightTargetId: '',
  lastRenderedPhase: '',
  lastRenderedDay: 0,
  wasAlive: true,
};

const els = {
  home: document.getElementById('homePhase'),
  setup: document.getElementById('setupPhase'),
  identity: document.getElementById('identityPhase'),
  night: document.getElementById('nightPhase'),
  morning: document.getElementById('morningPhase'),
  vote: document.getElementById('votePhase'),
  end: document.getElementById('endPhase'),
};

const paths = {
  duelRoom: ref(db, `rooms/${roomId}`),
  roomRoot: ref(db, `pob_rooms/${roomId}`),
  public: ref(db, `pob_rooms/${roomId}/public`),
  privateMine: () => ref(db, `pob_rooms/${roomId}/private/${state.uid}`),
  privateAll: ref(db, `pob_rooms/${roomId}/private`),
};

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function rolePool(count) {
  const pools = {
    4: ['pob', 'police', 'shaman', 'hunter'],
    5: ['pob', 'police', 'shaman', 'monk', 'hunter'],
    6: ['pob', 'police', 'shaman', 'monk', 'hunter', 'villager'],
    7: ['pob', 'pob', 'police', 'shaman', 'monk', 'hunter', 'villager'],
    8: ['pob', 'pob', 'police', 'shaman', 'monk', 'hunter', 'villager', 'villager'],
  };
  return pools[count] || pools[8];
}

function buildRandomizedGameState(entries, hostUid) {
  const roles = shuffle(rolePool(entries.length));
  const playersMap = {};
  const privateMap = {};

  entries.forEach((p, idx) => {
    playersMap[p.uid] = { uid: p.uid, name: p.name || 'ผู้เล่น', alive: true, roleHint: 'hidden', deathCause: '' };
    privateMap[p.uid] = { role: roles[idx], partners: [], nightAction: null, voteTarget: null, nightNotice: '' };
  });

  entries.forEach((p) => {
    if (privateMap[p.uid].role !== 'pob') return;
    privateMap[p.uid].partners = entries
      .filter((x) => x.uid !== p.uid && privateMap[x.uid].role === 'pob')
      .map((x) => x.name || 'ผู้เล่น');
  });

  const startedAt = Date.now();
  return {
    publicState: {
      phase: 'identity',
      day: 1,
      isFirstDayVote: true,
      hostUid,
      startedAtMs: startedAt,
      hardStopAtMs: gameHardStopAtMs(startedAt),
      phaseEndsAtMs: startedAt + phaseDurationMs('identity'),
      players: playersMap,
      lastLogs: ['เริ่มเกมแล้ว'],
      voteSummary: {},
      actionSeq: 0,
      nightHistory: [],
      jailedTonight: {},
      nightSubmittedBy: {},
      nightResolveLock: null,
      voteResolveLock: null,
      forceClosed: null,
      updatedAtMs: startedAt,
    },
    privateState: privateMap,
  };
}

function alivePlayers(publicState = state.publicState) {
  const players = Object.values(publicState?.players || {});
  return players.filter((p) => p.alive);
}

function isAlive(uid = state.uid) {
  return Boolean(state.publicState?.players?.[uid]?.alive);
}

function formatRemain(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function phaseDurationMs(phase) {
  if (phase === 'identity' || phase === 'night' || phase === 'morning' || phase === 'vote') return 60000;
  return 0;
}

function gameHardStopAtMs(startedAtMs) {
  return Number(startedAtMs || 0) + (60 * 60 * 1000);
}

async function tx(pathRef, updater, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 8000));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await Promise.race([
      runTransaction(pathRef, updater),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('การเชื่อมต่อช้าเกินไป กรุณาลองอีกครั้ง')), timeoutMs);
      }),
    ]);
    if (result.committed) return result.snapshot.val();
    if (attempt >= maxAttempts) break;
    await new Promise((resolve) => setTimeout(resolve, 120 * attempt));
  }
  throw new Error('บันทึกข้อมูลไม่สำเร็จ');
}

async function updateWithTimeout(pathRef, payload, timeoutMs = 8000) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await Promise.race([
        update(pathRef, payload),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('การเชื่อมต่อช้าเกินไป กรุณาลองอีกครั้ง')), timeoutMs);
        }),
      ]);
      return;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
}

async function readWithTimeout(pathRef, timeoutMs = 4000) {
  return Promise.race([
    get(pathRef),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('อ่านข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง')), timeoutMs);
    }),
  ]);
}

async function getShamanInstantReveal(targetUid) {
  const targetId = String(targetUid || '').trim();
  if (!targetId) return '';
  try {
    const roleSnap = await readWithTimeout(ref(db, `pob_rooms/${roomId}/private/${targetId}/role`), 3500);
    const role = String(roleSnap.val() || '').trim();
    return ROLES[role]?.label || '';
  } catch (_) {
    return '';
  }
}

async function ensureAuth() {
  await new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        state.uid = user.uid;
        unsub();
        resolve();
        return;
      }
      try {
        await signInAnonymously(auth);
      } catch (error) {
        reject(error);
      }
    }, reject);
  });
}

function mountError(message) {
  Object.values(els).forEach((x) => x.classList.add('hidden'));
  els.setup.classList.remove('hidden');
  els.setup.innerHTML = `<h2>เกิดข้อผิดพลาด</h2><p class="muted">${message}</p>`;
}

function renderHome(message = '') {
  Object.values(els).forEach((x) => x.classList.add('hidden'));
  els.home.classList.remove('hidden');
  els.home.innerHTML = `
    <h2>Home</h2>
    <p class="muted">เข้าโหมดปอบกินตับจากหน้า Duel เพื่อเชื่อมต่อห้องอัตโนมัติ</p>
    ${message ? `<p class="muted">${message}</p>` : ''}
    <div class="grid" style="margin-top:.7rem;">
      <a class="btn" href="../../duel.html">🏠 กลับหน้า Duel</a>
    </div>
  `;
}

function renderLoading(message = 'กำลังโหลดห้องเกม...') {
  Object.values(els).forEach((x) => x.classList.add('hidden'));
  els.setup.classList.remove('hidden');
  els.setup.innerHTML = `
    <h2>กำลังเตรียมเกม</h2>
    <p class="muted">${message}</p>
  `;
}

function phaseMetaHtml() {
  const phase = String(state.publicState?.phase || 'setup');
  const endsAt = Number(state.publicState?.phaseEndsAtMs || 0);
  if (!endsAt) return `<p class="muted">เฟส: ${phase.toUpperCase()}</p>`;
  const remain = formatRemain(endsAt - Date.now());
  return `<p class="muted">เฟส: ${phase.toUpperCase()} • เวลาคงเหลือ ${remain}</p>`;
}

function deadOverlayHtml() {
  if (isAlive()) return '';
  return '<div class="secret-overlay"><div><h3>💀 ตายแล้ว</h3><p>ดูสถานการณ์ได้ แต่กดใช้พลังหรือโหวตไม่ได้</p></div></div>';
}

function renderVillageGridHtml(players) {
  const statusMeta = (player) => {
    if (player.alive) return { icon: '🟢', text: 'ยังรอดชีวิต', className: '' };
    if (player.deathCause === 'โดนจกตับ') return { icon: '🩸', text: 'ตายจากโดนจกตับ', className: 'out' };

    if (player.deathCause === 'โดนยิง') return { icon: '🏹', text: 'ตายจากโดนนายพรานยิง', className: 'out' };
    if (player.deathCause === 'โดนขับไล่') return { icon: '🚫', text: 'ตายจากโดนขับไล่', className: 'out' };
    return { icon: '💀', text: 'ตายแล้ว (ไม่ทราบสาเหตุ)', className: 'out' };
  };
  return `
    <div class="tag" style="margin-bottom:.5rem;">สัญลักษณ์: 🟢 ผู้รอดชีวิต • 🩸 โดนจกตับ • 🏹 โดนนายพรานยิง • 🚫 โดนขับไล่</div>
    <div class="village-grid">
      ${players.map((p) => `
        <div class="villager-card ${p.alive ? '' : 'dead'}">
          <div class="villager-icon ${statusMeta(p).className}">${statusMeta(p).icon}</div>
          <div class="villager-name">${p.name}${p.uid === state.uid ? ' 👤' : ''}</div>
          <div class="villager-status">${statusMeta(p).text}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function getNightActionStatusByUid(uid) {
  const player = state.publicState?.players?.[uid];
  if (!player?.alive) return { done: false, text: '💀 ตายแล้ว' };
  const role = state.allPrivate?.[uid]?.role || '';
  const submitted = hasSubmittedNightAction(uid);
  const roleLabel = ROLES[role]?.label || 'ผู้เล่น';
  return submitted
    ? { done: true, text: `✅ ${roleLabel} ส่งคำสั่งแล้ว` }
    : { done: false, text: `⬜ ${roleLabel} ยังไม่ส่งคำสั่ง` };
}

function getCurrentDay() {
  return Math.max(1, Number(state.publicState?.day || 1));
}

function hasNightActionForCurrentDay(action) {
  if (!action?.acted) return false;
  const actionDay = Number(action?.day || 0);
  if (!Number.isFinite(actionDay) || actionDay <= 0) return true;
  return actionDay === getCurrentDay();
}

function getNightActionForDay(privateStateByUid, uid, day) {
  const action = privateStateByUid?.[uid]?.nightAction || null;
  if (!action?.acted) return null;
  const actionDay = Number(action?.day || 0);
  if (!Number.isFinite(actionDay) || actionDay <= 0) return action;
  if (actionDay !== day) return null;
  return action;
}

function deriveJailedTonightFromPrivate() {
  const day = getCurrentDay();
  const alive = alivePlayers();
  const policeActions = alive
    .filter((p) => state.allPrivate?.[p.uid]?.role === 'police')
    .map((p) => ({ uid: p.uid, action: getNightActionForDay(state.allPrivate, p.uid, day) }))
    .filter(({ action }) => action?.acted && action?.targetId);
  if (!policeActions.length) return {};
  const earliest = policeActions.sort((a, b) => {
    const atDiff = Number(a.action?.at || 0) - Number(b.action?.at || 0);
    if (atDiff !== 0) return atDiff;
    return Number(a.action?.order || 0) - Number(b.action?.order || 0);
  })[0];
  const targetId = String(earliest?.action?.targetId || '');
  if (!targetId || !state.publicState?.players?.[targetId]?.alive) return {};
  return {
    [targetId]: {
      by: earliest.uid,
      at: Number(earliest?.action?.at || Date.now()),
      order: Number(earliest?.action?.order || 0),
    },
  };
}

function getNightSubmittedMap() {
  return state.publicState?.nightSubmittedBy || {};
}

function hasSubmittedNightAction(uid) {
  const submittedByPublic = Boolean(getNightSubmittedMap()?.[uid]);
  if (submittedByPublic) return true;
  const privateAction = state.allPrivate?.[uid]?.nightAction;
  return hasNightActionForCurrentDay(privateAction);
}

function isNightActionRequired(uid) {
  if (!uid || !state.publicState?.players?.[uid]?.alive) return false;
  const role = String(state.allPrivate?.[uid]?.role || '');
  return Boolean(role);
}

function nightPendingPlayers() {
  const alive = alivePlayers();
  return alive.filter((player) => isNightActionRequired(player.uid) && !hasSubmittedNightAction(player.uid));
}

function personalNightNoticeHtml() {
  const notice = String(state.mePrivate?.nightNotice || '').trim();
  if (!notice) return '';
  return `<div class="tag" style="margin-top:.55rem;">📌 ผลการทำหน้าที่เมื่อคืน: ${notice}</div>`;
}

function currentNightActionStatusHtml() {
  if (state.isSubmittingNightAction) {
    return '<div class="tag" style="margin-top:.55rem;">⏳ กำลังบันทึกคำสั่งของคุณ...</div>';
  }
  const action = state.mePrivate?.nightAction;
  if (!hasNightActionForCurrentDay(action)) return '';
  const role = String(state.mePrivate?.role || '');
  const actionLabel = ROLE_ACTION_CONFIG[role]?.actionLabel || 'ใช้สกิล';
  const targetId = String(action?.targetId || '').trim();
  const targetName = targetId ? (state.publicState?.players?.[targetId]?.name || 'ผู้เล่น') : '';
  const text = role === 'villager'
    ? '✅ คุณใช้สิทธิ์คืนนี้แล้ว (ไถนา) • รอระบบประมวลผล'
    : `✅ คุณใช้สิทธิ์คืนนี้แล้ว (${actionLabel} ${targetName || 'ไม่ระบุ'}) • รอระบบประมวลผล`;
  return `<div class="tag ready" style="margin-top:.55rem;">${text}</div>`;
}

function nightPhaseProgressHtml() {
  const phase = String(state.publicState?.phase || '');
  if (phase !== 'night') return '';
  const pending = nightPendingPlayers();
  if (!pending.length) {
    return '<div class="tag ready" style="margin-top:.55rem;">✅ ทุกคนส่งคำสั่งครบแล้ว กำลังประมวลผลไปช่วงเช้า...</div>';
  }
  const waitingNames = pending.map((p) => p.name || 'ผู้เล่น').join(', ');
  return `<div class="tag" style="margin-top:.55rem;">⌛ รอคำสั่งจาก: ${waitingNames}</div>`;
}

function ensurePopupRoot() {
  let root = document.getElementById('gamePopupRoot');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'gamePopupRoot';
  root.className = 'game-popup-backdrop hidden';
  root.innerHTML = `
    <article class="game-popup-card">
      <h3 id="gamePopupTitle">แจ้งเตือน</h3>
      <p id="gamePopupMessage" class="muted"></p>
      <div class="game-popup-actions" id="gamePopupActions"></div>
    </article>
  `;
  document.body.appendChild(root);
  return root;
}

function closePopup() {
  const root = ensurePopupRoot();
  root.classList.add('hidden');
}

function openPopup({ title = 'แจ้งเตือน', message = '', confirmText = 'ตกลง', cancelText = 'ยกเลิก', showCancel = false, onConfirm = null }) {
  const root = ensurePopupRoot();
  const titleEl = document.getElementById('gamePopupTitle');
  const messageEl = document.getElementById('gamePopupMessage');
  const actionsEl = document.getElementById('gamePopupActions');
  if (!titleEl || !messageEl || !actionsEl) return;

  titleEl.textContent = title;
  messageEl.textContent = message;
  actionsEl.innerHTML = '';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn';
  confirmBtn.type = 'button';
  confirmBtn.textContent = confirmText;
  confirmBtn.addEventListener('click', () => {
    closePopup();
    if (typeof onConfirm === 'function') onConfirm();
  });
  actionsEl.appendChild(confirmBtn);

  if (showCancel) {
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn secondary';
    cancelBtn.type = 'button';
    cancelBtn.textContent = cancelText;
    cancelBtn.addEventListener('click', closePopup);
    actionsEl.appendChild(cancelBtn);
  }

  root.classList.remove('hidden');
}

function bindTap(target, handler) {
  if (!target || typeof handler !== 'function') return;
  let touchTriggered = false;
  target.addEventListener('touchend', (event) => {
    event.preventDefault();
    touchTriggered = true;
    handler();
  }, { passive: false });
  target.addEventListener('click', (event) => {
    if (touchTriggered) {
      touchTriggered = false;
      return;
    }
    event.preventDefault();
    handler();
  });
}

function renderSetup() {
  const players = Object.values(state.duelPlayers || {});
  const canStart = state.isHost && players.length >= 4 && players.length <= 8;
  els.setup.innerHTML = `
    <h2>Step 1: เริ่มเกม (รอ Host กดเริ่ม)</h2>
    <p class="muted">PIN ${pin} • ห้องต้องมีผู้เล่น 4-8 คน</p>
    ${phaseMetaHtml()}
    <div class="player-list">${players.map((p) => `<div class="tag">${p.name || 'ผู้เล่น'} ${p.uid === state.uid ? '👤' : ''}</div>`).join('')}</div>
    ${state.isHost ? `<button id="startCloudGame" class="btn" ${canStart ? '' : 'disabled'}>เริ่มเกมปอบกินตับ</button>` : '<p class="muted">รอ Host เริ่มเกม...</p>'}
    <button id="leaveRoomBtn" class="btn secondary" style="margin-top:.6rem;">ออกจากห้อง</button>
  `;

  const btn = document.getElementById('startCloudGame');
  if (btn) {
    btn.onclick = async () => {
      try {
        const entries = Object.values(state.duelPlayers || {});
        await seedGameFromEntries(entries, state.uid);
      } catch (error) {
        window.alert(error.message || 'เริ่มเกมไม่สำเร็จ');
      }
    };
  }
  document.getElementById('leaveRoomBtn')?.addEventListener('click', () => { void leaveRoom(); });
}

function renderIdentity() {
  const role = state.mePrivate?.role;
  const roleInfo = ROLES[role] || { label: '-', icon: '❓', desc: '-' };
  const partners = role === 'pob' ? (state.mePrivate?.partners || []) : [];
  const players = Object.values(state.publicState?.players || {});
  const roleText = ROLE_UI_TEXT[role]?.(partners) || '-';

  els.identity.innerHTML = `
    <h2>Step 2: เตรียมประชุมรอบแรก (เปิดดูบทบาทลับ)</h2>
    ${phaseMetaHtml()}
    <h3>วงหมู่บ้าน</h3>
    ${renderVillageGridHtml(players)}
    <div class="hidden-sheet ${isAlive() ? '' : 'is-dead'}">
      ${state.roleSheetRevealed && isAlive() ? `
      <div class="sheet-revealed identity-card">
        <div class="role-icon">${roleInfo.icon}</div>
        <h3>${roleInfo.label}</h3>
        <p class="muted">${roleText}</p>
        <div class="sheet-actions">
          <button id="hideRoleSheet" class="btn secondary">ปิดม่าน</button>
          ${state.isHost ? '<button id="goFirstVote" class="btn">เริ่มตอนเช้าแรก (โหวต)</button>' : '<p class="muted">รอ Host เริ่มเช้าแรก</p>'}
        </div>
      </div>
      ` : `
      <div class="secret-overlay" style="position:static;">
        <div>
          <p>${isAlive() ? 'แตะเพื่อดูบทบาทของคุณ' : 'คุณออกจากเกมแล้ว'}</p>
          <button id="toggleRoleSheet" class="btn sheet-btn" ${isAlive() ? '' : 'disabled'}>${isAlive() ? 'เปิดม่าน' : 'ปิดใช้งาน'}</button>
        </div>
      </div>
      `}
    </div>
    <button id="leaveRoomBtn" class="btn secondary" style="margin-top:.6rem;">ออกจากห้อง</button>
  `;

  bindTap(document.getElementById('toggleRoleSheet'), () => {
    state.roleSheetRevealed = true;
    renderIdentity();
  });
  bindTap(document.getElementById('hideRoleSheet'), () => {
    state.roleSheetRevealed = false;
    renderIdentity();
  });

  const goFirstVote = document.getElementById('goFirstVote');
  if (goFirstVote) goFirstVote.onclick = () => { void advanceIdentityToVoteByHost(); };
  document.getElementById('leaveRoomBtn')?.addEventListener('click', () => { void leaveRoom(); });
}

async function advanceIdentityToVoteByHost() {
  if (!state.isHost) return;
  await tx(paths.public, (data) => {
    if (String(data?.phase || '') !== 'identity') return data;
    return {
      ...data,
      phase: 'vote',
      phaseEndsAtMs: Date.now() + phaseDurationMs('vote'),
      lastLogs: ['เช้าแรก: เริ่มโหวตผู้ต้องสงสัย'],
      updatedAtMs: Date.now(),
    };
  });
}

async function seedGameFromEntries(entries, hostUid) {
  const seeded = buildRandomizedGameState(entries, hostUid);
  await updateWithTimeout(paths.roomRoot, {
    public: seeded.publicState,
    private: seeded.privateState,
  });
}

async function submitNightAction(targetId, acted = true) {
  if (state.isSubmittingNightAction) return;
  const myRole = state.mePrivate?.role;
  const actionConfig = ROLE_ACTION_CONFIG[myRole] || { requiresTarget: false, allowSelfTarget: false };
  const normalizedTarget = String(targetId || '').trim();
  if (actionConfig.requiresTarget && !normalizedTarget) {
    openPopup({ title: 'เลือกเป้าหมายก่อน', message: 'กรุณาเลือกเป้าหมายให้ถูกต้องก่อนยืนยันคำสั่ง' });
    return;
  }
  if (!actionConfig.allowSelfTarget && normalizedTarget === state.uid) {
    openPopup({ title: 'เลือกเป้าหมายไม่ถูกต้อง', message: 'บทบาทนี้เลือกตัวเองไม่ได้' });
    return;
  }
  if (normalizedTarget && !state.publicState?.players?.[normalizedTarget]) {
    openPopup({ title: 'ไม่พบผู้เล่น', message: 'ไม่พบเป้าหมายที่เลือกในเกมนี้' });
    return;
  }
  if (normalizedTarget && !state.publicState?.players?.[normalizedTarget]?.alive) {
    openPopup({ title: 'เป้าหมายตายแล้ว', message: 'ไม่สามารถใช้สกิลกับผู้เล่นที่ตายแล้วได้' });
    return;
  }
  if (hasNightActionForCurrentDay(state.mePrivate?.nightAction)) {
    openPopup({ title: 'แจ้งเตือน', message: 'คืนนี้คุณใช้สิทธิ์ไปแล้ว' });
    return;
  }
  const jailedTonight = deriveJailedTonightFromPrivate();
  const iAmJailed = Boolean(jailedTonight?.[state.uid]);
  if (iAmJailed) {
    openPopup({ title: 'ติดคุก', message: 'คุณโดนขัง' });
    return;
  }
  const targetIsJailed = normalizedTarget && Boolean(jailedTonight?.[normalizedTarget]);
  if (targetIsJailed && myRole !== 'police') {
    openPopup({ title: 'ใช้สกิลไม่ได้', message: 'ผู้เล่นนี้โดนขัง action คุณใช้ไม่ได้' });
    return;
  }

  const previousAction = state.mePrivate?.nightAction || null;
  try {
    state.isSubmittingNightAction = true;
    const now = Date.now();
    const day = getCurrentDay();
    state.mePrivate = {
      ...(state.mePrivate || {}),
      nightAction: { role: myRole, targetId: normalizedTarget || null, acted, at: now, order: now, day },
    };
    mountByPhase();
    await updateWithTimeout(paths.privateMine(), { nightAction: { role: myRole, targetId: normalizedTarget || null, acted, at: now, order: now, day } });
    if (state.isHost) {
      await tx(paths.public, (data) => {
        if (String(data?.phase || '') !== 'night') return data;
        const nextSubmitted = { ...(data?.nightSubmittedBy || {}), [state.uid]: now };
        return {
          ...(data || {}),
          nightSubmittedBy: nextSubmitted,
          updatedAtMs: Date.now(),
        };
      });
    }
    state.roleSheetRevealed = false;
    state.selectedNightTargetId = '';
    mountByPhase();
    const actionLabel = ROLE_ACTION_CONFIG[myRole]?.actionLabel || 'ใช้สกิล';
    const targetName = state.publicState?.players?.[normalizedTarget]?.name || 'เป้าหมาย';
    let message = myRole === 'villager'
      ? 'บันทึกแล้ว: คืนนี้คุณไถนาเรียบร้อย'
      : `บันทึกแล้ว: คุณเลือก${actionLabel} ${targetName}`;
    if (myRole === 'shaman' && normalizedTarget) {
      if (jailedTonight?.[normalizedTarget]) {
        message = `${targetName} ถูกขังอยู่ จึงดูบทบาทไม่ได้`;
      } else {
        const roleLabel = await getShamanInstantReveal(normalizedTarget);
        if (roleLabel) {
          message = `คุณส่อง ${targetName} พบว่าเป็น ${roleLabel}`;
        } else {
          message = `บันทึกแล้ว: คุณเลือก${actionLabel} ${targetName} (ผลส่องจะยืนยันอีกครั้งตอนเช้า)`;
        }
      }
    }
    openPopup({ title: 'ส่งคำสั่งสำเร็จ', message });
    await maybeResolveNightByConsensus('submit');
  } catch (error) {
    state.mePrivate = {
      ...(state.mePrivate || {}),
      nightAction: previousAction,
    };
    mountByPhase();
    openPopup({
      title: 'ส่งคำสั่งไม่สำเร็จ',
      message: error?.message || 'ไม่สามารถบันทึกคำสั่งได้',
    });
  } finally {
    state.isSubmittingNightAction = false;
  }
}

function allAliveSubmittedNight(publicState) {
  const alive = alivePlayers(publicState);
  const submitted = publicState?.nightSubmittedBy || {};
  return alive.every((player) => {
    if (submitted[player.uid]) return true;
    const privateAction = state.allPrivate?.[player.uid]?.nightAction;
    return hasNightActionForCurrentDay(privateAction);
  });
}

async function claimNightResolveLock(reason = 'auto') {
  const lockTtlMs = 15000;
  const now = Date.now();
  const manualHostForce = reason === 'manual-host' && state.isHost;
  const result = await tx(paths.public, (data) => {
    if (String(data?.phase || '') !== 'night') return data;
    const submittedEnough = manualHostForce
      || allAliveSubmittedNight(data)
      || (Number(data?.phaseEndsAtMs || 0) > 0 && now >= Number(data.phaseEndsAtMs));
    if (!submittedEnough) return data;
    const currentLock = data?.nightResolveLock || null;
    const lockFresh = currentLock?.at && (now - Number(currentLock.at) < lockTtlMs);
    if (lockFresh && currentLock?.by && currentLock.by !== state.uid) return data;
    return {
      ...(data || {}),
      nightResolveLock: {
        by: state.uid,
        at: now,
        reason,
      },
      updatedAtMs: now,
    };
  }, { timeoutMs: 8000, maxAttempts: 4 });
  return String(result?.nightResolveLock?.by || '') === state.uid;
}

async function resolveMorningWithPrivate(privateSnapshot) {
  const pub = JSON.parse(JSON.stringify(state.publicState || {}));
  const priv = privateSnapshot || {};
  const resolvedNight = resolveNight(pub, priv);
  const nextPublicForWinner = { ...pub, players: resolvedNight.players };
  const end = checkWinner(nextPublicForWinner, priv);

  await tx(paths.public, (data) => {
    if (String(data?.phase || '') !== 'night') return data;
    const lockBy = String(data?.nightResolveLock?.by || '');
    if (lockBy && lockBy !== state.uid) return data;
    return {
      ...data,
      players: resolvedNight.players,
      jailedTonight: resolvedNight.jailedTonight,
      nightSubmittedBy: {},
      nightResolveLock: null,
      phase: end ? 'end' : 'morning',
      phaseEndsAtMs: end ? 0 : (Date.now() + phaseDurationMs('morning')),
      winner: end || '',
      revealRoles: end
        ? Object.fromEntries(Object.keys(resolvedNight.players || {}).map((uid) => [uid, priv[uid]?.role || 'unknown']))
        : (data?.revealRoles || {}),
      lastLogs: resolvedNight.logs,
      nightHistory: [
        ...(Array.isArray(data?.nightHistory) ? data.nightHistory : []),
        { ...resolvedNight.nightHistoryEntry, day: Number(data?.day || 1) },
      ],
      updatedAtMs: Date.now(),
    };
  });

  await tx(paths.privateAll, (data) => {
    const next = { ...(data || {}) };
    Object.keys(next).forEach((uid) => {
      const roleMessages = resolvedNight?.roleResults?.[uid] || [];
      next[uid] = {
        ...next[uid],
        nightAction: null,
        voteTarget: null,
        nightNotice: roleMessages.join(' | '),
      };
    });
    return next;
  });
}

async function maybeResolveNightByConsensus(reason = 'auto') {
  if (state.isResolvingMorning) return;
  if (String(state.publicState?.phase || '') !== 'night') return;
  const manualHostForce = reason === 'manual-host' && state.isHost;
  const submittedEnough = allAliveSubmittedNight(state.publicState);
  const endsAt = Number(state.publicState?.phaseEndsAtMs || 0);
  const timedOut = endsAt > 0 && Date.now() >= endsAt;
  if (!manualHostForce && !submittedEnough && !timedOut) return;

  state.isResolvingMorning = true;
  try {
    const claimed = await claimNightResolveLock(reason);
    if (!claimed) return;
    const privateSnap = await readWithTimeout(paths.privateAll, 7000);
    const privateData = privateSnap.val() || {};
    await resolveMorningWithPrivate(privateData);
  } finally {
    state.isResolvingMorning = false;
  }
}

function renderNight() {
  const me = state.publicState?.players?.[state.uid];
  const myRole = state.mePrivate?.role;
  const alive = alivePlayers();
  const others = alive.filter((p) => p.uid !== state.uid);
  const acted = hasNightActionForCurrentDay(state.mePrivate?.nightAction);
  const allPlayers = Object.values(state.publicState?.players || {});
  const partners = myRole === 'pob' ? (state.mePrivate?.partners || []) : [];
  const roleText = ROLE_UI_TEXT[myRole]?.(partners) || 'ไม่พบบทบาทของคุณ';
  const jailedTonight = deriveJailedTonightFromPrivate();
  const iAmJailed = Boolean(jailedTonight[state.uid]);
  const selectedTarget = String(state.selectedNightTargetId || '').trim();

  let actionHtml = '<div class="tag">คุณออกจากเกมแล้ว</div>';
  if (me?.alive && state.roleSheetRevealed) {
    if (iAmJailed) {
      actionHtml = '<div class="tag out">คืนนี้คุณโดนตำรวจจับ ใช้พลังไม่ได้</div>';
    } else if (myRole === 'villager') {
      actionHtml = `
        <div class="tag">กดปุ่มด้านล่างเพื่อยืนยันว่าไถนาแล้ว</div>
        <button id="confirmNightActionBtn" class="btn big-btn" ${(acted || state.isSubmittingNightAction) ? 'disabled' : ''}>🌾 ยืนยันทำงาน/ไถนา</button>
      `;
    } else {
      actionHtml = `
        <div class="big-grid">${others.map((p) => `<button class="btn big-btn targetNight ${selectedTarget === p.uid ? 'ready' : ''}" data-id="${p.uid}" ${(acted || state.isSubmittingNightAction) ? 'disabled' : ''}>${p.name}${selectedTarget === p.uid ? ' ✅' : ''}</button>`).join('')}</div>
        <div class="tag" style="margin-top:.5rem;">เป้าหมายที่เลือก: ${selectedTarget ? (state.publicState?.players?.[selectedTarget]?.name || 'ผู้เล่น') : 'ยังไม่ได้เลือก'}</div>
        <button id="confirmNightActionBtn" class="btn big-btn" ${(acted || state.isSubmittingNightAction || !selectedTarget) ? 'disabled' : ''}>ยืนยันใช้สกิล</button>
      `;
    }
  }

  const actionProgressText = 'ลำดับเหตุการณ์ใช้เวลาเป็นตัวตัดสิน: ถ้าตำรวจจับก่อน เป้าหมายจะถูกขังทันที และคนอื่นที่กระทำกับผู้ถูกขังจะไม่สำเร็จ';
  const roleActionLabel = ROLE_ACTION_CONFIG[myRole]?.actionLabel || 'ใช้สกิล';

  els.night.innerHTML = `
    <h2>Step 3: กลางคืน (แต่ละอาชีพทำหน้าที่)</h2>
    ${phaseMetaHtml()}
    <p class="muted">${actionProgressText}</p>
    <p class="muted">สถานะรอบ: ส่งคำสั่งแล้ว ${Object.keys(getNightSubmittedMap()).length}/${alive.length} คน</p>
    <h3>วงหมู่บ้าน</h3>
    ${renderVillageGridHtml(allPlayers)}
    <div class="hidden-sheet ${isAlive() ? '' : 'is-dead'}">
      ${state.roleSheetRevealed && isAlive() ? `
      <div class="sheet-revealed">
        <h3>${ROLES[myRole]?.icon || '❓'} ${ROLES[myRole]?.label || 'ไม่ทราบบท'}</h3>
        <p class="muted">${roleText}</p>
        <p class="muted">คำสั่งคืนนี้: ${roleActionLabel}</p>
        <div class="sheet-actions">
          ${actionHtml}
          <button id="hideRoleSheet" class="btn secondary">ปิดม่าน</button>
        </div>
      </div>
      ` : `
      <div class="secret-overlay" style="position:static;">
        <div>
          <p>${isAlive() ? 'แตะเพื่อดูบทบาทของคุณ' : 'คุณออกจากเกมแล้ว'}</p>
          <button id="toggleRoleSheet" class="btn sheet-btn" ${isAlive() ? '' : 'disabled'}>${isAlive() ? 'เปิดม่าน' : 'ปิดใช้งาน'}</button>
        </div>
      </div>
      `}
    </div>
    ${currentNightActionStatusHtml()}
    ${nightPhaseProgressHtml()}
    ${personalNightNoticeHtml()}
    ${state.isHost ? '<button id="resolveMorning" class="btn">ประมวลผลไปช่วงเช้า</button>' : '<p class="muted">ระบบจะพาไปเช้าอัตโนมัติเมื่อครบเงื่อนไข</p>'}
    <button id="leaveRoomBtn" class="btn secondary" style="margin-top:.6rem;">ออกจากห้อง</button>
  `;

  const openSheet = () => {
    state.roleSheetRevealed = true;
    renderNight();
  };
  const closeSheet = () => {
    state.roleSheetRevealed = false;
    renderNight();
  };
  bindTap(document.getElementById('toggleRoleSheet'), openSheet);
  bindTap(document.getElementById('hideRoleSheet'), closeSheet);

  document.getElementById('confirmNightActionBtn')?.addEventListener('click', () => {
    const target = myRole === 'villager' ? state.uid : state.selectedNightTargetId;
    void submitNightAction(target, true);
  });
  document.querySelectorAll('.targetNight').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.id;
      state.selectedNightTargetId = String(targetId || '');
      renderNight();
    });
  });

  document.getElementById('resolveMorning')?.addEventListener('click', () => { void maybeResolveNightByConsensus('manual-host'); });
  document.getElementById('leaveRoomBtn')?.addEventListener('click', () => { void leaveRoom(); });
}


async function resolveMorningByHost() {
  if (!state.isHost) return;
  await maybeResolveNightByConsensus('manual-host');
}

function renderMorning() {
  const players = Object.values(state.publicState?.players || {});
  const logs = state.publicState?.lastLogs || [];
  els.morning.innerHTML = `
    <h2>Step 4: เช้าตรู่ (ดูผู้รอดชีวิตและเหตุการณ์เมื่อคืน)</h2>
    ${phaseMetaHtml()}
    <div class="result-list">${players.map((p) => `<div class="tag ${p.alive ? '' : 'out'}">${p.name}</div>`).join('')}</div>
    <div class="grid" style="margin-top:.7rem;">${logs.map((x) => `<div class="tag">${x}</div>`).join('')}</div>
    ${personalNightNoticeHtml()}
    ${state.isHost ? '<button id="toVote" class="btn" style="margin-top:.6rem;">ข้ามเวลาและเริ่มโหวตช่วงเช้า</button>' : '<p class="muted">รอ Host เริ่มโหวต หรือรอหมดเวลา</p>'}
    <button id="leaveRoomBtn" class="btn secondary" style="margin-top:.6rem;">ออกจากห้อง</button>
  `;

  document.getElementById('toVote')?.addEventListener('click', async () => {
    await tx(paths.public, (data) => ({
      ...(data || {}),
      phase: 'vote',
      phaseEndsAtMs: Date.now() + phaseDurationMs('vote'),
      updatedAtMs: Date.now(),
    }));
  });
  document.getElementById('leaveRoomBtn')?.addEventListener('click', () => { void leaveRoom(); });
}

async function advanceMorningToVoteByHost() {
  if (!state.isHost) return;
  await tx(paths.public, (data) => {
    if (String(data?.phase || '') !== 'morning') return data;
    return {
      ...data,
      phase: 'vote',
      phaseEndsAtMs: Date.now() + phaseDurationMs('vote'),
      updatedAtMs: Date.now(),
    };
  });
}

async function submitVote(targetId) {
  if (state.isSubmittingVote) return;
  const normalizedTarget = String(targetId || '').trim();
  if (!normalizedTarget) {
    openPopup({ title: 'โหวตไม่สำเร็จ', message: 'กรุณาเลือกผู้เล่นที่ต้องการโหวต' });
    return;
  }
  if (!isAlive()) {
    openPopup({ title: 'โหวตไม่ได้', message: 'ผู้เล่นที่ตายแล้วไม่สามารถโหวตได้' });
    return;
  }
  if (!state.publicState?.players?.[normalizedTarget]?.alive) {
    openPopup({ title: 'โหวตไม่สำเร็จ', message: 'ผู้เล่นที่เลือกไม่อยู่ในสถานะโหวตแล้ว' });
    return;
  }
  if (normalizedTarget === state.uid) {
    openPopup({ title: 'โหวตไม่สำเร็จ', message: 'ไม่สามารถโหวตตัวเองได้' });
    return;
  }
  try {
    state.isSubmittingVote = true;
    state.mePrivate = { ...(state.mePrivate || {}), voteTarget: normalizedTarget || null };
    mountByPhase();
    await updateWithTimeout(paths.privateMine(), { voteTarget: normalizedTarget || null }, 5000);
  } catch (error) {
    state.mePrivate = { ...(state.mePrivate || {}), voteTarget: null };
    mountByPhase();
    openPopup({
      title: 'โหวตไม่สำเร็จ',
      message: error?.message || 'ไม่สามารถบันทึกคะแนนโหวตได้',
    });
  } finally {
    state.isSubmittingVote = false;
  }
}

async function finalizeVoteByHost() {
  if (!state.isHost || state.isResolvingVote) return;
  if (String(state.publicState?.phase || '') !== 'vote') return;
  state.isResolvingVote = true;
  try {
  const lockClaimed = await claimVoteResolveLock('manual-host');
  if (!lockClaimed) return;

  const latestPublicSnap = await readWithTimeout(paths.public, 7000);
  const latestPrivateSnap = await readWithTimeout(paths.privateAll, 7000);
  const pub = JSON.parse(JSON.stringify(latestPublicSnap.val() || {}));
  const priv = latestPrivateSnap.val() || {};
  if (String(pub?.phase || '') !== 'vote') return;
  const voteResult = resolveVote(pub, priv);
  const outUid = voteResult.eliminatedUid;

  await tx(paths.public, (data) => {
    if (String(data?.phase || '') !== 'vote') return data;
    if (String(data?.voteResolveLock?.by || '') && String(data?.voteResolveLock?.by || '') !== state.uid) return data;
    return {
      ...data,
      players: voteResult.players,
      voteSummary: voteResult.voteSummary,
      phase: voteResult.winner ? 'end' : 'night',
      phaseEndsAtMs: voteResult.winner ? 0 : (Date.now() + phaseDurationMs('night')),
      actionSeq: voteResult.winner ? Number(data?.actionSeq || 0) : 0,
      winner: voteResult.winner || '',
      revealRoles: voteResult.winner
        ? Object.fromEntries(Object.keys(voteResult.players || {}).map((uid) => [uid, priv[uid]?.role || 'unknown']))
        : (data?.revealRoles || {}),
      day: voteResult.winner ? data.day : Number(data.day || 1) + (data?.isFirstDayVote ? 0 : 1),
      isFirstDayVote: false,
      nightSubmittedBy: {},
      nightResolveLock: null,
      voteResolveLock: null,
      lastLogs: outUid ? [`${voteResult.players?.[outUid]?.name || 'ผู้เล่น'} ถูกโหวตออก`] : ['ไม่มีใครถูกโหวตออก'],
      updatedAtMs: Date.now(),
    };
  });

  await tx(paths.privateAll, (data) => {
    const next = { ...(data || {}) };
    Object.keys(next).forEach((uid) => {
      next[uid] = { ...next[uid], voteTarget: null, nightAction: null };
    });
    return next;
  });
  } finally {
    state.isResolvingVote = false;
  }
}

async function claimVoteResolveLock(reason = 'auto') {
  const lockTtlMs = 15000;
  const now = Date.now();
  const result = await tx(paths.public, (data) => {
    if (String(data?.phase || '') !== 'vote') return data;
    const currentLock = data?.voteResolveLock || null;
    const lockFresh = currentLock?.at && (now - Number(currentLock.at) < lockTtlMs);
    if (lockFresh && currentLock?.by && currentLock.by !== state.uid) return data;
    return {
      ...(data || {}),
      voteResolveLock: {
        by: state.uid,
        at: now,
        reason,
      },
      updatedAtMs: now,
    };
  }, { timeoutMs: 8000, maxAttempts: 4 });
  return String(result?.voteResolveLock?.by || '') === state.uid;
}

function renderVote() {
  const alive = alivePlayers();
  const myVote = state.mePrivate?.voteTarget || '';
  const requiredVotes = Math.floor(alive.length / 2) + 1;

  const stepLabel = state.publicState?.isFirstDayVote ? 'Step 2' : 'Step 5';
  const titleText = state.publicState?.isFirstDayVote
    ? `${stepLabel}: ประชุมลูกบ้านรอบแรก (โหวตหรือไม่โหวตก็ได้)`
    : `${stepLabel}: ประชุมหมู่บ้าน (โหวตผู้ต้องสงสัย)`;


  const votesSubmitted = alive.filter((p) => state.allPrivate?.[p.uid]?.voteTarget && state.publicState?.players?.[state.allPrivate?.[p.uid]?.voteTarget]?.alive).length;
  els.vote.innerHTML = `
    <h2>${titleText}</h2>
    ${phaseMetaHtml()}
    <p class="muted">คะแนนจะรวมแบบไม่บอกว่าใครโหวตใคร และจะขับออกเมื่อได้เสียงเกินครึ่งของผู้รอดชีวิต (${requiredVotes} เสียงขึ้นไป)</p>
    <p class="muted">${state.isHost ? `สถานะโหวต ${votesSubmitted}/${alive.length} คน` : `คุณ${myVote ? 'โหวตแล้ว ✅' : 'ยังไม่โหวต ⬜'}`}</p>
    ${personalNightNoticeHtml()}
    <div class="secret-wrapper">
      ${deadOverlayHtml()}
      <div class="big-grid">${alive.filter((p) => p.uid !== state.uid).map((p) => `<button class="btn big-btn voteBtn" data-id="${p.uid}" ${isAlive() ? '' : 'disabled'}>${p.name}${myVote === p.uid ? ' ✅' : ''}</button>`).join('')}</div>
    </div>
    <div class="grid" style="margin-top:.7rem;">${Object.entries(state.publicState?.voteSummary || {}).map(([name, score]) => `<div class="tag">${name} = ${score} คะแนน</div>`).join('') || '<div class="tag">รอรวมผลโหวต</div>'}</div>
    ${state.isHost ? '<button id="finalVote" class="btn" style="margin-top:.7rem;">ข้ามเวลาและรวมคะแนนโหวต</button>' : '<p class="muted">รอ Host รวมคะแนน หรือรอหมดเวลา</p>'}
    <button id="leaveRoomBtn" class="btn secondary" style="margin-top:.6rem;">ออกจากห้อง</button>
  `;

  document.querySelectorAll('.voteBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.id;
      void submitVote(targetId);
    });
  });
  document.getElementById('finalVote')?.addEventListener('click', () => { void finalizeVoteByHost(); });
  document.getElementById('leaveRoomBtn')?.addEventListener('click', () => { void leaveRoom(); });
}

function renderEnd() {
  const winner = String(state.publicState?.winner || '');
  const revealRoles = state.publicState?.revealRoles || {};
  const historyRows = Array.isArray(state.publicState?.nightHistory) ? state.publicState.nightHistory : [];
  els.end.innerHTML = `
    <h2>Step 6: จบเกม (ประกาศฝ่ายชนะ)</h2>
    ${phaseMetaHtml()}
    <div class="tag">${winner === 'villager' ? '🎉 ฝั่งชาวบ้านชนะ' : (winner === 'cancelled' ? '⛔ เกมยุติ' : '👹 ฝั่งปอบชนะ')}</div>
    <div class="result-list" style="margin-top:.7rem;">${Object.values(state.publicState?.players || {}).map((p) => `<div class="tag ${p.alive ? '' : 'out'}">${p.name} • ${ROLES[revealRoles[p.uid]]?.label || '-'}</div>`).join('')}</div>
    <div class="grid" style="margin-top:.7rem;">
      ${historyRows.map((h) => `<div class=\"tag\">คืน ${h.day}: ${Array.isArray(h.logs) ? h.logs.join(' | ') : '-'}</div>`).join('') || '<div class=\"tag\">ไม่มี history</div>'}
    </div>
    ${state.isHost ? `<button id="restartGame" class="btn" style="margin-top:.7rem;" ${state.isRestartingGame ? 'disabled' : ''}>${state.isRestartingGame ? 'กำลังสุ่มบทใหม่...' : 'เริ่มเกมใหม่ (สุ่มบทใหม่)'}</button><button id="goHome" class="btn secondary" style="margin-top:.4rem;">กลับสู่หน้าหลัก</button>` : ''}
  `;

  document.getElementById('restartGame')?.addEventListener('click', async () => {
    if (state.isRestartingGame) return;
    state.isRestartingGame = true;
    mountByPhase();
    try {
      const entries = Object.values(state.duelPlayers || {});
      if (entries.length < 4 || entries.length > 8) {
        await tx(paths.public, (data) => ({ ...data, phase: 'setup', phaseEndsAtMs: 0, winner: '', voteSummary: {}, revealRoles: {}, actionSeq: 0, nightSubmittedBy: {}, nightResolveLock: null, voteResolveLock: null, lastLogs: ['รีเซ็ตเกม: จำนวนผู้เล่นไม่พอ กรุณารอ Host เริ่มใหม่'], updatedAtMs: Date.now() }));
      } else {
        await seedGameFromEntries(entries, state.uid);
      }
    } finally {
      state.isRestartingGame = false;
      mountByPhase();
    }
  });
  document.getElementById('goHome')?.addEventListener('click', async () => {
    await tx(paths.public, () => null);
    window.location.href = '../../duel.html';
  });
}

async function leaveRoom() {
  const isCurrentHost = String(state.publicState?.hostUid || '') === state.uid;
  if (isCurrentHost) {
    await tx(paths.public, (data) => ({
      ...data,
      phase: 'end',
      winner: 'cancelled',
      phaseEndsAtMs: 0,
      lastLogs: ['Host ออกจากห้อง ระบบยุติเกมทันที'],
      forceClosed: { reason: 'host_left', at: Date.now() },
      updatedAtMs: Date.now(),
    }));
  }
  window.location.href = '../../duel.html';
}

function mountByPhase() {
  Object.values(els).forEach((x) => x.classList.add('hidden'));
  const phase = String(state.publicState?.phase || 'setup');
  const day = getCurrentDay();
  const phaseChanged = state.lastRenderedPhase !== phase;
  const dayChanged = state.lastRenderedDay !== day;
  const currentlyAlive = isAlive();
  if (state.wasAlive && !currentlyAlive) state.roleSheetRevealed = false;
  state.wasAlive = currentlyAlive;
  state.lastRenderedPhase = phase;
  state.lastRenderedDay = day;
  document.body.classList.toggle('is-day-phase', phase === 'vote' || phase === 'morning');
  document.body.classList.toggle('is-night-phase', phase === 'night');
  if (phaseChanged || dayChanged) {
    state.roleSheetRevealed = false;
    state.selectedNightTargetId = '';
  }

  if (phase === 'setup') {
    els.setup.classList.remove('hidden');
    renderSetup();
    return;
  }
  if (phase === 'identity') {
    els.identity.classList.remove('hidden');
    renderIdentity();
    return;
  }
  if (phase === 'night') {
    els.night.classList.remove('hidden');
    renderNight();
    return;
  }
  if (phase === 'morning') {
    els.morning.classList.remove('hidden');
    renderMorning();
    return;
  }
  if (phase === 'vote') {
    els.vote.classList.remove('hidden');
    renderVote();
    return;
  }
  els.end.classList.remove('hidden');
  renderEnd();
}

function ensurePrivateAllListener() {
  if (typeof state.privateAllUnsub === 'function') return;

  state.privateAllUnsub = onValue(paths.privateAll, (snap) => {
    state.allPrivate = snap.val() || {};
    mountByPhase();
  }, () => {
    state.allPrivate = {};
  });
}

function ensurePhaseTicker() {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = window.setInterval(() => {
    if (!state.publicState) return;
    void maybeAutoAdvancePhase();
    mountByPhase();
  }, 1000);
}

async function maybeAutoAdvancePhase() {
  if (state.isAdvancingPhase) return;
  const phase = String(state.publicState?.phase || '');
  const endsAt = Number(state.publicState?.phaseEndsAtMs || 0);
  const isTimedOut = endsAt && Date.now() >= endsAt;
  state.isAdvancingPhase = true;
  try {
    if (phase === 'night') {
      await maybeResolveNightByConsensus('ticker');
      return;
    }
    if (!state.isHost || !isTimedOut) return;
    if (phase === 'identity') {
      await advanceIdentityToVoteByHost();
      return;
    }
    if (phase === 'morning') {
      await advanceMorningToVoteByHost();
      return;
    }
    if (phase === 'vote') {
      await finalizeVoteByHost();
    }
  } finally {
    state.isAdvancingPhase = false;
  }
}

async function initCloud() {
  if (!roomId) {
    renderHome('ยังไม่พบ roomId ใน URL');
    return;
  }

  try {
    await ensureAuth();
  } catch (error) {
    mountError(`Auth ไม่สำเร็จ: ${error.message || 'unknown error'}`);
    return;
  }

  const topbar = document.querySelector('.topbar p');
  if (topbar) topbar.textContent = `Cloud Mode • PIN ${pin} • UID ${state.uid.slice(0, 8)}`;
  renderLoading();

  onValue(paths.duelRoom, (snap) => {
    const room = snap.val() || {};
    state.duelPlayers = room.players || {};
    state.isHost = String(room.hostUid || '') === state.uid;
    const mode = String(room?.modeConfig?.gameMode || '');
    const status = String(room?.status || room?.state?.status || 'lobby');
    if (mode === 'pob' && status === 'playing' && state.isHost && !state.publicState) {
      const entries = Object.values(state.duelPlayers || {});
      if (entries.length >= 4 && entries.length <= 8) {
        void seedGameFromEntries(entries, state.uid).catch(() => {});
      }
    }
    const publicHost = String(state.publicState?.hostUid || '');
    const roomHost = String(room.hostUid || '');
    if (state.publicState && publicHost && roomHost && publicHost !== roomHost && String(state.publicState.phase || '') !== 'end') {
      void tx(paths.public, (data) => ({
        ...data,
        phase: 'end',
        winner: 'cancelled',
        phaseEndsAtMs: 0,
        lastLogs: ['Host หลุดออกจากห้อง ระบบยุติเกมเพื่อป้องกันข้อมูลผิดพลาด'],
        forceClosed: { reason: 'host_disconnected', at: Date.now() },
        updatedAtMs: Date.now(),
      }));
    }
    ensurePrivateAllListener();
    if (!state.publicState) {
      mountByPhase();
    }
  }, () => mountError('อ่านข้อมูลห้อง Duel ไม่ได้ (ตรวจ rules RTDB)'));

  onValue(paths.public, (snap) => {
    state.publicState = snap.val() || { phase: 'setup', players: {}, day: 1, lastLogs: [] };
    ensurePrivateAllListener();
    mountByPhase();
  }, () => mountError('อ่านข้อมูล public ไม่ได้ (ตรวจ rules RTDB)'));

  onValue(paths.privateMine(), (snap) => {
    state.mePrivate = snap.val() || {};
    mountByPhase();
  }, () => mountError('อ่านข้อมูล private ของตนเองไม่ได้ (ตรวจ rules RTDB)'));

  ensurePhaseTicker();
  window.addEventListener('beforeunload', () => {
    if (state.timerId) clearInterval(state.timerId);
    if (typeof state.privateAllUnsub === 'function') state.privateAllUnsub();
  });
}

void initCloud();
