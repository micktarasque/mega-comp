// ─────────────────────────────────────────────────────────────────────────────
// FAKE BACKEND — replace with Supabase calls when ready.
// All functions return Promises to mirror the async Supabase API shape.
//
// Data model v3:
//   players:      { id, name, color }
//   games:        { id, date, gameType, placements, roomId?, roomGameId? }
//   rooms:        { id, name, date, description, status, invitedPlayerIds, createdAt }
//   roomGames:    { id, roomId, name, description, order, pointsMode, customPoints? }
//   achievements: { id, roomId, name, description, icon, pointValue, awardedOnce, earnedByIds }
//
//   placements: [{ playerId, place }]
//   place: 1=1st(3pts), 2=2nd(2pts), 3=3rd(1pt), 0=Loser(0pts)  [or custom]
// ─────────────────────────────────────────────────────────────────────────────

const PLAYERS_KEY      = 'mc_players'
const GAMES_KEY        = 'mc_games'
const ROOMS_KEY        = 'mc_rooms'
const ROOM_GAMES_KEY   = 'mc_room_games'
const ACHIEVEMENTS_KEY = 'mc_achievements'
const VERSION_KEY      = 'mc_version'
const CURRENT_VERSION  = 4
const VERIFIED_KEY     = 'mc_verified'           // sessionStorage — reset on browser close

// ── Exported constants ────────────────────────────────────────────────────────
export const POINTS      = { 1: 3, 2: 2, 3: 1, 0: 0 }
export const PLACE_LABEL = { 1: '1st', 2: '2nd', 3: '3rd', 0: 'Loser' }
export const PLACE_EMOJI = { 1: '🥇', 2: '🥈', 3: '🥉', 0: '💀' }

// ── Default data ──────────────────────────────────────────────────────────────
const DEFAULT_PLAYERS = [
  { id: '1', name: 'Alex',   color: '#7C6FFF' },
  { id: '2', name: 'Jordan', color: '#FF6B8A' },
  { id: '3', name: 'Sam',    color: '#43E97B' },
  { id: '4', name: 'Riley',  color: '#F7971E' },
]

const DEFAULT_ROOMS = [
  {
    id: 'room1',
    name: 'Game Night Vol.1',
    date: '2026-03-10',
    description: "Classic board game showdown at Riley's. Winner gets bragging rights AND picks next month's games.",
    status: 'completed',
    invitedPlayerIds: ['1', '2', '3', '4'],
    createdAt: '2026-03-09T20:00:00Z',
    code: 'ALPHA',
  },
  {
    id: 'room2',
    name: 'Spring Slam',
    date: '2026-04-12',
    description: 'Bigger stakes, bigger glory. 4 games, custom scoring, special achievements up for grabs. Prepare accordingly.',
    status: 'upcoming',
    invitedPlayerIds: ['1', '2', '3'],
    createdAt: '2026-03-15T12:00:00Z',
    code: 'BRAVO',
  },
]

const DEFAULT_ROOM_GAMES = [
  {
    id: 'rg1', roomId: 'room1', order: 1,
    name: 'Chess',
    description: 'Standard FIDE rules. Best of 1. No takebacks, no mercy.',
    pointsMode: 'standard', customPoints: null,
  },
  {
    id: 'rg2', roomId: 'room1', order: 2,
    name: 'Mario Kart',
    description: '150cc Rainbow Road only. 3 races cumulative. Blue shells encouraged.',
    pointsMode: 'custom', customPoints: { 1: 5, 2: 3, 3: 2, 0: 1 },
  },
  {
    id: 'rg3', roomId: 'room1', order: 3,
    name: 'Poker',
    description: "Texas Hold'em. 2 buy-ins max. Play ends at midnight sharp.",
    pointsMode: 'standard', customPoints: null,
  },
  {
    id: 'rg4', roomId: 'room1', order: 4,
    name: 'Catan',
    description: "Base game + Seafarers. Robber must be used on the current leader. No trading with the winner.",
    pointsMode: 'custom', customPoints: { 1: 4, 2: 3, 3: 2, 0: 0 },
  },
  {
    id: 'rg5', roomId: 'room2', order: 1,
    name: 'Poker',
    description: "Texas Hold'em. 3 buy-ins max. Chip leader after 90 min wins.",
    pointsMode: 'custom', customPoints: { 1: 6, 2: 4, 3: 2, 0: 0 },
  },
  {
    id: 'rg6', roomId: 'room2', order: 2,
    name: 'Smash Bros',
    description: 'Stock mode, 3 lives, no items. Final Destination only. Johns are not accepted.',
    pointsMode: 'standard', customPoints: null,
  },
  {
    id: 'rg7', roomId: 'room2', order: 3,
    name: 'Catan',
    description: 'Standard rules, speed variant — no trading at all.',
    pointsMode: 'custom', customPoints: { 1: 5, 2: 3, 3: 1, 0: 0 },
  },
]

