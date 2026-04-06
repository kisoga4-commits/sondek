export function getRoomMaxPlayers(gameMode = 'quick') {
  return String(gameMode || 'quick') === 'pob' ? 12 : 8;
}

export function getStartPlayerCap({ gameMode = 'quick', matchType = 'solo', teamSize = 2 } = {}) {
  const mode = String(gameMode || 'quick');
  if (mode === 'pob') return 12;
  if (mode === 'logic_spy') return 5;
  if (String(matchType || 'solo') === 'party') return Math.max(2, Number(teamSize || 2)) * 2;
  return 4;
}
