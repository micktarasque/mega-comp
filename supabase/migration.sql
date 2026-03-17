-- ─────────────────────────────────────────────────────────────────────────────
-- Mega Comp — Supabase migration v4
-- Run once in the Supabase SQL editor or via CLI:
--   supabase db push
--
-- Schema overview:
--   players          — global roster
--   rooms            — competitions / game nights
--   room_games       — scheduled games within a room (with optional custom scoring)
--   games            — logged results, optionally linked to a room / room_game
--   game_placements  — one row per player per game (place + points auto-computed)
--   achievements     — text-based achievements scoped to a room
--   achievement_awards — who earned which achievement
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE players (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#7C6FFF',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rooms (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  date               DATE NOT NULL,
  description        TEXT,
  status             TEXT NOT NULL DEFAULT 'upcoming'
                       CHECK (status IN ('upcoming', 'active', 'completed')),
  invited_player_ids UUID[] NOT NULL DEFAULT '{}',  -- FK integrity checked at app layer
  code               TEXT NOT NULL,                  -- 5-char alphanumeric, enforced by app
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Games scheduled for a room, each with its own optional custom point scale
CREATE TABLE room_games (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID    NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  description   TEXT,
  "order"       SMALLINT NOT NULL DEFAULT 1,
  points_mode   TEXT    NOT NULL DEFAULT 'standard'
                  CHECK (points_mode IN ('standard', 'custom')),
  -- custom_points shape: {"1": 5, "2": 3, "3": 2, "0": 1}  (keys are place values as text)
  custom_points JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Logged game results (free-play or linked to a room / room_game)
CREATE TABLE games (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type    TEXT NOT NULL,
  played_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  room_id      UUID REFERENCES rooms(id)      ON DELETE SET NULL,  -- SET NULL keeps history
  room_game_id UUID REFERENCES room_games(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per player per game
-- place: 1=1st  2=2nd  3=3rd  0=Loser
CREATE TABLE game_placements (
  id        UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id   UUID     NOT NULL REFERENCES games(id)   ON DELETE CASCADE,
  player_id UUID     NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  place     SMALLINT NOT NULL CHECK (place IN (0, 1, 2, 3)),
  points    SMALLINT NOT NULL DEFAULT 0,  -- auto-filled by trigger on insert
  UNIQUE (game_id, player_id),
  UNIQUE (game_id, place) WHERE place > 0  -- one winner, one 2nd, one 3rd per game
);

-- Achievements defined per room (manually awarded)
CREATE TABLE achievements (
  id           UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID     NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name         TEXT     NOT NULL,
  description  TEXT,
  icon         TEXT     NOT NULL DEFAULT '⭐',
  point_value  SMALLINT NOT NULL DEFAULT 1,
  awarded_once BOOLEAN  NOT NULL DEFAULT true,  -- exclusive: only one player can earn it
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Junction: which players have earned each achievement
CREATE TABLE achievement_awards (
  achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  player_id      UUID NOT NULL REFERENCES players(id)      ON DELETE CASCADE,
  awarded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (achievement_id, player_id)
);

-- ── Auto-compute points on placement insert ───────────────────────────────────
-- Resolves custom vs standard scoring at write time based on the linked room_game.

CREATE OR REPLACE FUNCTION compute_placement_points()
RETURNS TRIGGER AS $$
DECLARE
  v_mode   TEXT;
  v_custom JSONB;
BEGIN
  -- Look up the room_game for this game (may be NULL for free-play games)
  SELECT rg.points_mode, rg.custom_points
    INTO v_mode, v_custom
    FROM games g
    JOIN room_games rg ON rg.id = g.room_game_id
   WHERE g.id = NEW.game_id;

  IF v_mode = 'custom' AND v_custom IS NOT NULL THEN
    NEW.points := COALESCE((v_custom ->> NEW.place::TEXT)::SMALLINT, 0);
  ELSE
    -- Standard scoring: 1st=3, 2nd=2, 3rd=1, Loser=0
    NEW.points := CASE NEW.place
      WHEN 1 THEN 3
      WHEN 2 THEN 2
      WHEN 3 THEN 1
      ELSE 0
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_placement_points
BEFORE INSERT ON game_placements
FOR EACH ROW EXECUTE FUNCTION compute_placement_points();

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_placements_player ON game_placements(player_id);
CREATE INDEX idx_placements_game   ON game_placements(game_id);
CREATE INDEX idx_games_played_on   ON games(played_on DESC);
CREATE INDEX idx_games_room        ON games(room_id);
CREATE INDEX idx_room_games_room   ON room_games(room_id, "order");
CREATE INDEX idx_achievements_room ON achievements(room_id);
CREATE INDEX idx_ach_awards_player ON achievement_awards(player_id);

-- ── Views ─────────────────────────────────────────────────────────────────────

-- Per-room standings — matches getRoomStats() shape exactly
CREATE VIEW room_player_stats AS
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
-- only players invited to this room
WHERE p.id = ANY(r.invited_player_ids)
LEFT JOIN games g
       ON g.room_id = r.id
LEFT JOIN game_placements gp
       ON gp.game_id = g.id
      AND gp.player_id = p.id
-- pre-aggregate achievement points per (player, room)
LEFT JOIN (
  SELECT aa.player_id,
         a.room_id,
         SUM(a.point_value) AS achievement_points
    FROM achievement_awards aa
    JOIN achievements a ON a.id = aa.achievement_id
   GROUP BY aa.player_id, a.room_id
) ach ON ach.player_id = p.id AND ach.room_id = r.id
GROUP BY r.id, p.id, p.name, p.color, ach.achievement_points
ORDER BY total_points DESC, competition_points DESC;

-- Full game history with placements as a JSON array — matches getGames() shape
CREATE VIEW game_history AS
SELECT
  g.id,
  g.game_type,
  g.played_on                                        AS date,
  g.room_id,
  g.room_game_id,
  g.created_at,
  JSON_AGG(
    JSON_BUILD_OBJECT(
      'playerId', gp.player_id,
      'place',    gp.place,
      'points',   gp.points
    ) ORDER BY
      CASE WHEN gp.place = 0 THEN 99 ELSE gp.place END  -- winners first, losers last
  ) AS placements
FROM games g
JOIN game_placements gp ON gp.game_id = g.id
GROUP BY g.id, g.game_type, g.played_on, g.room_id, g.room_game_id, g.created_at
ORDER BY g.played_on DESC, g.created_at DESC;

-- ── Row Level Security ────────────────────────────────────────────────────────
-- All tables default to public read/write (fine for a private friend app).
-- Room-code authorization is enforced at the application layer.
-- Uncomment and adapt below if you add Supabase Auth later.

-- ALTER TABLE players            ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE rooms              ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE room_games         ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE games              ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE game_placements    ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE achievements       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE achievement_awards ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "public_read"  ON players            FOR SELECT USING (true);
-- CREATE POLICY "public_write" ON players            FOR ALL    USING (true);
-- ...repeat for each table...

-- ── Supabase JS client snippets ───────────────────────────────────────────────
-- Drop these into a new src/db/supabaseDb.js, replacing mockDb.js imports.
-- Shape matches the current mockDb API exactly.
--
-- ─ Setup ─
--   import { createClient } from '@supabase/supabase-js'
--   const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
--
-- ─ Players ─
--   getPlayers:
--     const { data } = await supabase.from('players').select('*').order('created_at')
--
--   addPlayer(name, color):
--     const { data } = await supabase.from('players')
--       .insert({ name, color }).select().single()
--
--   removePlayer(id):
--     await supabase.from('players').delete().eq('id', id)
--     // cascades: game_placements + achievement_awards deleted automatically
--
-- ─ Rooms ─
--   getRooms:
--     const { data } = await supabase.from('rooms').select('*').order('date', { ascending: false })
--
--   getRoom(id):
--     const { data } = await supabase.from('rooms').select('*').eq('id', id).single()
--
--   addRoom(name, date, description, invitedPlayerIds, status):
--     const code = Array.from({length:5}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join('')
--     const { data } = await supabase.from('rooms')
--       .insert({ name, date, description, status, invited_player_ids: invitedPlayerIds, code })
--       .select().single()
--
--   updateRoom(id, updates):
--     // map camelCase → snake_case as needed (invited_player_ids, etc.)
--     await supabase.from('rooms').update(updates).eq('id', id)
--
--   deleteRoom(id):
--     await supabase.from('rooms').delete().eq('id', id)
--     // room_games + achievements cascade-deleted
--     // games keep their rows but room_id → NULL (SET NULL FK)
--
-- ─ Room games ─
--   getRoomGames(roomId):
--     const { data } = await supabase.from('room_games')
--       .select('*').eq('room_id', roomId).order('order', { ascending: true })
--
--   addRoomGame(roomId, { name, description, pointsMode, customPoints, order }):
--     const { data } = await supabase.from('room_games')
--       .insert({ room_id: roomId, name, description,
--                 points_mode: pointsMode, custom_points: customPoints ?? null, order })
--       .select().single()
--
--   updateRoomGame(id, updates):
--     await supabase.from('room_games').update({
--       name: updates.name, description: updates.description,
--       points_mode: updates.pointsMode,
--       custom_points: updates.pointsMode === 'custom' ? updates.customPoints : null,
--     }).eq('id', id)
--
--   deleteRoomGame(id):
--     await supabase.from('room_games').delete().eq('id', id)
--     // linked games keep their rows but room_game_id → NULL (SET NULL FK)
--
-- ─ Games ─
--   getGames:
--     const { data } = await supabase.from('game_history').select('*')
--     // map: date is already 'date', placements is JSON array
--
--   addGame(gameType, placements, date, roomId, roomGameId):
--     const { data: game } = await supabase.from('games')
--       .insert({ game_type: gameType, played_on: date,
--                 room_id: roomId ?? null, room_game_id: roomGameId ?? null })
--       .select().single()
--     // trigger auto-computes points from room_game.custom_points on insert
--     await supabase.from('game_placements')
--       .insert(placements.map(p => ({ game_id: game.id, player_id: p.playerId, place: p.place })))
--
--   deleteGame(id):
--     await supabase.from('games').delete().eq('id', id)
--     // cascades to game_placements
--
-- ─ Achievements ─
--   getAchievements(roomId):
--     const { data } = await supabase
--       .from('achievements')
--       .select('*, achievement_awards(player_id)')
--       .eq('room_id', roomId)
--     // map: earnedByIds = row.achievement_awards.map(x => x.player_id)
--
--   addAchievement(roomId, { name, description, icon, pointValue, awardedOnce }):
--     const { data } = await supabase.from('achievements')
--       .insert({ room_id: roomId, name, description, icon,
--                 point_value: pointValue, awarded_once: awardedOnce })
--       .select().single()
--
--   updateAchievement(id, updates):
--     await supabase.from('achievements').update({
--       name: updates.name, description: updates.description, icon: updates.icon,
--       point_value: updates.pointValue, awarded_once: updates.awardedOnce,
--     }).eq('id', id)
--
--   deleteAchievement(id):
--     await supabase.from('achievements').delete().eq('id', id)
--
--   awardAchievement(achievementId, playerId):
--     const { data: ach } = await supabase.from('achievements')
--       .select('awarded_once, achievement_awards(player_id)').eq('id', achievementId).single()
--     if (ach.awarded_once && ach.achievement_awards.length > 0) return { error: 'Already awarded' }
--     if (ach.achievement_awards.some(x => x.player_id === playerId)) return { error: 'Player already has this' }
--     await supabase.from('achievement_awards').insert({ achievement_id: achievementId, player_id: playerId })
--     return { ok: true }
--
--   revokeAchievement(achievementId, playerId):
--     await supabase.from('achievement_awards')
--       .delete().eq('achievement_id', achievementId).eq('player_id', playerId)
--
-- ─ Stats ─
--   getRoomStats(roomId):
--     const { data } = await supabase.from('room_player_stats')
--       .select('*').eq('room_id', roomId).order('total_points', { ascending: false })
--     // map snake_case fields → camelCase to match mockDb shape
--
-- ─ Room code verification (stays client-side; no server round-trip needed) ─
--   verifyRoomCode(roomId, code):
--     const { data: room } = await supabase.from('rooms').select('code').eq('id', roomId).single()
--     if (!room || room.code.toUpperCase() !== code.toUpperCase()) return { error: 'Incorrect code' }
--     sessionStorage.setItem('mc_verified', JSON.stringify({ ...JSON.parse(sessionStorage.getItem('mc_verified') || '{}'), [roomId]: true }))
--     return { ok: true }
