import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[mega-comp] Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
}

const _client = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null

function db() {
  if (!_client) throw new Error('Supabase not configured — check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')
  return _client
}

export const POINTS      = { 1: 3, 2: 2, 3: 1, 0: 0 }
export const PLACE_LABEL = { 1: '1st', 2: '2nd', 3: '3rd', 0: 'Loser' }
export const PLACE_EMOJI = { 1: '🥇', 2: '🥈', 3: '🥉', 0: '💀' }

const VERIFIED_KEY = 'mc_verified'

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapRoom(r) {
  return { ...r, createdAt: r.created_at }
}

function mapRoomPlayer(p) {
  return { ...p, roomId: p.room_id, createdAt: p.created_at }
}

function mapRoomGame(rg) {
  return { ...rg, roomId: rg.room_id, pointsMode: rg.points_mode, customPoints: rg.custom_points, createdAt: rg.created_at }
}

function mapGame(g) {
  return { ...g, gameType: g.game_type, date: g.date ?? g.played_on, roomId: g.room_id, roomGameId: g.room_game_id, placements: g.placements ?? [] }
}

function mapAchievement(a) {
  return {
    ...a,
    roomId:      a.room_id,
    pointValue:  a.point_value,
    awardedOnce: a.awarded_once,
    earnedByIds: (a.achievement_awards ?? []).map(x => x.player_id),
    createdAt:   a.created_at,
  }
}

// ── Room players ──────────────────────────────────────────────────────────────

export async function getRoomPlayers(roomId) {
  const { data } = await db().from('room_players').select('*').eq('room_id', roomId).order('created_at')
  return (data ?? []).map(mapRoomPlayer)
}

export async function addRoomPlayer(roomId, name, color) {
  const { data } = await db().from('room_players').insert({ room_id: roomId, name, color }).select().single()
  return data ? mapRoomPlayer(data) : null
}

export async function removeRoomPlayer(id) {
  await db().from('room_players').delete().eq('id', id)
}

// ── Rooms ─────────────────────────────────────────────────────────────────────

export async function getRooms() {
  const { data } = await db().from('rooms').select('*').order('date', { ascending: false })
  return (data ?? []).map(mapRoom)
}

export async function getRoom(id) {
  const { data } = await db().from('rooms').select('*').eq('id', id).single()
  return data ? mapRoom(data) : null
}

export async function addRoom(name, date, description, status = 'upcoming') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const code  = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  const { data } = await db().from('rooms').insert({
    name, date, description, status, code,
  }).select().single()
  return data ? mapRoom(data) : null
}

export async function updateRoom(id, updates) {
  const mapped = {}
  if (updates.name        !== undefined) mapped.name        = updates.name
  if (updates.date        !== undefined) mapped.date        = updates.date
  if (updates.description !== undefined) mapped.description = updates.description
  if (updates.status      !== undefined) mapped.status      = updates.status
  await db().from('rooms').update(mapped).eq('id', id)
}

export async function deleteRoom(id) {
  await db().from('rooms').delete().eq('id', id)
}

// ── Room code verification ────────────────────────────────────────────────────

export async function verifyRoomCode(roomId, code) {
  const { data: ok, error } = await db().rpc('check_room_code', { p_room_id: roomId, p_code: code })
  if (error || !ok) return { error: 'Incorrect code' }
  const verified = JSON.parse(sessionStorage.getItem(VERIFIED_KEY) || '{}')
  verified[roomId] = true
  sessionStorage.setItem(VERIFIED_KEY, JSON.stringify(verified))
  return { ok: true }
}

export function isRoomVerified(roomId) {
  try {
    return !!JSON.parse(sessionStorage.getItem(VERIFIED_KEY) || '{}')[roomId]
  } catch { return false }
}

export function markRoomVerified(roomId) {
  const verified = JSON.parse(sessionStorage.getItem(VERIFIED_KEY) || '{}')
  verified[roomId] = true
  sessionStorage.setItem(VERIFIED_KEY, JSON.stringify(verified))
}

// ── Room games ────────────────────────────────────────────────────────────────

export async function getRoomGames(roomId) {
  const { data } = await db().from('room_games')
    .select('*').eq('room_id', roomId).order('order', { ascending: true })
  return (data ?? []).map(mapRoomGame)
}

export async function addRoomGame(roomId, { name, description, pointsMode, customPoints, order }) {
  const { data } = await db().from('room_games').insert({
    room_id: roomId, name, description,
    points_mode: pointsMode,
    custom_points: pointsMode === 'custom' ? customPoints : null,
    order,
  }).select().single()
  return data ? mapRoomGame(data) : null
}

