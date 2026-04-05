function markDead(nextPublic, uid, reason, logs) {
  if (!uid || !nextPublic.players?.[uid] || !nextPublic.players[uid].alive) return;
  nextPublic.players[uid].alive = false;
  logs.push(`${nextPublic.players[uid].name} ตาย (${reason})`);
}

function isBlockedByPolice(privateState, jailedTonight, uid) {
  if (!uid) return false;
  const jailed = jailedTonight?.[uid] || null;
  if (!jailed) return false;
  const jailedOrder = Number(jailed?.order || 0);
  const actedAt = Number(privateState?.[uid]?.nightAction?.at || 0);
  const actedOrder = Number(privateState?.[uid]?.nightAction?.order || 0);
  if (!actedAt) return true;
  if (jailedOrder && actedOrder) return jailedOrder < actedOrder;
  const jailedAt = Number(jailed?.at || 0);
  return jailedAt < actedAt;
}

export function checkWinner(publicState, privateState) {
  const alive = Object.values(publicState?.players || {}).filter((p) => p.alive);
  const pobAlive = alive.filter((p) => privateState?.[p.uid]?.role === 'pob').length;
  const humanAlive = alive.length - pobAlive;
  if (pobAlive === 0) return 'villager';
  if (humanAlive === 0) return 'pob';
  return '';
}

export function resolveNight(publicState, privateState) {
  const pub = JSON.parse(JSON.stringify(publicState || {}));
  const priv = privateState || {};
  const alive = Object.values(pub.players || {}).filter((p) => p.alive);
  const uidByRole = (role) => alive.filter((p) => priv[p.uid]?.role === role).map((p) => p.uid);
  const pobUids = uidByRole('pob');
  const monkUid = uidByRole('monk')[0] || null;
  const hunterUid = uidByRole('hunter')[0] || null;
  const jailedTonight = pub?.jailedTonight || {};

  const logs = [];
  const jailedList = Object.keys(jailedTonight);
  if (jailedList.length) {
    logs.push(`คนที่โดนขัง: ${jailedList.map((uid) => pub.players?.[uid]?.name || 'ผู้เล่น').join(', ')}`);
  }

  const protectedUid = isBlockedByPolice(priv, jailedTonight, monkUid) ? null : (priv[monkUid]?.nightAction?.targetId || null);
  pobUids.forEach((pobUid) => {
    const pobTarget = priv[pobUid]?.nightAction?.targetId || null;
    if (!pobTarget) return;
    if (isBlockedByPolice(priv, jailedTonight, pobUid)) {
      logs.push(`${pub.players?.[pobUid]?.name || 'ปอบ'} ถูกขังก่อนใช้พลัง`);
    } else if (pobTarget === protectedUid) {
      logs.push(`${pub.players?.[pobTarget]?.name || 'ผู้เล่น'} ถูกคุ้มครองโดยหมอธรรม`);
    } else if (jailedTonight[pobTarget]) {
      logs.push(`${pub.players?.[pobTarget]?.name || 'ผู้เล่น'} ถูกขังอยู่ จึงไม่ตาย`);
    } else {
      markDead(pub, pobTarget, 'โดนจกตับ', logs);
    }
  });

  const hunterTarget = isBlockedByPolice(priv, jailedTonight, hunterUid) ? null : (priv[hunterUid]?.nightAction?.targetId || null);
  if (hunterTarget) {
    if (jailedTonight[hunterTarget]) logs.push(`${pub.players?.[hunterTarget]?.name || 'ผู้เล่น'} ถูกขังอยู่ จึงรอดจากกระสุน`);
    else markDead(pub, hunterTarget, 'โดนยิง', logs);
  }

  alive.filter((p) => priv[p.uid]?.role === 'villager').forEach((villager) => {
    const acted = Boolean(priv[villager.uid]?.nightAction?.acted);
    if (!acted) markDead(pub, villager.uid, 'อดตาย', logs);
  });

  return {
    players: pub.players,
    logs: logs.length ? logs : ['คืนนี้ไม่มีคนตาย'],
    jailedTonight: {},
    nightHistoryEntry: {
      day: Number(pub?.day || 1),
      policeTarget: Object.keys(jailedTonight).map((uid) => pub.players?.[uid]?.name || '').filter(Boolean).join(', '),
      monkTarget: protectedUid ? (pub.players?.[protectedUid]?.name || '') : '',
      pobTarget: pobUids.map((uid) => pub.players?.[priv[uid]?.nightAction?.targetId || '']?.name || '').filter(Boolean).join(', '),
      hunterTarget: hunterTarget ? (pub.players?.[hunterTarget]?.name || '') : '',
      logs: logs.length ? logs : ['คืนนี้ไม่มีคนตาย'],
    },
  };
}