const DEFAULT_ACHIEVEMENTS = [
  {
    id: 'ach1', roomId: 'room1',
    name: 'First Blood', icon: '🩸',
    description: 'First player to win any game of the night.',
    pointValue: 2, awardedOnce: true, earnedByIds: ['1'],
  },
  {
    id: 'ach2', roomId: 'room1',
    name: 'Hat Trick', icon: '🎩',
    description: 'Win 3 games in a single night.',
    pointValue: 5, awardedOnce: true, earnedByIds: ['1'],
  },
  {
    id: 'ach3', roomId: 'room1',
    name: 'Comeback King', icon: '⚡',
    description: 'Won a game immediately after losing one.',
    pointValue: 3, awardedOnce: false, earnedByIds: ['2'],
  },
  {
    id: 'ach4', roomId: 'room1',
    name: 'Trash Talk Champion', icon: '🗣️',
    description: 'Made everyone laugh with trash talk AND still won.',
    pointValue: 1, awardedOnce: true, earnedByIds: [],
  },
  {
    id: 'ach5', roomId: 'room2',
    name: 'Early Bird', icon: '🐦',
    description: 'First to arrive and help set up.',
    pointValue: 1, awardedOnce: true, earnedByIds: [],
  },
  {
    id: 'ach6', roomId: 'room2',
    name: 'Bracket Buster', icon: '💥',
    description: 'Beats the current overall leaderboard leader.',
    pointValue: 5, awardedOnce: false, earnedByIds: [],
  },
]

const DEFAULT_GAMES = [
  {
    id: '1', date: '2026-03-10', gameType: 'Chess', roomId: 'room1', roomGameId: 'rg1',
    placements: [{ playerId: '1', place: 1 }, { playerId: '2', place: 0 }],
  },
  {
    id: '2', date: '2026-03-10', gameType: 'Mario Kart', roomId: 'room1', roomGameId: 'rg2',
    placements: [{ playerId: '3', place: 1 }, { playerId: '1', place: 2 }, { playerId: '4', place: 3 }, { playerId: '2', place: 0 }],
  },
  {
    id: '3', date: '2026-03-10', gameType: 'Poker', roomId: 'room1', roomGameId: 'rg3',
    placements: [{ playerId: '2', place: 1 }, { playerId: '1', place: 2 }, { playerId: '3', place: 0 }],
  },
  {
    id: '4', date: '2026-03-10', gameType: 'Catan', roomId: 'room1', roomGameId: 'rg4',
    placements: [{ playerId: '4', place: 1 }, { playerId: '3', place: 2 }, { playerId: '2', place: 0 }],
  },
  {
    id: '5', date: '2026-03-14', gameType: 'Chess', roomId: null, roomGameId: null,
    placements: [{ playerId: '1', place: 1 }, { playerId: '4', place: 0 }],
  },
  {
    id: '6', date: '2026-03-14', gameType: 'Mario Kart', roomId: null, roomGameId: null,
    placements: [{ playerId: '2', place: 1 }, { playerId: '3', place: 2 }, { playerId: '4', place: 3 }, { playerId: '1', place: 0 }],
  },
  {
    id: '7', date: '2026-03-15', gameType: 'Poker', roomId: null, roomGameId: null,
    placements: [{ playerId: '3', place: 1 }, { playerId: '4', place: 2 }, { playerId: '2', place: 0 }],
  },
  {
    id: '8', date: '2026-03-15', gameType: 'Catan', roomId: null, roomGameId: null,
    placements: [{ playerId: '1', place: 1 }, { playerId: '2', place: 2 }, { playerId: '3', place: 0 }],
  },
]

