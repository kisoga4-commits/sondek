import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js';
import { getDatabase, onValue, ref, runTransaction, set, update } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js';
import { doc, getDoc, getFirestore } from 'https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js';
import { DEFAULT_LOGIC_SPY_WORD_SETS, buildRoundAssignments, calculateRoundScore, pickWordSet } from './gameEngine.js';

const config = { apiKey: 'AIzaSyC4jOmVcZp0HmmDqZCmHufnq2yyoPcvyVM', authDomain: 'pakdu-a26c4.firebaseapp.com', databaseURL: 'https://pakdu-a26c4-default-rtdb.asia-southeast1.firebasedatabase.app', projectId: 'pakdu-a26c4', storageBucket: 'pakdu-a26c4.firebasestorage.app', messagingSenderId: '414809008203', appId: '1:414809008203:web:757dceafa78d91900d85ce' };
const app = initializeApp(config);
const db = getDatabase(app);
const fs = getFirestore(app);
const auth = getAuth(app);
const params = new URLSearchParams(window.location.search);
const roomId = String(params.get('roomId') || '').trim();
const duelRef = ref(db, `rooms/${roomId}`);
const gameRef = ref(db, `logic_spy_rooms/${roomId}`);

const el = { status: document.getElementById('status'), lobby: document.getElementById('lobby'), secret: document.getElementById('secret'), discussion: document.getElementById('discussion'), vote: document.getElementById('vote'), result: document.getElementById('result') };
const state = { uid: '', duel: null, game: null, privateMe: null, sets: DEFAULT_LOGIC_SPY_WORD_SETS };

function isHost() {
  return String(state.duel?.hostUid || '') === state.uid;
}

async function ensureAuth() { await new Promise((resolve, reject) => { const unsub = onAuthStateChanged(auth, async (u) => { if (u) { state.uid = u.uid; unsub(); resolve(); return; } try { await signInAnonymously(auth); } catch (e) { reject(e); } }); }); }
async function loadWordSets() { try { const snap = await getDoc(doc(fs, 'settings', 'logic_spy_word_sets')); const sets = snap.exists() ? snap.data()?.sets : null; if (Array.isArray(sets) && sets.length) state.sets = sets; } catch (_) {} }

function ui() {
  const duelPlayers = state.duel?.players || {};
  const players = Object.entries(duelPlayers).slice(0, 5);
  const host = isHost();
  const g = state.game || { status: 'lobby', scores: {} };
  const phase = String(g.status || 'lobby');
  el.status.innerHTML = `<div>ห้อง: <b>${roomId}</b> • ผู้เล่น: ${players.length}/5 • สถานะ: ${phase}</div>`;
  el.lobby.classList.toggle('hidden', phase !== 'lobby');
  el.secret.classList.toggle('hidden', phase !== 'secret');
  el.discussion.classList.toggle('hidden', phase !== 'discussion');
  el.vote.classList.toggle('hidden', phase !== 'vote');
  el.result.classList.toggle('hidden', phase !== 'result');

  const chips = players.map(([uid, p]) => `<span class="chip">${p.name || 'ผู้เล่น'}${uid === g.oddUid ? ' 🕵️' : ''}</span>`).join('');
  const scoreRows = players.map(([uid, p]) => `<div class="vote-item"><b>${p.name || uid}</b><span>${Number(g.scores?.[uid] || 0)} แต้ม</span></div>`).join('');

  el.lobby.innerHTML = `<h3>Lobby</h3><p>ต้องมี 3-5 คน</p><div class="chips">${chips}</div>${host ? `<button class="btn" id="startRoundBtn" ${players.length < 3 ? 'disabled' : ''}>เริ่มสุ่มคำ</button>` : '<p>รอ Host เริ่มเกม</p>'}<hr/>${scoreRows}`;
  document.getElementById('startRoundBtn')?.addEventListener('click', () => void startRound(players.map(([uid]) => uid)));

  const myWord = String(state.privateMe?.word || '');
  el.secret.innerHTML = `<h3>Secret Card</h3><p>แตะเพื่อดูคำลับ — ตอนนี้ระบบแสดงคำให้ทันทีบนหน้าจอแล้ว</p><div class="secret-word-display">${myWord || 'กำลังสุ่มคำ...'}</div>${host ? '<button class="btn secondary" id="toTalkBtn">เริ่มช่วงพูด</button>' : '<p>รอ Host เริ่มช่วงพูด</p>'}`;
  document.getElementById('toTalkBtn')?.addEventListener('click', () => void toDiscussion(players.map(([uid]) => uid)));


  const order = Array.isArray(g?.discussion?.order) ? g.discussion.order : [];
  const activeUid = order[Number(g?.discussion?.activeIndex || 0)] || '';
  const remain = Math.max(0, Math.ceil((Number(g?.discussion?.turnEndsAtMs || 0) - Date.now()) / 1000));
  el.discussion.innerHTML = `<h3>Discussion</h3><p>คนที่ต้องพูด: <b>${duelPlayers[activeUid]?.name || '-'}</b> (${remain}s)</p><div class="chips">${order.map((uid) => `<span class="chip">${duelPlayers[uid]?.name || uid}${uid === activeUid ? ' 🎤' : ''}</span>`).join('')}</div><button class="btn" id="nextTurnBtn">เสร็จแล้ว</button>`;
  document.getElementById('nextTurnBtn')?.addEventListener('click', () => void nextTurn(activeUid));

  const canVote = phase === 'vote';
  el.vote.innerHTML = `<h3>Voting</h3>${players.filter(([uid]) => uid !== state.uid).map(([uid, p]) => `<label class="vote-item"><input type="radio" name="voteTarget" value="${uid}">${p.name || uid}</label>`).join('')}<button class="btn" id="voteBtn" ${canVote ? '' : 'disabled'}>ยืนยันการโหวต</button><p>โหวตแล้ว: ${Object.keys(g.votes || {}).length}/${players.length}</p>`;
  document.getElementById('voteBtn')?.addEventListener('click', () => { const target = document.querySelector('input[name="voteTarget"]:checked')?.value || ''; if (target) void vote(target); });

  const words = g.secretWordsByUid || {};
  el.result.innerHTML = `<h3>Result</h3><p>${g.reason || '-'}</p>${players.map(([uid, p]) => `<div class="vote-item"><b>${p.name || uid}</b><span>${words[uid] || '-'}</span><span>(${Number(g.roundScore?.[uid] || 0)} แต้มรอบนี้)</span></div>`).join('')}<hr/>${scoreRows}${host ? '<button class="btn" id="nextRoundBtn">เริ่มรอบใหม่</button>' : ''}`;
  document.getElementById('nextRoundBtn')?.addEventListener('click', () => void set(gameRef, { ...g, status: 'lobby' }));
}

