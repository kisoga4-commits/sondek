export function getEffectiveFinishDistance(modeConfig = {}) {
  const baseDistance = Number(modeConfig?.finishDistance || 10);
  const gameMode = String(modeConfig?.gameMode || 'quick');
  const matchType = String(modeConfig?.matchType || 'solo');
  const teamSize = Math.max(2, Math.min(3, Number(modeConfig?.teamSize || 2)));

  if (gameMode === 'worm' && matchType === 'party') {
    return baseDistance * teamSize;
  }

  return baseDistance;
}

export function getWormWrongPenalty(wrongStreak = 0) {
  const streak = Math.max(0, Number(wrongStreak || 0));
  if (streak >= 3) {
    return {
      stunMs: 5000,
      distancePenalty: 1,
      message: 'ผิดสะสม: STUN 5 วินาที + ถอย -1',
    };
  }
  if (streak === 2) {
    return {
      stunMs: 3000,
      distancePenalty: 0,
      message: 'ผิดสะสม: STUN 3 วินาที',
    };
  }
  if (streak === 1) {
    return {
      stunMs: 2000,
      distancePenalty: 0,
      message: 'ผิดสะสม: STUN 2 วินาที',
    };
  }
  return {
    stunMs: 0,
    distancePenalty: 0,
    message: 'ตอบผิด',
  };
}

export function pickWormComboTargetUid(players = {}, actorUid = '', actorTeamId = '', randomValue = Math.random()) {
  const actor = players?.[actorUid] || {};
  const normalizedActorTeamId = String(actorTeamId || actor?.teamId || '');
  const hasKnownTeams = Object.values(players || {}).some((player) => String(player?.teamId || ''));
  const candidates = Object.entries(players)
    .filter(([uid, player]) => {
      if (uid === actorUid) return false;

      // Party mode: actor has a teamId, so only target players outside actor team.
      // Solo mode: actor has no teamId, so everyone except self is a valid target.
      if (!normalizedActorTeamId) {
        // fallback: if team data exists but actorTeamId payload is missing, avoid same-team targets
        if (hasKnownTeams && String(player?.teamId || '') && String(player?.teamId || '') === String(actor?.teamId || '')) return false;
        return true;
      }

      return String(player?.teamId || '') !== normalizedActorTeamId;
    });
  if (!candidates.length) return '';

  const topDistance = Math.max(...candidates.map(([, player]) => Number(player?.distance || 0)));
  const topCandidates = candidates.filter(([, player]) => Number(player?.distance || 0) === topDistance);
  if (topCandidates.length === 1) return topCandidates[0][0];

  const normalizedRandom = Math.min(0.999999, Math.max(0, Number(randomValue) || 0));
  const pickedIndex = Math.floor(normalizedRandom * topCandidates.length);
  return String(topCandidates[pickedIndex]?.[0] || '');
}