// ── Storage helpers ───────────────────────────────────────────────────────────
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function save(key, data) { localStorage.setItem(key, JSON.stringify(data)) }

function getStore() {
  const stored = Number(localStorage.getItem(VERSION_KEY) || '0')
  if (stored < CURRENT_VERSION) {
    // Clear game + room data on version bump; preserve player list
    ;[GAMES_KEY, ROOMS_KEY, ROOM_GAMES_KEY, ACHIEVEMENTS_KEY].forEach(k => localStorage.removeItem(k))
    localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
  }
  return {
    players:      load(PLAYERS_KEY,      DEFAULT_PLAYERS),
    games:        load(GAMES_KEY,        DEFAULT_GAMES),
    rooms:        load(ROOMS_KEY,        DEFAULT_ROOMS),
    roomGames:    load(ROOM_GAMES_KEY,   DEFAULT_ROOM_GAMES),
    achievements: load(ACHIEVEMENTS_KEY, DEFAULT_ACHIEVEMENTS),
  }
}

// Resolve the effective points map for a game
function resolvePoints(game, roomGamesMap) {
  if (!game.roomGameId) return POINTS
  const rg = roomGamesMap[game.roomGameId]
  return (rg?.pointsMode === 'custom' && rg?.customPoints) ? rg.customPoints : POINTS
}

// ── Room codes ────────────────────────────────────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function verifyRoomCode(roomId, code) {
  const { rooms } = getStore()
  const room = rooms.find(r => r.id === roomId)
  if (!room) return { error: 'Room not found' }
  if (!room.code || room.code.toUpperCase() !== code.toUpperCase().trim()) return { error: 'Incorrect code' }
  const verified = JSON.parse(sessionStorage.getItem(VERIFIED_KEY) || '{}')
  verified[roomId] = true
  sessionStorage.setItem(VERIFIED_KEY, JSON.stringify(verified))
  return { ok: true }
}

export function isRoomVerified(roomId) {
  try {
    const verified = JSON.parse(sessionStorage.getItem(VERIFIED_KEY) || '{}')
    return !!verified[roomId]
  } catch { return false }
}

// ── Players ───────────────────────────────────────────────────────────────────
export async function getPlayers() { return getStore().players }

export async function addPlayer(name, color) {
  const { players } = getStore()
  const player = { id: Date.now().toString(), name, color }
  save(PLAYERS_KEY, [...players, player])
  return player
}

export async function removePlayer(id) {
  const { players, games } = getStore()
  save(PLAYERS_KEY, players.filter(p => p.id !== id))
  const cleaned = games
    .map(g => ({ ...g, placements: g.placements.filter(p => p.playerId !== id) }))
    .filter(g => g.placements.length >= 2 && g.placements.some(p => p.place === 1))
  save(GAMES_KEY, cleaned)
}

// ── Rooms ─────────────────────────────────────────────────────────────────────
export async function getRooms() {
  return getStore().rooms.sort((a, b) => new Date(b.date) - new Date(a.date))
}

export async function getRoom(id) {
  return getStore().rooms.find(r => r.id === id) ?? null
}

export async function addRoom(name, date, description, invitedPlayerIds, status = 'upcoming') {
  const { rooms } = getStore()
  const room = { id: `room_${Date.now()}`, name, date, description, status, invitedPlayerIds, createdAt: new Date().toISOString(), code: generateCode() }
  save(ROOMS_KEY, [...rooms, room])
  return room
}

export async function updateRoom(id, updates) {
  const { rooms } = getStore()
  save(ROOMS_KEY, rooms.map(r => r.id === id ? { ...r, ...updates } : r))
}