async function initGameRoomIfMissing() {
  await runTransaction(gameRef, (data) => {
    if (data) return data;
    return { status: 'lobby', createdAtMs: Date.now(), scores: {} };
  });
}

async function startRound(playerIds) {
  if (!isHost()) return;
  const setWords = pickWordSet(state.sets);
  const assignment = buildRoundAssignments(playerIds, setWords);
  const updates = { status: 'secret', oddUid: assignment.oddUid, words: assignment.words, commonWord: assignment.commonWord, oddWord: assignment.oddWord, reason: assignment.reason, votes: {}, secretWordsByUid: assignment.secretWordsByUid, roundScore: {} };
  await update(gameRef, updates);
  await Promise.all(playerIds.map((uid) => set(ref(db, `logic_spy_rooms/${roomId}/private/${uid}`), { word: assignment.secretWordsByUid[uid] })));
}

async function toDiscussion(playerIds) {
  if (!isHost()) return;
  await update(gameRef, { status: 'discussion', discussion: { order: playerIds, activeIndex: 0, turnEndsAtMs: Date.now() + 15000 } });
}
async function nextTurn(activeUid) {
  const isActive = activeUid === state.uid;
  const host = isHost();
  if (!isActive && !host) return;
  await runTransaction(gameRef, (g) => {
    if (!g || g.status !== 'discussion') return g;
    const order = Array.isArray(g.discussion?.order) ? g.discussion.order : [];
    const nextIndex = Number(g.discussion?.activeIndex || 0) + 1;
    if (nextIndex >= order.length) return { ...g, status: 'vote', discussion: { ...g.discussion, activeIndex: nextIndex } };
    return { ...g, discussion: { ...g.discussion, activeIndex: nextIndex, turnEndsAtMs: Date.now() + 15000 } };
  });
}
async function vote(targetUid) {
  await update(ref(db, `logic_spy_rooms/${roomId}/votes`), { [state.uid]: targetUid });
  await runTransaction(gameRef, (g) => {
    if (!g || g.status !== 'vote') return g;
    const players = Object.keys(state.duel?.players || {}).slice(0, 5);
    const votes = { ...(g.votes || {}), [state.uid]: targetUid };
    if (Object.keys(votes).length < players.length) return { ...g, votes };
    const roundScore = calculateRoundScore({ oddUid: g.oddUid, votesByUid: votes, playerIds: players });
    const scores = { ...(g.scores || {}) };
    players.forEach((uid) => { scores[uid] = Number(scores[uid] || 0) + Number(roundScore[uid] || 0); });
    return { ...g, status: 'result', votes, roundScore, scores };
  });
}

async function init() {
  if (!roomId) { el.status.textContent = 'ไม่พบ roomId'; return; }
  await ensureAuth();
  await loadWordSets();
  onValue(duelRef, (snap) => { state.duel = snap.val() || null; ui(); });
  await initGameRoomIfMissing();
  onValue(gameRef, (snap) => { state.game = snap.val() || null; ui(); });
  onValue(ref(db, `logic_spy_rooms/${roomId}/private/${state.uid}`), (snap) => { state.privateMe = snap.val() || null; ui(); });
  setInterval(() => { if (String(state.game?.status || '') === 'discussion') ui(); }, 500);
}

void init();
