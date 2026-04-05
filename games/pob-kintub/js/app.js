import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { getDatabase, onValue, ref, runTransaction } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js';
import { checkWinner, resolveNight } from './gameEngine.js';

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
  shaman: { label: 'หมอผี', icon: '🔮', desc: 'ส่องบท 1 คน/คืน' },
  monk: { label: 'หมอธรรม', icon: '🛡️', desc: 'คุ้มครอง 1 คน/คืน' },
  hunter: { label: 'นายพราน', icon: '🏹', desc: 'ยิง 1 คน/คืน' },
  police: { label: 'ตำรวจ', icon: '👮', desc: 'จับ 1 คนเข้าคุก/คืน' },
  villager: { label: 'ชาวนา', icon: '🌾', desc: 'ต้องกดทำงาน ไม่งั้นอดตาย' },
};
const ROLE_UI_TEXT = {
  pob: (partners = []) => `คุณคือปอบ จกตับชาวบ้านได้ 1 คนต่อคืน (เพื่อนของคุณคือ: ${partners.length ? partners.join(', ') : 'ไม่มี'})`,
  shaman: () => 'คุณคือหมอผี เลือกส่องดูอาชีพจริงของเพื่อนได้ 1 คนต่อคืน',
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
  lastRenderedPhase: '',
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
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runTransaction(pathRef, updater);
    if (result.committed) return result.snapshot.val();
    if (attempt >= maxAttempts) break;
    await new Promise((resolve) => setTimeout(resolve, 120 * attempt));
  }
  throw new Error('บันทึกข้อมูลไม่สำเร็จ');
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
  return `
    <div class="village-grid">
      ${players.map((p) => `
        <div class="villager-card ${p.alive ? '' : 'dead'}">
          <div class="villager-icon">${p.alive ? '🙂' : '💀'}</div>
          <div class="villager-name">${p.name}${p.uid === state.uid ? ' 👤' : ''}</div>
          <div class="villager-status">${p.alive ? 'ยังอยู่ในเกม' : 'ตายแล้ว'}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function getNightActionStatusByUid(uid) {
  const player = state.publicState?.players?.[uid];
  if (!player?.alive) return { done: false, text: '💀 ตายแล้ว' };
  const role = state.allPrivate?.[uid]?.role || '';
  const acted = Boolean(state.allPrivate?.[uid]?.nightAction?.acted);
  if (!role) return { done: false, text: '… ยังไม่ระบุบท' };
  return acted
    ? { done: true, text: `✅ ${ROLES[role]?.label || role} ทำหน้าที่แล้ว` }
    : { done: false, text: `⬜ ${ROLES[role]?.label || role} ยังไม่ทำหน้าที่` };
}

function personalNightNoticeHtml() {
  const notice = String(state.mePrivate?.nightNotice || '').trim();
  if (!notice) return '';
  return `<div class="tag" style="margin-top:.55rem;">📌 ผลการทำหน้าที่เมื่อคืน: ${notice}</div>`;
}

