import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { getDatabase, onValue, ref, runTransaction, set, update } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js';
import { doc, getDoc, getFirestore } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';
import { DEFAULT_LOGIC_SPY_WORD_SETS, buildRoundAssignments, calculateRoundScore, pickWordSet } from './gameEngine.js';

const config = {
  apiKey: 'AIzaSyC4jOmVcZp0HmmDqZCmHufnq2yyoPcvyVM',
  authDomain: 'pakdu-a26c4.firebaseapp.com',
  databaseURL: 'https://pakdu-a26c4-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'pakdu-a26c4',
  storageBucket: 'pakdu-a26c4.firebasestorage.app',
  messagingSenderId: '414809008203',
  appId: '1:414809008203:web:757dceafa78d91900d85ce',
};

const SECRET_SECONDS = 20;
const TURN_SECONDS = 18;
const VOTE_SECONDS = 25;
const RESULT_SECONDS = 12;

const app = initializeApp(config);
const db = getDatabase(app);
const fs = getFirestore(app);
const auth = getAuth(app);

const params = new URLSearchParams(window.location.search);
const roomId = String(params.get('roomId') || '').trim();
const duelRoomPath = `rooms/${roomId}`;
const gameRoomPath = `logic_spy_rooms/${roomId}`;
const gamePublicPath = `${gameRoomPath}/public`;
const duelRef = ref(db, duelRoomPath);
const gamePublicRef = ref(db, gamePublicPath);

const el = {
  status: document.getElementById('status'),
  lobby: document.getElementById('lobby'),
  secret: document.getElementById('secret'),
  discussion: document.getElementById('discussion'),
  vote: document.getElementById('vote'),
  result: document.getElementById('result'),
};

const state = {
  uid: '',
  duel: null,
  game: null,
  privateMe: null,
  sets: DEFAULT_LOGIC_SPY_WORD_SETS,
  maintenanceBusy: false,
  startFlowMessage: '',
  voteModalOpen: false,
};

function getPlayers() {
  return Object.entries(state.duel?.players || {})
    .sort((a, b) => Number(a?.[1]?.joinedAt || 0) - Number(b?.[1]?.joinedAt || 0))
    .slice(0, 5);
}

function displayPlayerName(uid, fallbackName = 'ผู้เล่น') {
  const baseName = String(fallbackName || uid || 'ผู้เล่น');
  return uid === state.uid ? `${baseName} 🫵` : baseName;
}

function getModeratorUid() {
  const players = getPlayers();
  if (!players.length) return '';
  const hostUid = String(state.duel?.hostUid || '');
  const roomModeratorUid = String(state.duel?.moderatorUid || '');
  if (roomModeratorUid && players.some(([uid]) => uid === roomModeratorUid)) return roomModeratorUid;
  if (hostUid && players.some(([uid]) => uid === hostUid)) return hostUid;
  return '';
}

function canModerate() {
  const uid = String(state.uid || '');
  if (!uid) return false;
  const hostUid = String(state.duel?.hostUid || '');
  const moderatorUid = getModeratorUid();
  return uid === moderatorUid || (Boolean(hostUid) && uid === hostUid);
}

function setStartFlowMessage(message) {
  state.startFlowMessage = String(message || '').trim();
}