export async function deleteRoom(id) {
  const { rooms, games, roomGames, achievements } = getStore()
  save(ROOMS_KEY, rooms.filter(r => r.id !== id))
  save(ROOM_GAMES_KEY, roomGames.filter(rg => rg.roomId !== id))
  save(ACHIEVEMENTS_KEY, achievements.filter(a => a.roomId !== id))
  // Unlink games (don't delete, keep in history as free-play)
  save(GAMES_KEY, games.map(g => g.roomId === id ? { ...g, roomId: null, roomGameId: null } : g))
}

// ── Room Games (schedule) ─────────────────────────────────────────────────────
export async function getRoomGames(roomId) {
  return getStore().roomGames.filter(rg => rg.roomId === roomId).sort((a, b) => a.order - b.order)
}

export async function addRoomGame(roomId, { name, description, pointsMode, customPoints, order }) {
  const { roomGames } = getStore()
  const rg = { id: `rg_${Date.now()}`, roomId, name, description, pointsMode, customPoints: pointsMode === 'custom' ? customPoints : null, order }
  save(ROOM_GAMES_KEY, [...roomGames, rg])
  return rg
}

export async function updateRoomGame(id, updates) {
  const { roomGames } = getStore()
  save(ROOM_GAMES_KEY, roomGames.map(rg => rg.id === id ? { ...rg, ...updates } : rg))
}

export async function deleteRoomGame(id) {
  const { roomGames, games } = getStore()
  save(ROOM_GAMES_KEY, roomGames.filter(rg => rg.id !== id))
  save(GAMES_KEY, games.map(g => g.roomGameId === id ? { ...g, roomGameId: null } : g))
}

// ── Achievements ──────────────────────────────────────────────────────────────
export async function getAchievements(roomId) {
  return getStore().achievements.filter(a => a.roomId === roomId)
}

export async function addAchievement(roomId, { name, description, icon, pointValue, awardedOnce }) {
  const { achievements } = getStore()
  const ach = { id: `ach_${Date.now()}`, roomId, name, description, icon: icon || '⭐', pointValue: Number(pointValue) || 1, awardedOnce: !!awardedOnce, earnedByIds: [] }
  save(ACHIEVEMENTS_KEY, [...achievements, ach])
  return ach
}

export async function updateAchievement(id, updates) {
  const { achievements } = getStore()
  save(ACHIEVEMENTS_KEY, achievements.map(a => a.id === id ? { ...a, ...updates } : a))
}

export async function deleteAchievement(id) {
  const { achievements } = getStore()
  save(ACHIEVEMENTS_KEY, achievements.filter(a => a.id !== id))
}

export async function awardAchievement(achievementId, playerId) {
  const { achievements } = getStore()
  const ach = achievements.find(a => a.id === achievementId)
  if (!ach) return { error: 'Achievement not found' }
  if (ach.awardedOnce && ach.earnedByIds.length > 0) return { error: 'Already awarded' }
  if (ach.earnedByIds.includes(playerId)) return { error: 'Player already has this' }
  save(ACHIEVEMENTS_KEY, achievements.map(a => a.id === achievementId ? { ...a, earnedByIds: [...a.earnedByIds, playerId] } : a))
  return { ok: true }
}

export async function revokeAchievement(achievementId, playerId) {
  const { achievements } = getStore()
  save(ACHIEVEMENTS_KEY, achievements.map(a => a.id === achievementId ? { ...a, earnedByIds: a.earnedByIds.filter(id => id !== playerId) } : a))
}

// ── Games ─────────────────────────────────────────────────────────────────────
export async function getGames() {
  return getStore().games.sort((a, b) => new Date(b.date) - new Date(a.date))
}

export async function addGame(gameType, placements, date, roomId = null, roomGameId = null) {
  const { games } = getStore()
  const game = { id: Date.now().toString(), date: date || new Date().toISOString().split('T')[0], gameType, placements, roomId: roomId || null, roomGameId: roomGameId || null }
  save(GAMES_KEY, [...games, game])
  return game
}

export async function deleteGame(id) {
  const { games } = getStore()
  save(GAMES_KEY, games.filter(g => g.id !== id))
}

