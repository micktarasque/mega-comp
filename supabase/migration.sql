-- ─────────────────────────────────────────────────────────────────────────────
-- Mega Comp — Supabase migration v4
-- Paste once into the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Security model:
--   • All data is publicly readable (anon key) — friends can view the scoreboard.
--   • The rooms.code column is HIDDEN from all reads; verification goes through
--     the check_room_code() RPC function (SECURITY DEFINER) so codes never leave
--     the database.
--   • Writes are open to anon — room-code integrity is enforced at the app layer
--     (client calls check_room_code before mutating; same pattern as localStorage).
--   • When you add Supabase Auth, swap the open write policies for user-scoped
--     ones and move code verification into a proper JWT claim.
--
-- Schema:
--   players          global roster
--   rooms            competitions / game nights  (code column hidden from anon)
--   room_games       scheduled games with optional custom scoring
--   games            logged results (free-play or room-linked)
--   game_placements  one row per player per game; points auto-computed by trigger
--   achievements     text achievements scoped to a room
--   achievement_awards  who earned which achievement
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE players (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#7C6FFF',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rooms (
  id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT    NOT NULL,
  date               DATE    NOT NULL,
  description        TEXT,
  status             TEXT    NOT NULL DEFAULT 'upcoming'
                       CHECK (status IN ('upcoming', 'active', 'completed')),
  invited_player_ids UUID[]  NOT NULL DEFAULT '{}',
  -- 'code' is intentionally last; column-level SELECT is revoked from anon below.
  code               TEXT    NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Games scheduled for a room, each with its own optional custom point scale.
CREATE TABLE room_games (
  id            UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID     NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name          TEXT     NOT NULL,
  description   TEXT,
  "order"       SMALLINT NOT NULL DEFAULT 1,
  points_mode   TEXT     NOT NULL DEFAULT 'standard'
                  CHECK (points_mode IN ('standard', 'custom')),
  -- custom_points JSON shape: {"1": 5, "2": 3, "3": 2, "0": 1}
  custom_points JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Logged game results (free-play or linked to a room / room_game).
CREATE TABLE games (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type    TEXT NOT NULL,
  played_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  room_id      UUID REFERENCES rooms(id)      ON DELETE SET NULL,
  room_game_id UUID REFERENCES room_games(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per player per game.
-- place: 1 = 1st, 2 = 2nd, 3 = 3rd, 0 = Loser
CREATE TABLE game_placements (
  id        UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id   UUID     NOT NULL REFERENCES games(id)   ON DELETE CASCADE,
  player_id UUID     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  place     SMALLINT NOT NULL CHECK (place IN (0, 1, 2, 3)),
  points    SMALLINT NOT NULL DEFAULT 0,          -- auto-filled by trigger on insert
  UNIQUE (game_id, player_id),
  UNIQUE (game_id, place) WHERE place > 0         -- one 1st, one 2nd, one 3rd per game
);

-- Text-based achievements scoped to a room.
CREATE TABLE achievements (
  id           UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID     NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name         TEXT     NOT NULL,
  description  TEXT,
  icon         TEXT     NOT NULL DEFAULT '⭐',
  point_value  SMALLINT NOT NULL DEFAULT 1,
  awarded_once BOOLEAN  NOT NULL DEFAULT true,    -- exclusive: only one player can earn it
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Junction: which players have earned each achievement.
CREATE TABLE achievement_awards (
  achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  player_id      UUID NOT NULL REFERENCES players(id)      ON DELETE CASCADE,
  awarded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (achievement_id, player_id)
);

-- ── Trigger: auto-compute points on placement insert ──────────────────────────
-- Resolves custom vs standard scoring at write time from the linked room_game.

CREATE OR REPLACE FUNCTION compute_placement_points()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_mode   TEXT;
  v_custom JSONB;
BEGIN
  SELECT rg.points_mode, rg.custom_points
    INTO v_mode, v_custom
    FROM games g
    JOIN room_games rg ON rg.id = g.room_game_id
   WHERE g.id = NEW.game_id;

  IF v_mode = 'custom' AND v_custom IS NOT NULL THEN
    NEW.points := COALESCE((v_custom ->> NEW.place::TEXT)::SMALLINT, 0);
  ELSE
    -- Standard: 1st = 3, 2nd = 2, 3rd = 1, Loser = 0
    NEW.points := CASE NEW.place
      WHEN 1 THEN 3
      WHEN 2 THEN 2
      WHEN 3 THEN 1
      ELSE 0
    END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_placement_points
BEFORE INSERT ON game_placements
FOR EACH ROW EXECUTE FUNCTION compute_placement_points();

-- ── Server-side room code verification ───────────────────────────────────────
-- Called by the client BEFORE any room-scoped write.
-- Runs as the postgres role (SECURITY DEFINER) so it can read rooms.code,
-- which is hidden from the anon role via column-level privilege revocation below.

CREATE OR REPLACE FUNCTION check_room_code(p_room_id UUID, p_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM rooms
     WHERE id = p_room_id
       AND UPPER(code) = UPPER(TRIM(p_code))
  );
END;
$$;

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_placements_player ON game_placements(player_id);
CREATE INDEX idx_placements_game   ON game_placements(game_id);
CREATE INDEX idx_games_played_on   ON games(played_on DESC);
CREATE INDEX idx_games_room        ON games(room_id);
CREATE INDEX idx_room_games_room   ON room_games(room_id, "order");
CREATE INDEX idx_achievements_room ON achievements(room_id);
CREATE INDEX idx_ach_awards_player ON achievement_awards(player_id);

-- ── Views ─────────────────────────────────────────────────────────────────────
-- security_invoker = true means the view runs as the querying role (anon), so
-- RLS policies on the underlying tables are respected.

CREATE VIEW room_player_stats
WITH (security_invoker = true) AS
SELECT
  r.id                                                                          AS room_id,
  p.id                                                                          AS player_id,
  p.name,
  p.color,
  COUNT(DISTINCT gp.id)                                                         AS games_played,
  COALESCE(SUM(gp.points), 0)                                                   AS competition_points,
  COALESCE(ach.achievement_points, 0)                                           AS achievement_points,
  COALESCE(SUM(gp.points), 0) + COALESCE(ach.achievement_points, 0)            AS total_points,
  COUNT(gp.id) FILTER (WHERE gp.place = 1)                                      AS wins,
  COUNT(gp.id) FILTER (WHERE gp.place BETWEEN 1 AND 3)                         AS podium_finishes,
  ROUND(100.0 * COUNT(gp.id) FILTER (WHERE gp.place = 1)
    / NULLIF(COUNT(gp.id), 0))                                                  AS win_rate,
  ROUND(100.0 * COUNT(gp.id) FILTER (WHERE gp.place BETWEEN 1 AND 3)
    / NULLIF(COUNT(gp.id), 0))                                                  AS podium_rate
FROM rooms r
CROSS JOIN players p
WHERE p.id = ANY(r.invited_player_ids)
LEFT JOIN games g
       ON g.room_id = r.id
LEFT JOIN game_placements gp
       ON gp.game_id = g.id AND gp.player_id = p.id
LEFT JOIN (
  SELECT aa.player_id, a.room_id, SUM(a.point_value) AS achievement_points
    FROM achievement_awards aa
    JOIN achievements a ON a.id = aa.achievement_id
   GROUP BY aa.player_id, a.room_id
) ach ON ach.player_id = p.id AND ach.room_id = r.id
GROUP BY r.id, p.id, p.name, p.color, ach.achievement_points
ORDER BY total_points DESC, competition_points DESC;

-- Full game history with placements as a JSON array — matches getGames() shape.
CREATE VIEW game_history
WITH (security_invoker = true) AS
SELECT
  g.id,
  g.game_type,
  g.played_on       AS date,
  g.room_id,
  g.room_game_id,
  g.created_at,
  JSON_AGG(
    JSON_BUILD_OBJECT(
      'playerId', gp.player_id,
      'place',    gp.place,
      'points',   gp.points
    ) ORDER BY CASE WHEN gp.place = 0 THEN 99 ELSE gp.place END
  ) AS placements
FROM games g
JOIN game_placements gp ON gp.game_id = g.id
GROUP BY g.id, g.game_type, g.played_on, g.room_id, g.room_game_id, g.created_at
ORDER BY g.played_on DESC, g.created_at DESC;

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE players           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_games        ENABLE ROW LEVEL SECURITY;
ALTER TABLE games             ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_placements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievement_awards ENABLE ROW LEVEL SECURITY;

-- ── Read policies — public read on all tables ─────────────────────────────────

CREATE POLICY "read_players"
  ON players FOR SELECT TO anon, authenticated USING (true);

-- rooms: readable, but the 'code' column is separately revoked below
CREATE POLICY "read_rooms"
  ON rooms FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "read_room_games"
  ON room_games FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "read_games"
  ON games FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "read_game_placements"
  ON game_placements FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "read_achievements"
  ON achievements FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "read_achievement_awards"
  ON achievement_awards FOR SELECT TO anon, authenticated USING (true);

-- ── Write policies — open anon writes (room-code enforced at app layer) ───────
-- The client calls check_room_code() before any room-scoped mutation.
-- Tighten these to authenticated-only when you add Supabase Auth.

CREATE POLICY "write_players"
  ON players FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "write_rooms"
  ON rooms FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "write_room_games"
  ON room_games FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "write_games"
  ON games FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "write_game_placements"
  ON game_placements FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "write_achievements"
  ON achievements FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "write_achievement_awards"
  ON achievement_awards FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ── Hide room codes from the anon role ───────────────────────────────────────
-- Revoke SELECT on the 'code' column so it is never returned to the client.
-- Verification goes through the check_room_code() RPC (SECURITY DEFINER).
-- The 'authenticated' role also cannot read codes unless you explicitly grant it.

REVOKE SELECT ON rooms FROM anon, authenticated;
GRANT  SELECT (id, name, date, description, status, invited_player_ids, created_at)
  ON rooms TO anon, authenticated;

-- check_room_code is SECURITY DEFINER so it runs as postgres and can read 'code'.
GRANT EXECUTE ON FUNCTION check_room_code(UUID, TEXT) TO anon, authenticated;

-- ── Supabase JS client snippets ───────────────────────────────────────────────
-- Create src/db/supabaseDb.js and replace mockDb imports with these.
-- Every function signature and return shape matches mockDb.js exactly.
--
-- import { createClient } from '@supabase/supabase-js'
-- const supabase = createClient(import.meta.env.VITE_SUPABASE_URL,
--                               import.meta.env.VITE_SUPABASE_ANON_KEY)
--
-- ─ Players ───────────────────────────────────────────────────────────────────
--
-- export async function getPlayers() {
--   const { data } = await supabase.from('players').select('*').order('created_at')
--   return data ?? []
-- }
--
-- export async function addPlayer(name, color) {
--   const { data } = await supabase.from('players').insert({ name, color }).select().single()
--   return data
-- }
--
-- export async function removePlayer(id) {
--   await supabase.from('players').delete().eq('id', id)
--   // cascades: game_placements + achievement_awards deleted automatically
-- }
--
-- ─ Rooms ─────────────────────────────────────────────────────────────────────
-- NOTE: rooms.code is hidden — use check_room_code() RPC for verification.
--
-- export async function getRooms() {
--   const { data } = await supabase.from('rooms').select('*').order('date', { ascending: false })
--   return data ?? []
-- }
--
-- export async function getRoom(id) {
--   const { data } = await supabase.from('rooms').select('*').eq('id', id).single()
--   return data
-- }
--
-- export async function addRoom(name, date, description, invitedPlayerIds, status = 'upcoming') {
--   const code = Array.from({ length: 5 },
--     () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]
--   ).join('')
--   const { data } = await supabase.from('rooms').insert({
--     name, date, description, status,
--     invited_player_ids: invitedPlayerIds, code,
--   }).select().single()
--   return data
-- }
--
-- export async function updateRoom(id, updates) {
--   const mapped = {
--     name: updates.name, date: updates.date,
--     description: updates.description, status: updates.status,
--     ...(updates.invitedPlayerIds && { invited_player_ids: updates.invitedPlayerIds }),
--   }
--   await supabase.from('rooms').update(mapped).eq('id', id)
-- }
--
-- export async function deleteRoom(id) {
--   await supabase.from('rooms').delete().eq('id', id)
--   // room_games + achievements cascade-deleted; games SET NULL on room_id
-- }
--
-- ─ Room code verification ─────────────────────────────────────────────────────
-- Uses the SECURITY DEFINER RPC — code never leaves the database.
--
-- const VERIFIED_KEY = 'mc_verified'
--
-- export async function verifyRoomCode(roomId, code) {
--   const { data: ok, error } = await supabase.rpc('check_room_code',
--     { p_room_id: roomId, p_code: code })
--   if (error || !ok) return { error: 'Incorrect code' }
--   const verified = JSON.parse(sessionStorage.getItem(VERIFIED_KEY) || '{}')
--   verified[roomId] = true
--   sessionStorage.setItem(VERIFIED_KEY, JSON.stringify(verified))
--   return { ok: true }
-- }
--
-- export function isRoomVerified(roomId) {
--   try {
--     return !!JSON.parse(sessionStorage.getItem('mc_verified') || '{}')[roomId]
--   } catch { return false }
-- }
--
-- ─ Room games ─────────────────────────────────────────────────────────────────
--
-- export async function getRoomGames(roomId) {
--   const { data } = await supabase.from('room_games')
--     .select('*').eq('room_id', roomId).order('order', { ascending: true })
--   return data ?? []
-- }
--
-- export async function addRoomGame(roomId, { name, description, pointsMode, customPoints, order }) {
--   const { data } = await supabase.from('room_games').insert({
--     room_id: roomId, name, description,
--     points_mode: pointsMode,
--     custom_points: pointsMode === 'custom' ? customPoints : null,
--     order,
--   }).select().single()
--   return data
-- }
--
-- export async function updateRoomGame(id, updates) {
--   await supabase.from('room_games').update({
--     name: updates.name,
--     description: updates.description,
--     points_mode: updates.pointsMode,
--     custom_points: updates.pointsMode === 'custom' ? updates.customPoints : null,
--   }).eq('id', id)
-- }
--
-- export async function deleteRoomGame(id) {
--   await supabase.from('room_games').delete().eq('id', id)
--   // linked games keep rows; room_game_id → NULL via SET NULL FK
-- }
--
-- ─ Games ──────────────────────────────────────────────────────────────────────
--
-- export async function getGames() {
--   const { data } = await supabase.from('game_history').select('*')
--   // date is already mapped; placements is a JSON array matching mockDb shape
--   return (data ?? []).map(g => ({ ...g, roomId: g.room_id, roomGameId: g.room_game_id }))
-- }
--
-- export async function addGame(gameType, placements, date, roomId = null, roomGameId = null) {
--   const { data: game } = await supabase.from('games').insert({
--     game_type: gameType, played_on: date,
--     room_id: roomId ?? null, room_game_id: roomGameId ?? null,
--   }).select().single()
--   // trigger auto-computes points from room_game.custom_points on insert
--   await supabase.from('game_placements').insert(
--     placements.map(p => ({ game_id: game.id, player_id: p.playerId, place: p.place }))
--   )
--   return game
-- }
--
-- export async function deleteGame(id) {
--   await supabase.from('games').delete().eq('id', id)
--   // cascades to game_placements
-- }
--
-- ─ Achievements ───────────────────────────────────────────────────────────────
--
-- export async function getAchievements(roomId) {
--   const { data } = await supabase
--     .from('achievements')
--     .select('*, achievement_awards(player_id)')
--     .eq('room_id', roomId)
--   return (data ?? []).map(a => ({
--     ...a,
--     pointValue:   a.point_value,
--     awardedOnce:  a.awarded_once,
--     earnedByIds:  a.achievement_awards.map(x => x.player_id),
--   }))
-- }
--
-- export async function addAchievement(roomId, { name, description, icon, pointValue, awardedOnce }) {
--   const { data } = await supabase.from('achievements').insert({
--     room_id: roomId, name, description, icon,
--     point_value: pointValue, awarded_once: awardedOnce,
--   }).select().single()
--   return data
-- }
--
-- export async function updateAchievement(id, updates) {
--   await supabase.from('achievements').update({
--     name: updates.name, description: updates.description, icon: updates.icon,
--     point_value: Number(updates.pointValue), awarded_once: updates.awardedOnce,
--   }).eq('id', id)
-- }
--
-- export async function deleteAchievement(id) {
--   await supabase.from('achievements').delete().eq('id', id)
-- }
--
-- export async function awardAchievement(achievementId, playerId) {
--   const { data: ach } = await supabase.from('achievements')
--     .select('awarded_once, achievement_awards(player_id)')
--     .eq('id', achievementId).single()
--   if (!ach) return { error: 'Achievement not found' }
--   if (ach.awarded_once && ach.achievement_awards.length > 0) return { error: 'Already awarded' }
--   if (ach.achievement_awards.some(x => x.player_id === playerId)) return { error: 'Player already has this' }
--   await supabase.from('achievement_awards').insert({ achievement_id: achievementId, player_id: playerId })
--   return { ok: true }
-- }
--
-- export async function revokeAchievement(achievementId, playerId) {
--   await supabase.from('achievement_awards')
--     .delete().eq('achievement_id', achievementId).eq('player_id', playerId)
-- }
--
-- ─ Stats ──────────────────────────────────────────────────────────────────────
--
-- export async function getRoomStats(roomId) {
--   const { data } = await supabase.from('room_player_stats')
--     .select('*').eq('room_id', roomId).order('total_points', { ascending: false })
--   return (data ?? []).map(p => ({
--     ...p,
--     competitionPoints: p.competition_points,
--     achievementPoints: p.achievement_points,
--     totalPoints:       p.total_points,
--     points:            p.total_points,        // backward-compat alias
--     played:            p.games_played,
--     podiums:           p.podium_finishes,
--     winRate:           p.win_rate,
--     podiumRate:        p.podium_rate,
--     streak:            0,                     // compute client-side from game_history if needed
--     favGame:           '—',                   // compute client-side from game_history if needed
--     earnedAchs:        [],                    // fetch separately via getAchievements if needed
--   }))
-- }
--
-- ─ .env file ──────────────────────────────────────────────────────────────────
-- Create .env.local in the project root (already in .gitignore):
--   VITE_SUPABASE_URL=https://xxxx.supabase.co
--   VITE_SUPABASE_ANON_KEY=eyJ...
