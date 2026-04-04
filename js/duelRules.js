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
