function markDead(nextPublic, uid, reason, logs) {
  if (!uid || !nextPublic.players?.[uid] || !nextPublic.players[uid].alive) return;
  nextPublic.players[uid].alive = false;
  nextPublic.players[uid].deathCause = reason || 'unknown';
  logs.push(`${nextPublic.players[uid].name} ตาย (${reason})`);
}
const ROLE_LABELS = {
  pob: 'ปอบ',
  shaman: 'หมอดู',
  monk: 'หมอธรรม',
  hunter: 'นายพราน',
  police: 'ตำรวจ',
  villager: 'ชาวนา',
  unknown: 'ไม่ทราบอาชีพ',
};

function isBlockedByPolice(privateState, jailedTonight, uid, day) {
  if (!uid) return false;
  const jailed = jailedTonight?.[uid] || null;
  if (!jailed) return false;
  const jailedOrder = Number(jailed?.order || 0);
  const action = getNightActionForDay(privateState, uid, day);
  const actedAt = Number(action?.at || 0);
  const actedOrder = Number(action?.order || 0);
  if (!actedAt) return true;
  if (jailedOrder && actedOrder) return jailedOrder < actedOrder;
  const jailedAt = Number(jailed?.at || 0);
  return jailedAt < actedAt;
}

function getNightActionForDay(privateStateByUid, uid, day) {
  const action = privateStateByUid?.[uid]?.nightAction || null;
  if (!action?.acted) return null;
  const actionDay = Number(action?.day || 0);
  if (!Number.isFinite(actionDay) || actionDay <= 0) return action;
  if (actionDay !== day) return null;
  return action;
}

function deriveJailedTonight(publicState, privateState, alivePlayers) {
  const day = Math.max(1, Number(publicState?.day || 1));
  const fromPublic = publicState?.jailedTonight;
  if (fromPublic && Object.keys(fromPublic).length) return fromPublic;

  const policeActions = alivePlayers
    .filter((p) => privateState?.[p.uid]?.role === 'police')
    .map((p) => ({ uid: p.uid, action: getNightActionForDay(privateState, p.uid, day) }))
    .filter(({ action }) => action?.acted && action?.targetId);

  if (!policeActions.length) return {};

  const earliest = policeActions.sort((a, b) => {
    const atDiff = Number(a.action?.at || 0) - Number(b.action?.at || 0);
    if (atDiff !== 0) return atDiff;
    return Number(a.action?.order || 0) - Number(b.action?.order || 0);
  })[0];

  const targetId = String(earliest?.action?.targetId || '');
  if (!targetId || !publicState?.players?.[targetId]?.alive) return {};
  return {
    [targetId]: {
      by: earliest.uid,
      at: Number(earliest?.action?.at || Date.now()),
      order: Number(earliest?.action?.order || 0),
    },
  };
}

export function checkWinner(publicState, privateState) {
  const alive = Object.values(publicState?.players || {}).filter((p) => p.alive);
  if (!alive.length) return '';
  const aliveRoles = alive.map((p) => privateState?.[p.uid]?.role || '');
  if (aliveRoles.some((role) => !role)) return '';
  const pobAlive = alive.filter((p) => privateState?.[p.uid]?.role === 'pob').length;
  const humanAlive = alive.length - pobAlive;
  if (pobAlive === 0) return 'villager';
  if (humanAlive === 0) return 'pob';
  return '';
}


export function resolveVote(publicState, privateState) {
  const pub = JSON.parse(JSON.stringify(publicState || {}));
  const priv = privateState || {};
  const alive = Object.values(pub.players || {}).filter((p) => p.alive);
  const aliveCount = alive.length;
  const requiredVotes = Math.floor(aliveCount / 2) + 1;
  const tally = {};

  alive.forEach((p) => {
    const target = String(priv[p.uid]?.voteTarget || '').trim();
    if (!target || !pub.players?.[target]?.alive || target === p.uid) return;
    tally[target] = (tally[target] || 0) + 1;
  });

  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  let outUid = null;
  if (sorted.length) {
    const top = sorted[0][1];
    const tieTop = sorted.filter(([, c]) => c === top).length > 1;
    if (!tieTop && top >= requiredVotes) outUid = sorted[0][0];
  }

  if (outUid) {
    pub.players[outUid].alive = false;
    pub.players[outUid].deathCause = 'vote_eliminated';
  }

  const summary = Object.fromEntries(sorted.map(([uid, score]) => [pub.players?.[uid]?.name || uid, score]));
  const end = checkWinner(pub, priv);

  return {
    players: pub.players,
    voteSummary: summary,
    eliminatedUid: outUid,
    requiredVotes,
    winner: end || '',
  };
}