export async function updateRoomGame(id, updates) {
  const mapped = {}
  if (updates.name        !== undefined) mapped.name        = updates.name
  if (updates.description !== undefined) mapped.description = updates.description
  if (updates.pointsMode  !== undefined) {
    mapped.points_mode   = updates.pointsMode
    mapped.custom_points = updates.pointsMode === 'custom' ? (updates.customPoints ?? null) : null
  }
  await db().from('room_games').update(mapped).eq('id', id)
}

export async function deleteRoomGame(id) {
  await db().from('room_games').delete().eq('id', id)
}

// ── Games ─────────────────────────────────────────────────────────────────────

export async function getGames() {
  const { data } = await db().from('game_history').select('*')
  return (data ?? []).map(mapGame)
}

export async function addGame(gameType, placements, date, roomId = null, roomGameId = null) {
  const { data: game } = await db().from('games').insert({
    game_type:    gameType,
    played_on:    date || new Date().toISOString().split('T')[0],
    room_id:      roomId ?? null,
    room_game_id: roomGameId ?? null,
  }).select().single()

  if (!game) return null

  await db().from('game_placements').insert(
    placements.map(p => ({ game_id: game.id, player_id: p.playerId, place: p.place }))
  )

  return { ...game, roomId, roomGameId, placements }
}

export async function deleteGame(id) {
  await db().from('games').delete().eq('id', id)
}

// ── Achievements ──────────────────────────────────────────────────────────────

export async function getAchievements(roomId) {
  const { data } = await db().from('achievements')
    .select('*, achievement_awards(player_id)')
    .eq('room_id', roomId)
  return (data ?? []).map(mapAchievement)
}

export async function addAchievement(roomId, { name, description, icon, pointValue, awardedOnce }) {
  const { data } = await db().from('achievements').insert({
    room_id: roomId, name, description,
    icon:         icon || '⭐',
    point_value:  Number(pointValue) || 1,
    awarded_once: !!awardedOnce,
  }).select('*, achievement_awards(player_id)').single()
  return data ? mapAchievement(data) : null
}

export async function updateAchievement(id, updates) {
  await db().from('achievements').update({
    name:        updates.name,
    description: updates.description,
    icon:        updates.icon,
    point_value: Number(updates.pointValue),
    awarded_once: updates.awardedOnce,
  }).eq('id', id)
}

export async function deleteAchievement(id) {
  await db().from('achievements').delete().eq('id', id)
}

export async function awardAchievement(achievementId, playerId) {
  const { data: ach } = await db().from('achievements')
    .select('awarded_once, achievement_awards(player_id)')
    .eq('id', achievementId).single()
  if (!ach) return { error: 'Achievement not found' }
  if (ach.awarded_once && ach.achievement_awards.length > 0) return { error: 'Already awarded' }
  if (ach.achievement_awards.some(x => x.player_id === playerId)) return { error: 'Player already has this' }
  const { error } = await db().from('achievement_awards')
    .insert({ achievement_id: achievementId, player_id: playerId })
  if (error) return { error: error.message }
  return { ok: true }
}

export async function revokeAchievement(achievementId, playerId) {
  await db().from('achievement_awards')
    .delete().eq('achievement_id', achievementId).eq('player_id', playerId)
}

// ── Room stats ────────────────────────────────────────────────────────────────

export async function getRoomStats(roomId) {
  const [{ data: statsData }, { data: achData }, { data: gamesData }] = await Promise.all([
    db().from('room_player_stats').select('*').eq('room_id', roomId),
    db().from('achievements').select('*, achievement_awards(player_id)').eq('room_id', roomId),
    db().from('game_history').select('*').eq('room_id', roomId),
  ])

  const achs  = (achData ?? []).map(mapAchievement)
  const games = (gamesData ?? []).map(mapGame)

  return (statsData ?? []).map(p => {
    const playerGames = games
      .filter(g => g.placements.some(pl => pl.playerId === p.player_id))
      .sort((a, b) => new Date(b.date) - new Date(a.date))

    let streak = 0
    for (const g of playerGames) {
      if (g.placements.find(pl => pl.playerId === p.player_id)?.place === 1) streak++
      else break
    }

    const typeCounts = {}
    playerGames.forEach(g => { typeCounts[g.gameType] = (typeCounts[g.gameType] || 0) + 1 })
    const favGame = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'

    const earnedAchs = achs.filter(a => a.earnedByIds.includes(p.player_id))

    return {
      id:                p.player_id,
      name:              p.name,
      color:             p.color,
      competitionPoints: p.competition_points,
      achievementPoints: p.achievement_points,
      totalPoints:       p.total_points,
      points:            p.total_points,
      wins:              p.wins,
      podiums:           p.podium_finishes,
      played:            p.games_played,
      winRate:           p.win_rate  ?? 0,
      podiumRate:        p.podium_rate ?? 0,
      streak,
      favGame,
      earnedAchs,
    }
  }).sort((a, b) => b.totalPoints - a.totalPoints || b.competitionPoints - a.competitionPoints)
}