function currentNightActionStatusHtml() {
  const action = state.mePrivate?.nightAction;
  if (!action?.acted) return '';
  const role = String(state.mePrivate?.role || '');
  const actionLabel = ROLE_ACTION_CONFIG[role]?.actionLabel || 'ใช้สกิล';
  const targetId = String(action?.targetId || '').trim();
  const targetName = targetId ? (state.publicState?.players?.[targetId]?.name || 'ผู้เล่น') : '';
  const text = role === 'villager'
    ? `✅ คุณไถนาแล้วในคืนนี้`
    : `✅ คุณเลือก${actionLabel}เป้าหมาย: ${targetName || 'ไม่ระบุ'}`;
  return `<div class="tag ready" style="margin-top:.55rem;">${text}</div>`;
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

function renderSetup() {
  const players = Object.values(state.duelPlayers || {});
  const canStart = state.isHost && players.length >= 4 && players.length <= 8;
  els.setup.innerHTML = `
    <h2>Step 1: Setup (Cloud)</h2>
    <p class="muted">PIN ${pin} • ยืนยันตัวตนด้วย Firebase Authentication แล้ว</p>
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
        const roles = shuffle(rolePool(entries.length));
        const playersMap = {};
        const privateMap = {};

        entries.forEach((p, idx) => {
          playersMap[p.uid] = { uid: p.uid, name: p.name || 'ผู้เล่น', alive: true, roleHint: 'hidden' };
          privateMap[p.uid] = { role: roles[idx], partners: [], nightAction: null, voteTarget: null };
        });
        entries.forEach((p) => {
          if (privateMap[p.uid].role !== 'pob') return;
          privateMap[p.uid].partners = entries
            .filter((x) => x.uid !== p.uid && privateMap[x.uid].role === 'pob')
            .map((x) => x.name || 'ผู้เล่น');
        });

        await tx(paths.public, () => ({
          phase: 'identity',
          day: 1,
          isFirstDayVote: true,
          hostUid: state.uid,
          startedAtMs: Date.now(),
          hardStopAtMs: gameHardStopAtMs(Date.now()),
          phaseEndsAtMs: Date.now() + phaseDurationMs('identity'),
          players: playersMap,
          lastLogs: ['เริ่มเกมแล้ว'],
          voteSummary: {},
          actionSeq: 0,
          nightHistory: [],
          jailedTonight: {},
          forceClosed: null,
          updatedAtMs: Date.now(),
        }));

        await tx(paths.privateAll, () => privateMap);
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
    <h2>Step 2: Identity (Private)</h2>
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

  document.getElementById('toggleRoleSheet')?.addEventListener('click', () => {
    state.roleSheetRevealed = true;
    renderIdentity();
  });
  document.getElementById('hideRoleSheet')?.addEventListener('click', () => {
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
  if (state.mePrivate?.nightAction?.acted) {
    openPopup({ title: 'แจ้งเตือน', message: 'คืนนี้คุณใช้สิทธิ์ไปแล้ว' });
    return;
  }
  const jailedTonight = state.publicState?.jailedTonight || {};
  const iAmJailed = Boolean(jailedTonight?.[state.uid]);
  if (iAmJailed) {
    openPopup({ title: 'ติดคุก', message: 'คุณโดนจับเข้าคุกแล้ว ใช้พลังคืนนี้ไม่ได้' });
    return;
  }

  try {
    state.isSubmittingNightAction = true;
    const now = Date.now();
    state.mePrivate = {
      ...(state.mePrivate || {}),
      nightAction: { role: myRole, targetId: normalizedTarget || null, acted, at: now, order: now },
    };
    mountByPhase();
    await tx(paths.privateMine(), (data) => ({ ...data, nightAction: { role: myRole, targetId: normalizedTarget || null, acted, at: now, order: now } }));
    const actionLabel = ROLE_ACTION_CONFIG[myRole]?.actionLabel || 'ใช้สกิล';
    const targetName = state.publicState?.players?.[normalizedTarget]?.name || 'เป้าหมาย';
    const message = myRole === 'villager'
      ? 'บันทึกแล้ว: คืนนี้คุณไถนาเรียบร้อย'
      : `บันทึกแล้ว: คุณเลือก${actionLabel} ${targetName}`;
    openPopup({ title: 'ส่งคำสั่งสำเร็จ', message });
  } catch (error) {
    state.mePrivate = {
      ...(state.mePrivate || {}),
      nightAction: null,
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

function renderNight() {
  const me = state.publicState?.players?.[state.uid];
  const myRole = state.mePrivate?.role;
  const alive = alivePlayers();
  const others = alive.filter((p) => p.uid !== state.uid);
  const acted = Boolean(state.mePrivate?.nightAction?.acted);
  const allPlayers = Object.values(state.publicState?.players || {});
  const partners = myRole === 'pob' ? (state.mePrivate?.partners || []) : [];
  const roleText = ROLE_UI_TEXT[myRole]?.(partners) || 'ไม่พบบทบาทของคุณ';
  const jailedTonight = state.publicState?.jailedTonight || {};
  const iAmJailed = Boolean(jailedTonight[state.uid]);

  let actionHtml = '<div class="tag">คุณออกจากเกมแล้ว</div>';
  if (me?.alive && state.roleSheetRevealed) {
    if (iAmJailed) {
      actionHtml = '<div class="tag out">คืนนี้คุณโดนตำรวจจับ ใช้พลังไม่ได้</div>';
    } else
    if (myRole === 'villager') {
      actionHtml = `<button id="workBtn" class="btn big-btn" ${acted ? 'disabled' : ''}>🌾 ทำงาน/ไถนา</button>`;
    } else {
      actionHtml = `<div class="big-grid">${others.map((p) => `<button class="btn big-btn targetNight" data-id="${p.uid}" ${acted ? 'disabled' : ''}>${p.name}</button>`).join('')}</div>`;
    }
  }

  const actionsCount = alive.filter((p) => state.allPrivate?.[p.uid]?.nightAction?.acted).length;
  const actionProgressText = state.isHost
    ? `ผู้เล่นที่ส่งคำสั่งแล้ว ${actionsCount}/${alive.length}`
    : 'ส่งคำสั่งของคุณได้ตามปกติ ระบบจะรวมผลให้ Host อัตโนมัติ';
  const roleActionLabel = ROLE_ACTION_CONFIG[myRole]?.actionLabel || 'ใช้สกิล';

  els.night.innerHTML = `
    <h2>Step 4: Night Action</h2>
    ${phaseMetaHtml()}
    <p class="muted">${actionProgressText}</p>
    <p class="muted">คนที่โดนจับคืนนี้: ${Object.keys(jailedTonight).length ? Object.keys(jailedTonight).map((uid) => state.publicState?.players?.[uid]?.name || 'ผู้เล่น').join(', ') : 'ยังไม่มี'}</p>
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
    ${personalNightNoticeHtml()}
    ${state.isHost ? `
      <h3 style="margin-top:.9rem;">บอร์ดสถานะการทำหน้าที่ (Host)</h3>
      <div class="role-progress-grid">
        ${alive.map((p) => {
          const status = getNightActionStatusByUid(p.uid);
          return `<div class="tag ${status.done ? 'ready' : ''}">${p.name} • ${status.text}</div>`;
        }).join('')}
      </div>
    ` : ''}
    ${state.isHost ? '<button id="resolveMorning" class="btn">ข้ามเวลาและประมวลผลตอนเช้า</button>' : '<p class="muted">รอ Host ประมวลผลเช้า หรือรอหมดเวลา</p>'}
    <button id="leaveRoomBtn" class="btn secondary" style="margin-top:.6rem;">ออกจากห้อง</button>
  `;

  document.getElementById('toggleRoleSheet')?.addEventListener('click', () => {
    state.roleSheetRevealed = true;
    renderNight();
  });
  document.getElementById('hideRoleSheet')?.addEventListener('click', () => {
    state.roleSheetRevealed = false;
    renderNight();
  });

  document.getElementById('workBtn')?.addEventListener('click', () => {
    state.roleSheetRevealed = false;
    void submitNightAction(state.uid, true);
  });
  document.querySelectorAll('.targetNight').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.id;
      state.roleSheetRevealed = false;
      void submitNightAction(targetId, true);
    });
  });

  document.getElementById('resolveMorning')?.addEventListener('click', () => { void resolveMorningByHost(); });
  document.getElementById('leaveRoomBtn')?.addEventListener('click', () => { void leaveRoom(); });
}


async function resolveMorningByHost() {
  if (!state.isHost || state.isResolvingMorning) return;
  state.isResolvingMorning = true;
  try {
  const pub = JSON.parse(JSON.stringify(state.publicState || {}));
  const priv = state.allPrivate || {};
  const resolvedNight = resolveNight(pub, priv);
  const nextPublicForWinner = { ...pub, players: resolvedNight.players };
  const end = checkWinner(nextPublicForWinner, priv);

  await tx(paths.public, (data) => ({
    ...data,
    players: resolvedNight.players,
    jailedTonight: resolvedNight.jailedTonight,
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
  }));

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
  } finally {
    state.isResolvingMorning = false;
  }
}

function renderMorning() {
  const players = Object.values(state.publicState?.players || {});
  const logs = state.publicState?.lastLogs || [];
  els.morning.innerHTML = `
    <h2>Step 5: Morning (Public)</h2>
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
    await tx(paths.privateMine(), (data) => ({ ...data, voteTarget: normalizedTarget || null }));
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
  state.isResolvingVote = true;
  try {
  const pub = JSON.parse(JSON.stringify(state.publicState || {}));
  const priv = state.allPrivate || {};
  const alive = Object.values(pub.players || {}).filter((p) => p.alive);
  const tally = {};

  alive.forEach((p) => {
    const target = priv[p.uid]?.voteTarget;
    if (!target || !pub.players?.[target]?.alive) return;
    tally[target] = (tally[target] || 0) + 1;
  });

  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  let outUid = null;
  if (sorted.length) {
    const top = sorted[0][1];
    const tieTop = sorted.filter(([, c]) => c === top).length > 1;
    if (!tieTop && top > 0) outUid = sorted[0][0];
  }

  if (outUid) pub.players[outUid].alive = false;

  const summary = Object.fromEntries(sorted.map(([uid, score]) => [pub.players?.[uid]?.name || uid, score]));
  const end = checkWinner(pub, priv);

  await tx(paths.public, (data) => ({
    ...data,
    players: pub.players,
    voteSummary: summary,
    phase: end ? 'end' : 'night',
    phaseEndsAtMs: end ? 0 : (Date.now() + phaseDurationMs('night')),
    actionSeq: end ? Number(data?.actionSeq || 0) : 0,
    winner: end || '',
    revealRoles: end
      ? Object.fromEntries(Object.keys(pub.players || {}).map((uid) => [uid, priv[uid]?.role || 'unknown']))
      : (data?.revealRoles || {}),
    day: end ? data.day : Number(data.day || 1) + (data?.isFirstDayVote ? 0 : 1),
    isFirstDayVote: false,
    lastLogs: outUid ? [`${pub.players?.[outUid]?.name || 'ผู้เล่น'} ถูกโหวตออก`] : ['ไม่มีใครถูกโหวตออก'],
    updatedAtMs: Date.now(),
  }));

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

function renderVote() {
  const alive = alivePlayers();
  const myVote = state.mePrivate?.voteTarget || '';
  const votesSubmitted = alive.filter((p) => state.allPrivate?.[p.uid]?.voteTarget && state.publicState?.players?.[state.allPrivate?.[p.uid]?.voteTarget]?.alive).length;
  els.vote.innerHTML = `
    <h2>Step 3: Day Vote</h2>
    ${phaseMetaHtml()}
    <p class="muted">คะแนนจะรวมแบบไม่บอกว่าใครโหวตใคร</p>
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
    <h2>Step 6: End Game</h2>
    ${phaseMetaHtml()}
    <div class="tag">${winner === 'villager' ? '🎉 ฝั่งชาวบ้านชนะ' : (winner === 'cancelled' ? '⛔ เกมยุติ' : '👹 ฝั่งปอบชนะ')}</div>
    <div class="result-list" style="margin-top:.7rem;">${Object.values(state.publicState?.players || {}).map((p) => `<div class="tag ${p.alive ? '' : 'out'}">${p.name} • ${ROLES[revealRoles[p.uid]]?.label || '-'}</div>`).join('')}</div>
    <div class="grid" style="margin-top:.7rem;">
      ${historyRows.map((h) => `<div class=\"tag\">คืน ${h.day}: ${Array.isArray(h.logs) ? h.logs.join(' | ') : '-'}</div>`).join('') || '<div class=\"tag\">ไม่มี history</div>'}
    </div>
    ${state.isHost ? '<button id="restartGame" class="btn" style="margin-top:.7rem;">เริ่มใหม่</button><button id="goHome" class="btn secondary" style="margin-top:.4rem;">กลับสู่หน้าหลัก</button>' : ''}
  `;

  document.getElementById('restartGame')?.addEventListener('click', async () => {
    await tx(paths.public, (data) => ({ ...data, phase: 'setup', phaseEndsAtMs: 0, winner: '', voteSummary: {}, revealRoles: {}, actionSeq: 0, lastLogs: ['รีเซ็ตเกม'], updatedAtMs: Date.now() }));
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
  const phaseChanged = state.lastRenderedPhase !== phase;
  const currentlyAlive = isAlive();
  if (state.wasAlive && !currentlyAlive) state.roleSheetRevealed = false;
  state.wasAlive = currentlyAlive;
  state.lastRenderedPhase = phase;
  document.body.classList.toggle('is-day-phase', phase === 'vote' || phase === 'morning');
  document.body.classList.toggle('is-night-phase', phase === 'night');
  if (phaseChanged) state.roleSheetRevealed = false;

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
  if (!state.isHost) {
    if (typeof state.privateAllUnsub === 'function') {
      state.privateAllUnsub();
      state.privateAllUnsub = null;
    }
    state.allPrivate = {};
    return;
  }
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
    void maybeAutoAdvancePhaseByHost();
    mountByPhase();
  }, 1000);
}

async function maybeAutoAdvancePhaseByHost() {
  if (!state.isHost || state.isAdvancingPhase) return;
  const phase = String(state.publicState?.phase || '');
  const endsAt = Number(state.publicState?.phaseEndsAtMs || 0);
  if (!endsAt || Date.now() < endsAt) return;
  state.isAdvancingPhase = true;
  try {
    if (phase === 'identity') {
      await advanceIdentityToVoteByHost();
      return;
    }
    if (phase === 'night') {
      await resolveMorningByHost();
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

  onValue(paths.duelRoom, (snap) => {
    const room = snap.val() || {};
    state.duelPlayers = room.players || {};
    state.isHost = String(room.hostUid || '') === state.uid;
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