export function resolveNight(publicState, privateState) {
  const pub = JSON.parse(JSON.stringify(publicState || {}));
  const priv = privateState || {};
  const day = Math.max(1, Number(pub?.day || 1));
  const alive = Object.values(pub.players || {}).filter((p) => p.alive);
  const uidByRole = (role) => alive.filter((p) => priv[p.uid]?.role === role).map((p) => p.uid);
  const pobUids = uidByRole('pob');
  const monkUid = uidByRole('monk')[0] || null;
  const hunterUid = uidByRole('hunter')[0] || null;
  const jailedTonight = deriveJailedTonight(pub, priv, alive);

  const logs = [];
  const roleResults = {};
  alive.forEach((p) => {
    roleResults[p.uid] = [];
  });
  const jailedList = Object.keys(jailedTonight);
  if (jailedList.length) {
    logs.push('คืนนี้มีผู้เล่นโดนขัง');
    jailedList.forEach((uid) => {
      if (roleResults[uid]) roleResults[uid].push('คุณโดนขัง');
    });
  }

  const monkAction = getNightActionForDay(priv, monkUid, day);
  const protectedUid = isBlockedByPolice(priv, jailedTonight, monkUid, day) ? null : (monkAction?.targetId || null);
  if (monkUid) {
    if (isBlockedByPolice(priv, jailedTonight, monkUid, day)) {
      roleResults[monkUid]?.push('คุณถูกขังก่อน จึงคุ้มครองใครไม่ได้');
    } else if (protectedUid) {
      roleResults[monkUid]?.push(`คุณคุ้มครอง ${pub.players?.[protectedUid]?.name || 'ผู้เล่น'} สำเร็จ`);
    }
  }
  pobUids.forEach((pobUid) => {
    const pobAction = getNightActionForDay(priv, pobUid, day);
    const pobTarget = pobAction?.targetId || null;
    if (!pobTarget) return;
    if (isBlockedByPolice(priv, jailedTonight, pobUid, day)) {
      roleResults[pobUid]?.push('คุณโดนขัง');
    } else if (pobTarget === protectedUid) {
      logs.push(`${pub.players?.[pobTarget]?.name || 'ผู้เล่น'} ถูกคุ้มครองโดยหมอธรรม`);
      roleResults[pobUid]?.push(`เป้าหมาย ${pub.players?.[pobTarget]?.name || 'ผู้เล่น'} ถูกคุ้มครอง`);
    } else if (jailedTonight[pobTarget]) {
      roleResults[pobUid]?.push(`เป้าหมาย ${pub.players?.[pobTarget]?.name || 'ผู้เล่น'} โดนขัง`);
    } else {
      markDead(pub, pobTarget, 'โดนจกตับ', logs);
      roleResults[pobUid]?.push(`คุณจกตับ ${pub.players?.[pobTarget]?.name || 'ผู้เล่น'} สำเร็จ`);
    }
  });

  const hunterAction = getNightActionForDay(priv, hunterUid, day);
  const hunterTarget = isBlockedByPolice(priv, jailedTonight, hunterUid, day) ? null : (hunterAction?.targetId || null);
  if (hunterUid && isBlockedByPolice(priv, jailedTonight, hunterUid, day)) {
    roleResults[hunterUid]?.push('คุณโดนขัง');
  }
  if (hunterTarget) {
    if (jailedTonight[hunterTarget]) {
      roleResults[hunterUid]?.push(`คุณยิง ${pub.players?.[hunterTarget]?.name || 'ผู้เล่น'} แต่เป้าหมายโดนขัง`);
    } else {
      markDead(pub, hunterTarget, 'โดนยิง', logs);
      roleResults[hunterUid]?.push(`คุณยิง ${pub.players?.[hunterTarget]?.name || 'ผู้เล่น'} สำเร็จ`);
    }
  }

  const shamanUid = uidByRole('shaman')[0] || null;
  const shamanAction = getNightActionForDay(priv, shamanUid, day);
  const shamanTarget = isBlockedByPolice(priv, jailedTonight, shamanUid, day) ? null : (shamanAction?.targetId || null);
  if (shamanUid && isBlockedByPolice(priv, jailedTonight, shamanUid, day)) {
    roleResults[shamanUid]?.push('คุณโดนขัง');
  } else if (shamanUid && shamanTarget && jailedTonight[shamanTarget]) {
    roleResults[shamanUid]?.push(`${pub.players?.[shamanTarget]?.name || 'ผู้เล่น'} โดนขัง จึงส่องบทบาทไม่ได้`);
  } else if (shamanUid && shamanTarget) {
    const seenRole = String(priv[shamanTarget]?.role || 'unknown');
    const seenName = pub.players?.[shamanTarget]?.name || 'ผู้เล่น';
    roleResults[shamanUid]?.push(`คุณส่อง ${seenName} พบว่าเป็น ${ROLE_LABELS[seenRole] || seenRole}`);
  }

  alive.filter((p) => priv[p.uid]?.role === 'villager').forEach((villager) => {
    const acted = Boolean(getNightActionForDay(priv, villager.uid, day)?.acted);
    if (!acted) {
      markDead(pub, villager.uid, 'อดตาย', logs);
      roleResults[villager.uid]?.push('คืนนี้คุณไม่ได้ไถนา จึงอดตาย');
    } else {
      roleResults[villager.uid]?.push('คืนนี้คุณไถนาสำเร็จ');
    }
  });

  return {
    players: pub.players,
    logs: logs.length ? logs : ['คืนนี้ไม่มีคนตาย'],
    jailedTonight: {},
    nightHistoryEntry: {
      day: Number(pub?.day || 1),
      policeTarget: Object.keys(jailedTonight).map((uid) => pub.players?.[uid]?.name || '').filter(Boolean).join(', '),
      monkTarget: protectedUid ? (pub.players?.[protectedUid]?.name || '') : '',
      pobTarget: pobUids.map((uid) => pub.players?.[getNightActionForDay(priv, uid, day)?.targetId || '']?.name || '').filter(Boolean).join(', '),
      hunterTarget: hunterTarget ? (pub.players?.[hunterTarget]?.name || '') : '',
      logs: logs.length ? logs : ['คืนนี้ไม่มีคนตาย'],
    },
    roleResults,
  };
}
