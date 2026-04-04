export function getEffectiveFinishDistance(modeConfig = {}) {
  const baseDistance = Number(modeConfig?.finishDistance || 10);
  const gameMode = String(modeConfig?.gameMode || 'quick');
  const matchType = String(modeConfig?.matchType || 'solo');
  if (gameMode !== 'worm' || matchType !== 'party') return baseDistance;
  const teamSize = Math.max(2, Math.min(3, Number(modeConfig?.teamSize || 2)));
  return baseDistance * teamSize;
}
