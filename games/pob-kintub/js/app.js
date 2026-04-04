import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { getDatabase, onValue, ref, runTransaction } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js';

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
  villager: { label: 'ชาวบ้าน', icon: '🌾', desc: 'ต้องกดทำงาน ไม่งั้นอดตาย' },
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
};

const els = {
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
  if (count === 4) return ['pob', 'shaman', 'hunter', 'monk'];
  return ['pob', 'pob', 'shaman', 'monk', 'hunter', 'police', 'villager', 'villager'].slice(0, count);
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
  if (phase === 'night') return 20000;
  if (phase === 'vote') return 25000;
  if (phase === 'morning') return 12000;
  if (phase === 'identity') return 45000;
  return 0;
}

async function tx(pathRef, updater) {
  const result = await runTransaction(pathRef, updater);
  if (!result.committed) throw new Error('บันทึกข้อมูลไม่สำเร็จ');
  return result.snapshot.val();
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

function phaseMetaHtml() {
  const phase = String(state.publicState?.phase || 'setup');
  const endsAt = Number(state.publicState?.phaseEndsAtMs || 0);
  const remain = endsAt ? formatRemain(endsAt - Date.now()) : '--:--';
  return `<p class="muted">เฟส: ${phase.toUpperCase()} • เหลือเวลา ${remain}</p>`;
}

function deadOverlayHtml() {
  if (isAlive()) return '';
  return '<div class="secret-overlay"><div><h3>💀 ตายแล้ว</h3><p>ดูสถานการณ์ได้ แต่กดใช้พลังหรือโหวตไม่ได้</p></div></div>';
}

function renderSetup() {
  const players = Object.values(state.duelPlayers || {});
  const canStart = state.isHost && players.length >= 4 && players.length <= 8;
  els.setup.innerHTML = `
    <h2>Step 1: Setup (Cloud)</h2>
    <p class="muted">PIN ${pin} • ยืนยันตัวตนด้วย Firebase Authentication แล้ว</p>
    ${phaseMetaHtml()}
    <div class="player-list">${players.map((p) => `<div class="tag">${p.name || 'ผู้เล่น'} ${p.uid === state.uid ? '(คุณ)' : ''}</div>`).join('')}</div>
    ${state.isHost ? `<button id="startCloudGame" class="btn" ${canStart ? '' : 'disabled'}>เริ่มเกมปอบกินตับ</button>` : '<p class="muted">รอ Host เริ่มเกม...</p>'}
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
          hostUid: state.uid,
          phaseEndsAtMs: Date.now() + phaseDurationMs('identity'),
          players: playersMap,
          lastLogs: ['เริ่มเกมแล้ว'],
          voteSummary: {},
          nightHistory: [],
          updatedAtMs: Date.now(),
        }));

        await tx(paths.privateAll, () => privateMap);
      } catch (error) {
        window.alert(error.message || 'เริ่มเกมไม่สำเร็จ');
      }
    };
  }
}

function renderIdentity() {
  const role = state.mePrivate?.role;
  const roleInfo = ROLES[role] || { label: '-', icon: '❓', desc: '-' };
  const partners = role === 'pob' ? (state.mePrivate?.partners || []) : [];

  els.identity.innerHTML = `
    <h2>Step 2: Identity (Private)</h2>
    ${phaseMetaHtml()}
    <div class="secret-wrapper">
      <div class="secret-overlay"><button id="holdReveal" class="hold-btn">กดค้างเพื่อเปิดบทบาท (1.2s)</button></div>
      <div id="identityBody" class="hidden identity-card">
        <div class="role-icon">${roleInfo.icon}</div>
        <h3>${roleInfo.label}</h3>
        <p class="muted">${roleInfo.desc}</p>
        ${partners.length ? `<p><strong>ปอบพวกเดียวกัน:</strong> ${partners.join(', ')}</p>` : ''}
        ${state.isHost ? '<button id="goNight" class="btn">เริ่มช่วงกลางคืน</button>' : '<p class="muted">รอ Host กดเริ่มกลางคืน</p>'}
      </div>
    </div>
  `;

  const hold = document.getElementById('holdReveal');
  let timer = null;
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  hold.onmousedown = hold.ontouchstart = () => {
    timer = setTimeout(() => {
      hold.closest('.secret-overlay')?.remove();
      document.getElementById('identityBody')?.classList.remove('hidden');
    }, 1200);
  };
  hold.onmouseup = hold.onmouseleave = hold.ontouchend = hold.ontouchcancel = cancel;

  const goNight = document.getElementById('goNight');
  if (goNight) {
    goNight.onclick = () => tx(paths.public, (data) => ({
      ...data,
      phase: 'night',
      phaseEndsAtMs: Date.now() + phaseDurationMs('night'),
      lastLogs: [`คืนที่ ${Number(data?.day || 1)}`],
      updatedAtMs: Date.now(),
    }));
  }
}

async function submitNightAction(targetId, acted = true) {
  await tx(paths.privateMine(), (data) => ({ ...data, nightAction: { targetId: targetId || null, acted, at: Date.now() } }));
}

function renderNight() {
  const me = state.publicState?.players?.[state.uid];
  const myRole = state.mePrivate?.role;
  const alive = alivePlayers();
  const others = alive.filter((p) => p.uid !== state.uid);
  const acted = Boolean(state.mePrivate?.nightAction?.acted);

  let actionHtml = '<p class="muted">คุณตายแล้ว รอผลเช้า</p>';
  if (me?.alive) {
    if (myRole === 'villager') {
      actionHtml = `<button id="workBtn" class="btn big-btn" ${acted ? 'disabled' : ''}>🌾 ทำงาน/ไถนา</button>`;
    } else {
      actionHtml = `<div class="big-grid">${others.map((p) => `<button class="btn big-btn targetNight" data-id="${p.uid}" ${acted ? 'disabled' : ''}>${p.name}</button>`).join('')}</div>`;
    }
  }

  const actionsCount = alive.filter((p) => state.allPrivate?.[p.uid]?.nightAction?.acted).length;

  els.night.innerHTML = `
    <h2>Step 3: Night Action</h2>
    ${phaseMetaHtml()}
    <p class="muted">ผู้เล่นที่ส่งคำสั่งแล้ว ${actionsCount}/${alive.length}</p>
    <div class="secret-wrapper">
    ${deadOverlayHtml()}
    <div class="secret-zone">
      <h3>${ROLES[myRole]?.icon || '❓'} ${ROLES[myRole]?.label || 'ไม่ทราบบท'}</h3>
      ${actionHtml}
    </div>
    </div>
    ${state.isHost ? '<button id="resolveMorning" class="btn">ประมวลผลตอนเช้า</button>' : '<p class="muted">รอ Host ประมวลผลเช้า</p>'}
  `;

  document.getElementById('workBtn')?.addEventListener('click', () => { void submitNightAction(state.uid, true); });
  document.querySelectorAll('.targetNight').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.id;
      void submitNightAction(targetId, true);
      if (myRole === 'shaman') {
        const targetRole = ROLES[state.allPrivate?.[targetId]?.role]?.label || 'ไม่ทราบ';
        window.alert(`ส่องบท: ${state.publicState?.players?.[targetId]?.name || 'ผู้เล่น'} = ${targetRole}`);
      }
    });
  });

  document.getElementById('resolveMorning')?.addEventListener('click', () => { void resolveMorningByHost(); });
}

function markDead(nextPublic, uid, reason, logs) {
  if (!uid || !nextPublic.players?.[uid] || !nextPublic.players[uid].alive) return;
  nextPublic.players[uid].alive = false;
  logs.push(`${nextPublic.players[uid].name} ตาย (${reason})`);
}

async function resolveMorningByHost() {
  if (!state.isHost || state.isResolvingMorning) return;
  state.isResolvingMorning = true;
  try {
  const pub = JSON.parse(JSON.stringify(state.publicState || {}));
  const priv = state.allPrivate || {};
  const alive = Object.values(pub.players || {}).filter((p) => p.alive);
  const uidByRole = (role) => alive.filter((p) => priv[p.uid]?.role === role).map((p) => p.uid);

  const pobUid = uidByRole('pob')[0] || null;
  const policeUid = uidByRole('police')[0] || null;
  const monkUid = uidByRole('monk')[0] || null;
  const hunterUid = uidByRole('hunter')[0] || null;

  const pobTarget = priv[pobUid]?.nightAction?.targetId || null;
  const jailed = priv[policeUid]?.nightAction?.targetId || null;
  const protectedUid = priv[monkUid]?.nightAction?.targetId || null;
  const hunterTarget = priv[hunterUid]?.nightAction?.targetId || null;

  const logs = [];
  const jailedIsPob = Boolean(jailed && priv[jailed]?.role === 'pob');

  if (jailed) logs.push(`${pub.players?.[jailed]?.name || 'ผู้เล่น'} ถูกตำรวจจับ`);

  if (pobTarget) {
    if (jailedIsPob) {
      logs.push('ตำรวจจับปอบได้ ยกเลิกการฆ่าปอบคืนนี้');
    } else if (pobTarget === protectedUid) {
      logs.push(`${pub.players?.[pobTarget]?.name || 'ผู้เล่น'} ได้รับการคุ้มครองจากหมอธรรม`);
    } else if (pobTarget === jailed) {
      logs.push(`${pub.players?.[pobTarget]?.name || 'ผู้เล่น'} อยู่ในคุก จึงไม่ตาย`);
    } else {
      markDead(pub, pobTarget, 'โดนปอบฆ่า', logs);
    }
  }

  if (hunterTarget) {
    if (hunterTarget === jailed) {
      logs.push(`${pub.players?.[hunterTarget]?.name || 'ผู้เล่น'} อยู่ในคุก เลยรอดจากพราน`);
    } else {
      markDead(pub, hunterTarget, 'โดนพรานยิง', logs);
    }
  }

  alive.filter((p) => priv[p.uid]?.role === 'villager').forEach((villager) => {
    const acted = Boolean(priv[villager.uid]?.nightAction?.acted);
    if (!acted) markDead(pub, villager.uid, 'ไม่กดทำงาน', logs);
  });

  await tx(paths.public, (data) => ({
    ...data,
    players: pub.players,
    phase: 'morning',
    phaseEndsAtMs: Date.now() + phaseDurationMs('morning'),
    lastLogs: logs.length ? logs : ['คืนนี้ไม่มีคนตาย'],
    nightHistory: [
      ...(Array.isArray(data?.nightHistory) ? data.nightHistory : []),
      {
        day: Number(data?.day || 1),
        policeTarget: jailed ? (pub.players?.[jailed]?.name || '') : '',
        monkTarget: protectedUid ? (pub.players?.[protectedUid]?.name || '') : '',
        pobTarget: pobTarget ? (pub.players?.[pobTarget]?.name || '') : '',
        hunterTarget: hunterTarget ? (pub.players?.[hunterTarget]?.name || '') : '',
        logs: logs.length ? logs : ['คืนนี้ไม่มีคนตาย'],
      },
    ],
    updatedAtMs: Date.now(),
  }));

  await tx(paths.privateAll, (data) => {
    const next = { ...(data || {}) };
    Object.keys(next).forEach((uid) => {
      next[uid] = { ...next[uid], nightAction: null, voteTarget: null };
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
    <h2>Step 4: Morning (Public)</h2>
    ${phaseMetaHtml()}
    <div class="result-list">${players.map((p) => `<div class="tag ${p.alive ? '' : 'out'}">${p.name}</div>`).join('')}</div>
    <div class="grid" style="margin-top:.7rem;">${logs.map((x) => `<div class="tag">${x}</div>`).join('')}</div>
    ${state.isHost ? '<button id="toVote" class="btn" style="margin-top:.6rem;">ไปช่วงโหวตลับ</button>' : '<p class="muted">รอ Host ไปช่วงโหวต</p>'}
  `;

  document.getElementById('toVote')?.addEventListener('click', async () => {
    await tx(paths.public, (data) => ({
      ...data,
      phase: 'vote',
      phaseEndsAtMs: Date.now() + phaseDurationMs('vote'),
      updatedAtMs: Date.now(),
    }));
  });
}

async function submitVote(targetId) {
  await tx(paths.privateMine(), (data) => ({ ...data, voteTarget: targetId || null }));
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
    if (!tieTop && top > alive.length / 2) outUid = sorted[0][0];
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
    winner: end || '',
    revealRoles: end
      ? Object.fromEntries(Object.keys(pub.players || {}).map((uid) => [uid, priv[uid]?.role || 'unknown']))
      : (data?.revealRoles || {}),
    day: end ? data.day : Number(data.day || 1) + 1,
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

function checkWinner(publicState, privateState) {
  const alive = Object.values(publicState.players || {}).filter((p) => p.alive);
  const pobAlive = alive.filter((p) => privateState[p.uid]?.role === 'pob').length;
  const villagerAlive = alive.length - pobAlive;
  if (pobAlive === 0) return 'villager';
  if (villagerAlive <= pobAlive) return 'pob';
  return '';
}

function renderVote() {
  const alive = alivePlayers();
  const myVote = state.mePrivate?.voteTarget || '';
  els.vote.innerHTML = `
    <h2>Step 5: Blind Vote</h2>
    ${phaseMetaHtml()}
    <p class="muted">คะแนนจะรวมแบบไม่บอกว่าใครโหวตใคร</p>
    <div class="secret-wrapper">
      ${deadOverlayHtml()}
      <div class="big-grid">${alive.filter((p) => p.uid !== state.uid).map((p) => `<button class="btn big-btn voteBtn" data-id="${p.uid}" ${isAlive() ? '' : 'disabled'}>${p.name}${myVote === p.uid ? ' ✅' : ''}</button>`).join('')}</div>
    </div>
    <div class="grid" style="margin-top:.7rem;">${Object.entries(state.publicState?.voteSummary || {}).map(([name, score]) => `<div class="tag">${name} = ${score} คะแนน</div>`).join('') || '<div class="tag">รอรวมผลโหวต</div>'}</div>
    ${state.isHost ? '<button id="finalVote" class="btn" style="margin-top:.7rem;">รวมคะแนนโหวต</button>' : '<p class="muted">รอ Host รวมคะแนน</p>'}
  `;

  document.querySelectorAll('.voteBtn').forEach((btn) => {
    btn.addEventListener('click', () => { void submitVote(btn.dataset.id); });
  });
  document.getElementById('finalVote')?.addEventListener('click', () => { void finalizeVoteByHost(); });
}

function renderEnd() {
  const winner = String(state.publicState?.winner || '');
  const revealRoles = state.publicState?.revealRoles || {};
  const historyRows = Array.isArray(state.publicState?.nightHistory) ? state.publicState.nightHistory : [];
  els.end.innerHTML = `
    <h2>Step 6: End Game</h2>
    ${phaseMetaHtml()}
    <div class="tag">${winner === 'villager' ? '🎉 ฝั่งชาวบ้านชนะ' : '👹 ฝั่งปอบชนะ'}</div>
    <div class="result-list" style="margin-top:.7rem;">${Object.values(state.publicState?.players || {}).map((p) => `<div class="tag ${p.alive ? '' : 'out'}">${p.name} • ${ROLES[revealRoles[p.uid]]?.label || '-'}</div>`).join('')}</div>
    <div class="grid" style="margin-top:.7rem;">
      ${historyRows.map((h) => `<div class=\"tag\">คืน ${h.day}: ${Array.isArray(h.logs) ? h.logs.join(' | ') : '-'}</div>`).join('') || '<div class=\"tag\">ไม่มี history</div>'}
    </div>
    ${state.isHost ? '<button id="restartGame" class="btn" style="margin-top:.7rem;">เริ่มใหม่</button><button id="goHome" class="btn secondary" style="margin-top:.4rem;">กลับสู่หน้าหลัก</button>' : ''}
  `;

  document.getElementById('restartGame')?.addEventListener('click', async () => {
    await tx(paths.public, (data) => ({ ...data, phase: 'setup', phaseEndsAtMs: 0, winner: '', voteSummary: {}, revealRoles: {}, lastLogs: ['รีเซ็ตเกม'], updatedAtMs: Date.now() }));
    await tx(paths.privateAll, () => null);
  });
  document.getElementById('goHome')?.addEventListener('click', async () => {
    await tx(paths.privateAll, () => null);
    await tx(paths.public, () => null);
    window.location.href = '../../../duel.html';
  });
}

function mountByPhase() {
  Object.values(els).forEach((x) => x.classList.add('hidden'));
  const phase = String(state.publicState?.phase || 'setup');

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

function ensurePhaseTicker() {
  if (state.timerId) clearInterval(state.timerId);
  state.timerId = window.setInterval(async () => {
    if (!state.publicState) return;
    const endsAt = Number(state.publicState.phaseEndsAtMs || 0);
    if (!endsAt) {
      mountByPhase();
      return;
    }
    const remain = endsAt - Date.now();
    if (remain > 0) {
      mountByPhase();
      return;
    }

    if (!state.isHost) return;
    const phase = String(state.publicState.phase || 'setup');
    if (phase === 'identity') {
      await tx(paths.public, (data) => ({ ...data, phase: 'night', phaseEndsAtMs: Date.now() + phaseDurationMs('night'), updatedAtMs: Date.now() }));
      return;
    }
    if (phase === 'night') {
      await resolveMorningByHost();
      return;
    }
    if (phase === 'morning') {
      await tx(paths.public, (data) => ({ ...data, phase: 'vote', phaseEndsAtMs: Date.now() + phaseDurationMs('vote'), updatedAtMs: Date.now() }));
      return;
    }
    if (phase === 'vote') {
      await finalizeVoteByHost();
    }
  }, 1000);
}

async function initCloud() {
  if (!roomId) {
    mountError('ไม่พบ roomId กรุณาเข้าจากโหมด Duel Host/Join');
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
    if (!state.publicState) {
      mountByPhase();
    }
  }, () => mountError('อ่านข้อมูลห้อง Duel ไม่ได้ (ตรวจ rules RTDB)'));

  onValue(paths.public, (snap) => {
    state.publicState = snap.val() || { phase: 'setup', players: {}, day: 1, lastLogs: [] };
    mountByPhase();
  }, () => mountError('อ่านข้อมูล public ไม่ได้ (ตรวจ rules RTDB)'));

  onValue(paths.privateMine(), (snap) => {
    state.mePrivate = snap.val() || {};
    mountByPhase();
  }, () => mountError('อ่านข้อมูล private ของตนเองไม่ได้ (ตรวจ rules RTDB)'));

  onValue(paths.privateAll, (snap) => {
    if (state.isHost) {
      state.allPrivate = snap.val() || {};
      mountByPhase();
    }
  });

  ensurePhaseTicker();
  window.addEventListener('beforeunload', () => {
    if (state.timerId) clearInterval(state.timerId);
  });
}

void initCloud();