function failStartRound(reason, context = {}) {
  const roomHostUid = String(state.duel?.hostUid || '');
  const moderatorUid = getModeratorUid();
  const payload = {
    reason,
    currentUid: state.uid,
    roomHostUid,
    moderatorUid,
    roomId,
    duelRoomPath,
    gameRoomPath,
    ...context,
  };
  console.error('[logic-spy][start-round] blocked', payload);
  setStartFlowMessage(`เริ่มรอบไม่ได้: ${reason}`);
  return false;
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

async function loadWordSets() {
  try {
    const snap = await getDoc(doc(fs, 'settings', 'logic_spy_word_sets'));
    const sets = snap.exists() ? snap.data()?.sets : null;
    if (Array.isArray(sets) && sets.length) state.sets = sets;
  } catch (_) {}
}

function phaseRemainSeconds(targetMs) {
  return Math.max(0, Math.ceil((Number(targetMs || 0) - Date.now()) / 1000));
}

function updateVisibleSections(phase) {
  el.lobby.classList.toggle('hidden', phase !== 'lobby');
  el.secret.classList.toggle('hidden', phase !== 'secret');
  el.discussion.classList.toggle('hidden', phase !== 'discussion');
  el.vote.classList.toggle('hidden', phase !== 'vote');
  el.result.classList.toggle('hidden', phase !== 'result');
}

function ui() {
  const players = getPlayers();
  const duelPlayersByUid = state.duel?.players || {};
  const game = state.game || { status: 'lobby', scores: {}, votes: {} };
  const phase = String(game.status || 'lobby');
  const myWord = String(state.privateMe?.word || '');
  const moderatorUid = getModeratorUid();
  const isMeModerator = canModerate();
  const roomHostUid = String(state.duel?.hostUid || '');

  const chips = players
    .map(([uid, player]) => `<span class="chip">${displayPlayerName(uid, player?.name || 'ผู้เล่น')}${uid === moderatorUid ? ' 👑' : ''}</span>`)
    .join('');

  const scoreRows = players
    .map(([uid, player]) => `<div class="vote-item"><b>${displayPlayerName(uid, player?.name || uid)}</b><span>${Number(game?.scores?.[uid] || 0)} แต้ม</span></div>`)
    .join('');

  el.status.innerHTML = `<div>ห้อง: <b>${roomId || '-'}</b> • ผู้เล่น: ${players.length}/5 • สถานะ: <b>${phase}</b></div>`;
  updateVisibleSections(phase);

  el.lobby.innerHTML = `
    <h3>Lobby</h3>
    <p>โหมดนี้ต้องมี 3-5 คน</p>
    <p class="muted">Host(Room): <b>${roomHostUid || '-'}</b> • ผู้คุมเกม: <b>${moderatorUid || '-'}</b></p>
    ${state.startFlowMessage ? `<p style="color:#ff7b7b;">${state.startFlowMessage}</p>` : ''}
    <div class="chips">${chips}</div>
    ${isMeModerator
      ? `<button class="btn" id="startRoundBtn" ${players.length < 3 ? 'disabled' : ''}>เริ่มรอบใหม่</button>`
      : '<p>รอ Host / Moderator เริ่มรอบ</p>'}
    <hr/>
    ${scoreRows}
  `;

  document.getElementById('startRoundBtn')?.addEventListener('click', () => {
    void startRound(players.map(([uid]) => uid));
  });

  el.secret.innerHTML = `
    <h3>Secret Card</h3>
    <p>เวลาที่เหลือ: <b>${phaseRemainSeconds(game.phaseEndsAtMs)}s</b></p>
    <div class="secret-word-display">${myWord || 'กำลังแจกคำลับ...'}</div>
    ${isMeModerator ? '<button class="btn secondary" id="toDiscussionBtn">เริ่มช่วงพูดทันที</button>' : '<p>รอ Moderator พาเข้าช่วงพูด</p>'}
  `;

  document.getElementById('toDiscussionBtn')?.addEventListener('click', () => {
    const ids = game?.playerIds || players.map(([uid]) => uid);
    void toDiscussion(ids);
  });

  const order = Array.isArray(game?.discussion?.order) ? game.discussion.order : [];
  const activeIndex = Number(game?.discussion?.activeIndex || 0);
  const activeUid = String(order[activeIndex] || '');
  const activeName = String(duelPlayersByUid[activeUid]?.name || '-');
  const turnRemain = phaseRemainSeconds(game?.discussion?.turnEndsAtMs);
  const canAdvanceDiscussion = isMeModerator || (Boolean(state.uid) && state.uid === activeUid);

  el.discussion.innerHTML = `
    <h3>Discussion</h3>
    <p>คนที่กำลังพูด: <b>${displayPlayerName(activeUid, activeName)}</b> • เหลือ <b>${turnRemain}s</b></p>
    <div class="chips">${order.map((uid) => `<span class="chip">${displayPlayerName(uid, duelPlayersByUid[uid]?.name || uid)}${uid === activeUid ? ' 🎤' : ''}</span>`).join('')}</div>
    ${canAdvanceDiscussion ? '<button class="btn" id="nextTurnBtn">ข้ามไปคนถัดไป</button>' : '<p>รอผู้พูดปัจจุบันหรือ Moderator กดข้ามตา</p>'}
  `;

  document.getElementById('nextTurnBtn')?.addEventListener('click', () => {
    void nextTurn(activeUid);
  });

  const votedCount = Object.keys(game?.votes || {}).length;
  const canVote = phase === 'vote';
  const myVoteUid = String(game?.votes?.[state.uid] || '');
  const myVoteName = myVoteUid ? String(duelPlayersByUid?.[myVoteUid]?.name || myVoteUid) : '';
  const roundScoreByUid = game?.roundScore && typeof game.roundScore === 'object' ? game.roundScore : {};
  const totalScoreByUid = game?.scores && typeof game.scores === 'object' ? game.scores : {};
  const scoreBoardRows = players
    .map(([uid, player]) => {
      const roundPoints = Number(roundScoreByUid?.[uid] || 0);
      const totalPoints = Number(totalScoreByUid?.[uid] || 0);
      return `<div class="score-row"><span class="score-name">${displayPlayerName(uid, player?.name || uid)}</span><span class="score-cell">รอบนี้ <b>+${roundPoints}</b></span><span class="score-cell">รวม <b>${totalPoints}</b></span></div>`;
    })
    .join('');
  const voteTargets = players
    .filter(([uid]) => uid !== state.uid)
    .map(([uid, player]) => `<button class="btn vote-target-btn ${myVoteUid === uid ? 'secondary' : ''}" data-vote-target="${uid}">${displayPlayerName(uid, player?.name || uid)}${myVoteUid === uid ? ' ✅' : ''}</button>`)
    .join('');

  el.vote.innerHTML = `
    <h3>Voting</h3>
    <p>เวลาที่เหลือ: <b>${phaseRemainSeconds(game.phaseEndsAtMs)}s</b></p>
    <button class="btn vote-open-btn" id="openVoteModalBtn" ${canVote ? '' : 'disabled'}>${myVoteUid ? `แก้ไขโหวต: ${displayPlayerName(myVoteUid, myVoteName)}` : 'เปิดหน้าต่างโหวต'}</button>
    <p>โหวตแล้ว: ${votedCount}/${players.length}</p>
    <p class="muted">${myVoteUid ? `คุณโหวตให้ ${displayPlayerName(myVoteUid, myVoteName)} แล้ว (กดปุ่มเพื่อเปลี่ยนได้)` : 'คุณยังไม่ได้โหวต'}</p>
    <h4>ตารางคะแนน</h4>
    <div class="scoreboard">
      <div class="score-head"><span>ผู้เล่น</span><span>คะแนนรอบนี้</span><span>คะแนนรวม</span></div>
      ${scoreBoardRows || '<p class="muted">ยังไม่มีข้อมูลคะแนน</p>'}
    </div>
    <div class="modal-backdrop ${state.voteModalOpen && canVote ? '' : 'hidden'}" id="voteModal">
      <div class="modal-card">
        <h4>เลือกคนที่คิดว่า “ต่างจากเพื่อน”</h4>
        <p class="muted">กดเลือก 1 คน แล้วหน้าต่างจะปิดอัตโนมัติ</p>
        <div class="vote-grid">${voteTargets || '<p class="muted">ไม่มีเป้าหมายให้โหวต</p>'}</div>
        <button class="btn secondary" id="closeVoteModalBtn">ปิดหน้าต่าง</button>
      </div>
    </div>
  `;

  document.getElementById('openVoteModalBtn')?.addEventListener('click', () => {
    state.voteModalOpen = true;
    ui();
  });
  document.getElementById('closeVoteModalBtn')?.addEventListener('click', () => {
    state.voteModalOpen = false;
    ui();
  });
  document.querySelectorAll('[data-vote-target]').forEach((targetButton) => {
    targetButton.addEventListener('click', () => {
      const targetUid = String(targetButton?.dataset?.voteTarget || '');
      if (!targetUid) return;
      state.voteModalOpen = false;
      void vote(targetUid);
    });
  });

  const wordsByUid = game?.secretWordsByUid || {};
  const reason = String(game?.reason || '-');
  el.result.innerHTML = `
    <h3>Result</h3>
    <p>${reason}</p>
    <p>กลับ Lobby อัตโนมัติใน <b>${phaseRemainSeconds(game.phaseEndsAtMs)}s</b></p>
    ${players
      .map(([uid, player]) => `<div class="vote-item"><b>${displayPlayerName(uid, player?.name || uid)}</b><span>${wordsByUid[uid] || '-'}</span><span>(+${Number(game?.roundScore?.[uid] || 0)} แต้ม)</span></div>`)
      .join('')}
    <hr/>
    <h4>สรุปคะแนนรอบนี้และคะแนนรวม</h4>
    <div class="scoreboard">
      <div class="score-head"><span>ผู้เล่น</span><span>คะแนนรอบนี้</span><span>คะแนนรวม</span></div>
      ${scoreBoardRows || '<p class="muted">ยังไม่มีข้อมูลคะแนน</p>'}
    </div>
    <hr/>
    ${scoreRows}
    ${isMeModerator ? '<button class="btn" id="nextRoundBtn">เล่นรอบใหม่ทันที</button>' : ''}
  `;

  document.getElementById('nextRoundBtn')?.addEventListener('click', () => {
    void resetToLobby();
  });
}

async function initGameRoomIfMissing() {
  await runTransaction(gamePublicRef, (data) => {
    if (data) return data;
    return {
      hostUid: String(getModeratorUid() || state.uid || ''),
      status: 'lobby',
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      scores: {},
      votes: {},
      round: 0,
    };
  });
}

async function startRound(playerIds) {
  setStartFlowMessage('');
  const currentUid = String(state.uid || '');
  const roomHostUid = String(state.duel?.hostUid || '');
  const moderatorUid = getModeratorUid();
  const ids = (Array.isArray(playerIds) ? playerIds : []).map((id) => String(id || '')).filter(Boolean).slice(0, 5);
  const playersInRoom = getPlayers().map(([uid]) => uid);
  console.info('[logic-spy][start-round] begin', {
    currentUid,
    roomHostUid,
    moderatorUid,
    roomId,
    duelRoomPath,
    gameRoomPath,
    playersInRoom,
    playerIdsForStart: ids,
  });

  if (!roomId) {
    failStartRound('roomId missing');
    ui();
    return;
  }

  if (!currentUid) {
    failStartRound('current uid missing');
    ui();
    return;
  }

  if (!canModerate()) {
    failStartRound('not moderator', { expectedModeratorUid: moderatorUid, expectedHostUid: roomHostUid });
    ui();
    return;
  }

  console.info('[logic-spy][start-round] player-count-check', {
    roomPlayersCount: playersInRoom.length,
    startIdsCount: ids.length,
    roomPlayers: playersInRoom,
    startIds: ids,
  });
  if (ids.length < 3) {
    failStartRound('players not enough', { minPlayers: 3, actualPlayers: ids.length });
    ui();
    return;
  }

  const setWords = pickWordSet(state.sets);
  const assignment = buildRoundAssignments(ids, setWords);
  const nowMs = Date.now();

  const updates = {
    hostUid: currentUid,
    status: 'secret',
    playerIds: ids,
    oddUid: assignment.oddUid,
    words: assignment.words,
    reason: assignment.reason,
    votes: {},
    roundScore: {},
    secretWordsByUid: assignment.secretWordsByUid,
    phaseEndsAtMs: nowMs + (SECRET_SECONDS * 1000),
    updatedAtMs: nowMs,
    round: Number(state.game?.round || 0) + 1,
  };

  try {
    console.info('[logic-spy][start-round] writing game state', { writePath: gamePublicPath, status: updates.status });
    await update(gamePublicRef, updates);
    console.info('[logic-spy][start-round] writing private cards', {
      writePaths: ids.map((uid) => `${gameRoomPath}/private/${uid}`),
    });
    await Promise.all(ids.map((uid) => set(ref(db, `${gameRoomPath}/private/${uid}`), {
      word: assignment.secretWordsByUid[uid],
      round: updates.round,
      updatedAtMs: nowMs,
    })));
    setStartFlowMessage('');
  } catch (error) {
    console.error('[logic-spy][start-round] firebase write failed', {
      error,
      roomId,
      gameRoomPath,
      playerIdsForStart: ids,
    });
    setStartFlowMessage(`เริ่มรอบไม่ได้: firebase write failed (${error?.message || 'unknown error'})`);
    ui();
  }
}

async function toDiscussion(playerIds) {
  if (!canModerate()) return;
  const ids = (Array.isArray(playerIds) ? playerIds : []).map((id) => String(id || '')).filter(Boolean).slice(0, 5);
  if (!ids.length) return;
  const nowMs = Date.now();
  await update(gamePublicRef, {
    status: 'discussion',
    discussion: {
      order: ids,
      activeIndex: 0,
      turnEndsAtMs: nowMs + (TURN_SECONDS * 1000),
    },
    phaseEndsAtMs: null,
    updatedAtMs: nowMs,
  });
}

async function nextTurn(activeUid) {
  const uid = String(state.uid || '');
  if (!uid) return;
  if (!canModerate() && uid !== String(activeUid || '')) return;

  await runTransaction(gamePublicRef, (game) => {
    const order = Array.isArray(game?.discussion?.order) ? game.discussion.order : [];
    const currentActiveUid = String(order[Number(game?.discussion?.activeIndex || 0)] || '');
    if (!canModerate() && uid !== currentActiveUid) return game;
    
    if (!game || String(game.status || '') !== 'discussion') return game;
    const nowMs = Date.now();
    const nextIndex = Number(game?.discussion?.activeIndex || 0) + 1;

    if (nextIndex >= order.length) {
      return {
        ...game,
        status: 'vote',
        votes: game?.votes && typeof game.votes === 'object' ? game.votes : {},
        phaseEndsAtMs: nowMs + (VOTE_SECONDS * 1000),
        updatedAtMs: nowMs,
      };
    }

    return {
      ...game,
      discussion: {
        ...game.discussion,
        activeIndex: nextIndex,
        turnEndsAtMs: nowMs + (TURN_SECONDS * 1000),
      },
      updatedAtMs: nowMs,
    };
  });
}

async function finalizeVoteIfReady(force = false) {
  await runTransaction(gamePublicRef, (game) => {
    if (!game || String(game.status || '') !== 'vote') return game;
    const nowMs = Date.now();
    const ids = Array.isArray(game?.playerIds) ? game.playerIds : getPlayers().map(([uid]) => uid);
    const votes = game?.votes && typeof game.votes === 'object' ? game.votes : {};
    const voteCount = Object.keys(votes).length;
    const voteClosed = force || voteCount >= ids.length || nowMs >= Number(game.phaseEndsAtMs || 0);
    if (!voteClosed) return game;

    const roundScore = calculateRoundScore({
      oddUid: String(game.oddUid || ''),
      votesByUid: votes,
      playerIds: ids,
    });

    const scores = { ...(game?.scores || {}) };
    ids.forEach((uid) => {
      scores[uid] = Number(scores[uid] || 0) + Number(roundScore[uid] || 0);
    });

    return {
      ...game,
      status: 'result',
      roundScore,
      scores,
      phaseEndsAtMs: nowMs + (RESULT_SECONDS * 1000),
      updatedAtMs: nowMs,
    };
  });
}

async function vote(targetUid) {
  const uid = String(state.uid || '');
  if (!uid || !targetUid) return;

  await runTransaction(gamePublicRef, (game) => {
    if (!game || String(game.status || '') !== 'vote') return game;
    const votes = { ...(game?.votes || {}), [uid]: String(targetUid || '') };
    return {
      ...game,
      votes,
      updatedAtMs: Date.now(),
    };
  });

  await finalizeVoteIfReady(false);
}

async function resetToLobby() {
  if (!canModerate()) return;
  await update(gamePublicRef, {
    hostUid: String(state.uid || ''),
    status: 'lobby',
    votes: {},
    roundScore: {},
    playerIds: null,
    oddUid: null,
    secretWordsByUid: null,
    discussion: null,
    phaseEndsAtMs: null,
    updatedAtMs: Date.now(),
  });
}

async function runPhaseMaintenance() {
  if (!canModerate() || state.maintenanceBusy || !state.game) return;
  state.maintenanceBusy = true;
  try {
    const game = state.game;
    const phase = String(game.status || 'lobby');
    const nowMs = Date.now();

    if (phase === 'secret' && nowMs >= Number(game.phaseEndsAtMs || 0)) {
      await toDiscussion(game.playerIds || getPlayers().map(([uid]) => uid));
    } else if (phase === 'discussion') {
      const turnEndsAtMs = Number(game?.discussion?.turnEndsAtMs || 0);
      if (turnEndsAtMs > 0 && nowMs >= turnEndsAtMs) {
        const order = Array.isArray(game?.discussion?.order) ? game.discussion.order : [];
        const activeUid = String(order[Number(game?.discussion?.activeIndex || 0)] || '');
        await nextTurn(activeUid);
      }
    } else if (phase === 'vote' && nowMs >= Number(game.phaseEndsAtMs || 0)) {
      await finalizeVoteIfReady(true);
    } else if (phase === 'result' && nowMs >= Number(game.phaseEndsAtMs || 0)) {
      await resetToLobby();
    }
  } finally {
    state.maintenanceBusy = false;
  }
}

async function init() {
  if (!roomId) {
    el.status.textContent = 'ไม่พบ roomId';
    console.error('[logic-spy][init] roomId missing', { roomId, duelRoomPath, gameRoomPath });
    return;
  }

  await ensureAuth();
  await loadWordSets();

  console.info('[logic-spy][init] subscribe paths', {
    roomId,
    duelRoomPath,
    gamePublicPath,
    privatePath: `${gameRoomPath}/private/${state.uid}`,
  });

  onValue(duelRef, (snap) => {
    state.duel = snap.val() || null;
    ui();
  });

  await initGameRoomIfMissing();

  onValue(gamePublicRef, (snap) => {
    state.game = snap.val() || null;
    ui();
  });

  onValue(ref(db, `${gameRoomPath}/private/${state.uid}`), (snap) => {
    state.privateMe = snap.val() || null;
    ui();
  });

  window.setInterval(() => {
    ui();
    void runPhaseMaintenance();
  }, 500);
}

void init();
