-- Mega Comp — Supabase migration v5 (room-scoped players)
-- Paste into: Dashboard → SQL Editor → New query → Run

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE rooms (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT    NOT NULL,
  date        DATE    NOT NULL,
  description TEXT,
  status      TEXT    NOT NULL DEFAULT 'upcoming'
                CHECK (status IN ('upcoming', 'active', 'completed')),
  code        TEXT    NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE room_players (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#7C6FFF',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE room_games (
  id            UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID     NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name          TEXT     NOT NULL,
  description   TEXT,
  "order"       SMALLINT NOT NULL DEFAULT 1,
  points_mode   TEXT     NOT NULL DEFAULT 'standard'
                  CHECK (points_mode IN ('standard', 'custom')),
  custom_points JSONB,     -- e.g. {"1":5,"2":3,"3":2,"0":1}
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE games (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type    TEXT NOT NULL,
  played_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  room_id      UUID REFERENCES rooms(id)      ON DELETE SET NULL,
  room_game_id UUID REFERENCES room_games(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- place: 1=1st  2=2nd  3=3rd  0=Loser
CREATE TABLE game_placements (
  id        UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id   UUID     NOT NULL REFERENCES games(id)        ON DELETE CASCADE,
  player_id UUID     NOT NULL REFERENCES room_players(id) ON DELETE CASCADE,
  place     SMALLINT NOT NULL CHECK (place IN (0, 1, 2, 3)),
  points    SMALLINT NOT NULL DEFAULT 0,
  UNIQUE (game_id, player_id)
);

CREATE UNIQUE INDEX idx_one_place_per_game
  ON game_placements (game_id, place)
  WHERE place > 0;

CREATE TABLE achievements (
  id           UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID     NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name         TEXT     NOT NULL,
  description  TEXT,
  icon         TEXT     NOT NULL DEFAULT '⭐',
  point_value  SMALLINT NOT NULL DEFAULT 1,
  awarded_once BOOLEAN  NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE achievement_awards (
  achievement_id UUID NOT NULL REFERENCES achievements(id)  ON DELETE CASCADE,
  player_id      UUID NOT NULL REFERENCES room_players(id)  ON DELETE CASCADE,
  awarded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (achievement_id, player_id)
);

-- ── Trigger: auto-compute points on insert ────────────────────────────────────
-- Resolves custom vs standard scoring from the linked room_game at write time.

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
    NEW.points := CASE NEW.place
      WHEN 1 THEN 3 WHEN 2 THEN 2 WHEN 3 THEN 1 ELSE 0
    END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_placement_points
BEFORE INSERT ON game_placements
FOR EACH ROW EXECUTE FUNCTION compute_placement_points();

-- ── Room code verification RPC ────────────────────────────────────────────────
-- SECURITY DEFINER so it can read rooms.code, which is hidden from anon below.

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

CREATE INDEX idx_room_players_room  ON room_players(room_id);
CREATE INDEX idx_placements_player  ON game_placements(player_id);
CREATE INDEX idx_placements_game    ON game_placements(game_id);
CREATE INDEX idx_games_played_on    ON games(played_on DESC);
CREATE INDEX idx_games_room         ON games(room_id);
CREATE INDEX idx_room_games_room    ON room_games(room_id, "order");
CREATE INDEX idx_achievements_room  ON achievements(room_id);
CREATE INDEX idx_ach_awards_player  ON achievement_awards(player_id);

-- ── Views ─────────────────────────────────────────────────────────────────────

CREATE VIEW room_player_stats
WITH (security_invoker = true) AS
SELECT
  rp.room_id,
  rp.id                                                                        AS player_id,
  rp.name,
  rp.color,
  COUNT(DISTINCT gp.id)                                                        AS games_played,
  COALESCE(SUM(gp.points), 0)                                                  AS competition_points,
  COALESCE(ach.achievement_points, 0)                                          AS achievement_points,
  COALESCE(SUM(gp.points), 0) + COALESCE(ach.achievement_points, 0)           AS total_points,
  COUNT(gp.id) FILTER (WHERE gp.place = 1)                                     AS wins,
  COUNT(gp.id) FILTER (WHERE gp.place BETWEEN 1 AND 3)                        AS podium_finishes,
  ROUND(100.0 * COUNT(gp.id) FILTER (WHERE gp.place = 1)
    / NULLIF(COUNT(gp.id), 0))                                                 AS win_rate,
  ROUND(100.0 * COUNT(gp.id) FILTER (WHERE gp.place BETWEEN 1 AND 3)
    / NULLIF(COUNT(gp.id), 0))                                                 AS podium_rate
FROM room_players rp
LEFT JOIN games g            ON g.room_id = rp.room_id
LEFT JOIN game_placements gp ON gp.game_id = g.id AND gp.player_id = rp.id
LEFT JOIN (
  SELECT aa.player_id, a.room_id, SUM(a.point_value) AS achievement_points
    FROM achievement_awards aa
    JOIN achievements a ON a.id = aa.achievement_id
   GROUP BY aa.player_id, a.room_id
) ach ON ach.player_id = rp.id AND ach.room_id = rp.room_id
GROUP BY rp.room_id, rp.id, rp.name, rp.color, ach.achievement_points
ORDER BY total_points DESC, competition_points DESC;

CREATE VIEW game_history
WITH (security_invoker = true) AS
SELECT
  g.id,
  g.game_type,
  g.played_on    AS date,
  g.room_id,
  g.room_game_id,
  g.created_at,
  JSON_AGG(
    JSON_BUILD_OBJECT(
      'playerId',    gp.player_id,
      'playerName',  rp.name,
      'playerColor', rp.color,
      'place',       gp.place,
      'points',      gp.points
    )
    ORDER BY CASE WHEN gp.place = 0 THEN 99 ELSE gp.place END
  ) AS placements
FROM games g
JOIN game_placements gp ON gp.game_id = g.id
JOIN room_players rp    ON rp.id = gp.player_id
GROUP BY g.id, g.game_type, g.played_on, g.room_id, g.room_game_id, g.created_at
ORDER BY g.played_on DESC, g.created_at DESC;

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE rooms              ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_players       ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_games         ENABLE ROW LEVEL SECURITY;
ALTER TABLE games              ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_placements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievement_awards ENABLE ROW LEVEL SECURITY;

-- Public read on all tables
CREATE POLICY "read_rooms"              ON rooms              FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read_room_players"       ON room_players       FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read_room_games"         ON room_games         FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read_games"              ON games              FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read_game_placements"    ON game_placements    FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read_achievements"       ON achievements       FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read_achievement_awards" ON achievement_awards FOR SELECT TO anon, authenticated USING (true);

-- Open writes — room-code integrity enforced at the application layer
CREATE POLICY "write_rooms"              ON rooms              FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "write_room_players"       ON room_players       FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "write_room_games"         ON room_games         FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "write_games"              ON games              FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "write_game_placements"    ON game_placements    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "write_achievements"       ON achievements       FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "write_achievement_awards" ON achievement_awards FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Grant table-level access (PostgREST requires this; column-level grants alone cause permission denied)
GRANT SELECT ON rooms TO anon, authenticated;

GRANT EXECUTE ON FUNCTION check_room_code(UUID, TEXT) TO anon, authenticated;