// ── Global stats ──────────────────────────────────────────────────────────────
export async function getStats() {
  const { players, games, roomGames, achievements } = getStore()
  const rgMap = Object.fromEntries(roomGames.map(rg => [rg.id, rg]))

  return players.map(player => {
    const record = []
    games.forEach(g => {
      const p = g.placements.find(p => p.playerId === player.id)
      if (!p) return
      const pts = resolvePoints(g, rgMap)
      record.push({ place: p.place, points: pts[p.place] ?? 0, date: g.date, gameType: g.gameType })
    })

    const wins    = record.filter(r => r.place === 1).length
    const podiums = record.filter(r => r.place > 0).length
    const competitionPoints = record.reduce((sum, r) => sum + r.points, 0)

    const earnedAchs = achievements.filter(a => a.earnedByIds.includes(player.id))
    const achievementPoints = earnedAchs.reduce((sum, a) => sum + a.pointValue, 0)
    const totalPoints = competitionPoints + achievementPoints

    const sorted = [...record].sort((a, b) => new Date(b.date) - new Date(a.date))
    let streak = 0
    for (const r of sorted) { if (r.place === 1) streak++; else break }

    const typeCounts = {}
    record.forEach(r => { typeCounts[r.gameType] = (typeCounts[r.gameType] || 0) + 1 })
    const favGame = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'

    return {
      ...player,
      wins, podiums, played: record.length,
      competitionPoints, achievementPoints, totalPoints,
      points: totalPoints,           // backward compat alias
      winRate:    record.length ? Math.round((wins    / record.length) * 100) : 0,
      podiumRate: record.length ? Math.round((podiums / record.length) * 100) : 0,
      streak, favGame,
    }
  }).sort((a, b) => b.totalPoints - a.totalPoints || b.wins - a.wins)
}

// ── Room-scoped stats ─────────────────────────────────────────────────────────
export async function getRoomStats(roomId) {
  const { players, games, rooms, roomGames, achievements } = getStore()
  const room = rooms.find(r => r.id === roomId)
  if (!room) return []

  const rgMap = Object.fromEntries(roomGames.filter(rg => rg.roomId === roomId).map(rg => [rg.id, rg]))
  const roomGamesList = games.filter(g => g.roomId === roomId).sort((a, b) => new Date(a.date) - new Date(b.date))
  const roomAchs = achievements.filter(a => a.roomId === roomId)
  const roomPlayers = players.filter(p => room.invitedPlayerIds.includes(p.id))

  return roomPlayers.map(player => {
    const record = []
    roomGamesList.forEach(g => {
      const p = g.placements.find(p => p.playerId === player.id)
      if (!p) return
      const pts = resolvePoints(g, rgMap)
      record.push({ place: p.place, points: pts[p.place] ?? 0, date: g.date, gameType: g.gameType })
    })

    const wins    = record.filter(r => r.place === 1).length
    const podiums = record.filter(r => r.place > 0).length
    const competitionPoints = record.reduce((sum, r) => sum + r.points, 0)

    const earnedAchs = roomAchs.filter(a => a.earnedByIds.includes(player.id))
    const achievementPoints = earnedAchs.reduce((sum, a) => sum + a.pointValue, 0)
    const totalPoints = competitionPoints + achievementPoints

    const sorted = [...record].sort((a, b) => new Date(b.date) - new Date(a.date))
    let streak = 0
    for (const r of sorted) { if (r.place === 1) streak++; else break }

    const typeCounts = {}
    record.forEach(r => { typeCounts[r.gameType] = (typeCounts[r.gameType] || 0) + 1 })
    const favGame = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'

    return {
      ...player,
      wins, podiums, played: record.length,
      competitionPoints, achievementPoints, totalPoints,
      points: totalPoints,
      winRate:    record.length ? Math.round((wins    / record.length) * 100) : 0,
      podiumRate: record.length ? Math.round((podiums / record.length) * 100) : 0,
      streak, favGame,
      earnedAchs,
    }
  }).sort((a, b) => b.totalPoints - a.totalPoints || b.competitionPoints - a.competitionPoints)
}
