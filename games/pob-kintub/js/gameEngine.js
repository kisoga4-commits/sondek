function markDead(nextPublic, uid, reason, logs) {
  if (!uid || !nextPublic.players?.[uid] || !nextPublic.players[uid].alive) return;
  nextPublic.players[uid].alive = false;
  nextPublic.players[uid].deathCause = reason || 'unknown';
  logs.push(`${nextPublic.players[uid].name} ตาย (${reason})`);
}
function isSuspiciousRole(role) {
  return role === 'pob' || role === 'madman' || role === 'villager';
}

const ROLE_LABELS = {
  pob: 'ปอบ',
  shaman: 'หมอดู',
  madman: 'คนบ้า',
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
    if (String(priv?.[p.uid]?.role || '') === 'madman') return;
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
  const isMadmanWin = outUid && String(priv?.[outUid]?.role || '') === 'madman';
  const end = isMadmanWin ? 'madman' : checkWinner(pub, priv);

  return {
    players: pub.players,
    voteSummary: summary,
    eliminatedUid: outUid,
    requiredVotes,
    madmanWinUid: isMadmanWin ? outUid : '',
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
  const madmanUid = uidByRole('madman')[0] || null;
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
  const madmanAction = getNightActionForDay(priv, madmanUid, day);
  const madmanAlreadyUsed = Boolean(priv?.[madmanUid || '']?.madmanUsed);
  const madmanTarget = !madmanUid || madmanAlreadyUsed || isBlockedByPolice(priv, jailedTonight, madmanUid, day)
    ? null
    : String(madmanAction?.targetId || '').trim();
  const madmanOrder = Number(madmanAction?.order || 0);
  const madmanUsedByUid = {};
  if (madmanUid) {
    if (madmanAlreadyUsed) {
      roleResults[madmanUid]?.push('คุณใช้สิทธิ์ปั่นกระแสไปแล้ว 1 ครั้งต่อเกม');
    } else if (isBlockedByPolice(priv, jailedTonight, madmanUid, day)) {
      roleResults[madmanUid]?.push('คุณโดนขัง');
    } else if (madmanTarget && jailedTonight[madmanTarget]) {
      roleResults[madmanUid]?.push(`เป้าหมาย ${pub.players?.[madmanTarget]?.name || 'ผู้เล่น'} โดนขังอยู่แล้ว จึงปิดกั้นไม่สำเร็จ`);
      madmanUsedByUid[madmanUid] = true;
    } else if (madmanTarget) {
      roleResults[madmanUid]?.push(`คุณปิดกั้น ${pub.players?.[madmanTarget]?.name || 'ผู้เล่น'} แล้ว`);
      madmanUsedByUid[madmanUid] = true;
    }
  }
  const isBlockedByMadman = (uid) => {
    if (!uid || !madmanTarget || !madmanOrder || uid !== madmanTarget) return false;
    const targetAction = getNightActionForDay(priv, uid, day);
    const targetOrder = Number(targetAction?.order || 0);
    if (!targetOrder) return true;
    return madmanOrder < targetOrder;
  };

  const monkAction = getNightActionForDay(priv, monkUid, day);
  const monkBlocked = isBlockedByPolice(priv, jailedTonight, monkUid, day) || isBlockedByMadman(monkUid);
  const protectedUid = monkBlocked ? null : (monkAction?.targetId || null);
  if (monkUid) {
    if (isBlockedByPolice(priv, jailedTonight, monkUid, day)) {
      roleResults[monkUid]?.push('คุณถูกขังก่อน จึงคุ้มครองใครไม่ได้');
    } else if (isBlockedByMadman(monkUid)) {
      roleResults[monkUid]?.push('มีคนทำให้คุณใช้สกิลไม่สำเร็จในคืนนี้');
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
    } else if (isBlockedByMadman(pobUid)) {
      roleResults[pobUid]?.push('มีคนทำให้คุณใช้สกิลไม่สำเร็จในคืนนี้');
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
  const hunterBlocked = isBlockedByPolice(priv, jailedTonight, hunterUid, day) || isBlockedByMadman(hunterUid);
  const hunterTarget = hunterBlocked ? null : (hunterAction?.targetId || null);
  if (hunterUid && isBlockedByPolice(priv, jailedTonight, hunterUid, day)) {
    roleResults[hunterUid]?.push('คุณโดนขัง');
  } else if (hunterUid && isBlockedByMadman(hunterUid)) {
    roleResults[hunterUid]?.push('มีคนทำให้คุณใช้สกิลไม่สำเร็จในคืนนี้');
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
  const shamanTarget = (isBlockedByPolice(priv, jailedTonight, shamanUid, day) || isBlockedByMadman(shamanUid)) ? null : (shamanAction?.targetId || null);
  const shamanProgress = shamanUid ? (priv?.[shamanUid]?.shamanScan || null) : null;
  const shamanScanByUid = {};
  if (shamanUid && isBlockedByPolice(priv, jailedTonight, shamanUid, day)) {
    roleResults[shamanUid]?.push('คุณโดนขัง');
    shamanScanByUid[shamanUid] = null;
  } else if (shamanUid && isBlockedByMadman(shamanUid)) {
    roleResults[shamanUid]?.push('มีคนทำให้คุณใช้สกิลไม่สำเร็จในคืนนี้');
  } else if (shamanUid && shamanTarget && jailedTonight[shamanTarget]) {
    roleResults[shamanUid]?.push(`${pub.players?.[shamanTarget]?.name || 'ผู้เล่น'} โดนขัง จึงเชื่อมจิตไม่ได้`);
  } else if (shamanUid && shamanTarget) {
    const seenName = pub.players?.[shamanTarget]?.name || 'ผู้เล่น';
    const validPrevProgress = shamanProgress
      && pub.players?.[shamanProgress.targetId]?.alive
      ? shamanProgress
      : null;
    const isSecondScanSameTarget = Boolean(validPrevProgress && validPrevProgress.targetId === shamanTarget);
    if (isSecondScanSameTarget) {
      const seenRole = String(priv?.[shamanTarget]?.role || 'unknown');
      const verdict = isSuspiciousRole(seenRole) ? 'มีพิรุธ' : 'ชาวบ้าน';
      roleResults[shamanUid]?.push(`คุณตรวจ ${seenName} สำเร็จ: ${verdict} (ไม่ใช่อาชีพจริง)`);
      shamanScanByUid[shamanUid] = null;
    } else {
      roleResults[shamanUid]?.push(`คุณเริ่มเชื่อมจิตกับ ${seenName} แล้ว (ยังไม่เห็นผลตรวจ)`);
      roleResults[shamanTarget]?.push('มีคนกำลังเชื่อมจิตคุณ');
      shamanScanByUid[shamanUid] = {
        targetId: shamanTarget,
        stage: 1,
        startedDay: day,
      };
    }
  } else if (shamanUid && shamanProgress && !pub.players?.[shamanProgress.targetId]?.alive) {
    roleResults[shamanUid]?.push('เป้าหมายที่เชื่อมจิตไว้ตายแล้ว ต้องเริ่มใหม่');
    shamanScanByUid[shamanUid] = null;
  }

  alive.filter((p) => priv[p.uid]?.role === 'villager').forEach((villager) => {
    const acted = Boolean(getNightActionForDay(priv, villager.uid, day)?.acted);
    if (isBlockedByMadman(villager.uid)) {
      roleResults[villager.uid]?.push('มีคนทำให้คุณใช้สกิลไม่สำเร็จในคืนนี้');
    } else if (!acted) {
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
    shamanScanByUid,
    madmanUsedByUid,
  };
}
