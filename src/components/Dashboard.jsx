import { useEffect, useState, useRef, useMemo } from 'react'
import { getRoomStats, getRooms, getGames, getRoomGames, getAchievements, deleteGame, PLACE_EMOJI } from '../db/supabaseDb'

const LAST_ROOM_KEY = 'mc_last_room'

function formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function initials(n) { return n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) }

// ── Animated counter ──────────────────────────────────────────────────────────
function useCounter(target, duration = 1400) {
  const [val, setVal] = useState(0)
  const raf = useRef(null)
  useEffect(() => {
    const start = performance.now()
    function step(now) {
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 4)
      setVal(Math.round(eased * target))
      if (t < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [target, duration])
  return val
}

// ── SVG ring ──────────────────────────────────────────────────────────────────
function Ring({ pct, color, size = 72, stroke = 6, glow = true }) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const fill = (Math.min(pct, 100) / 100) * circ
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 1.4s cubic-bezier(0.34,1.56,0.64,1)',
                 filter: glow ? `drop-shadow(0 0 5px ${color}99)` : 'none' }}
      />
    </svg>
  )
}

function StatusDot({ color = '#43E97B' }) {
  return <span className="status-dot" style={{ '--dot-color': color }} />
}

const FORM_META = {
  1: { bg: '#43E97B', label: 'W' },
  2: { bg: '#C0C8D8', label: '2' },
  3: { bg: '#CD7F32', label: '3' },
  0: { bg: '#FF4040', label: 'L' },
}
function FormSquare({ place }) {
  const m = FORM_META[place] ?? FORM_META[0]
  return (
    <div className="form-sq" style={{ background: m.bg + '25', borderColor: m.bg, color: m.bg, boxShadow: `0 0 5px ${m.bg}44` }}>
      {m.label}
    </div>
  )
}

function Badge({ icon, label, color = 'var(--muted)' }) {
  return (
    <div className="badge" style={{ borderColor: color + '50', color }}>
      <span>{icon}</span><span className="badge-label">{label}</span>
    </div>
  )
}

// ── Orbiting particles ────────────────────────────────────────────────────────
const PARTICLE_DATA = Array.from({ length: 18 }, (_, i) => ({
  angle: (i / 18) * 360,
  r: 80 + (i % 3) * 22,
  size: 2 + (i % 4),
  speed: 6 + (i % 5) * 2,
  delay: -(i * 0.6),
}))
function Particles({ color }) {
  return (
    <div className="orbit-container">
      {PARTICLE_DATA.map((p, i) => (
        <div key={i} className="orbit-particle"
          style={{
            '--color': color,
            '--orbit-r': `${p.r}px`,
            '--size': `${p.size}px`,
            '--speed': `${p.speed}s`,
            '--delay': `${p.delay}s`,
            '--start': `${p.angle}deg`,
          }}
        />
      ))}
    </div>
  )
}

const SPARK_DATA = Array.from({ length: 8 }, (_, i) => ({
  x: 10 + (i * 11) % 80,
  y: 10 + (i * 17) % 80,
  delay: i * 0.4,
  duration: 2.5 + (i % 3) * 0.8,
}))
function Sparks({ color }) {
  return (
    <>
      {SPARK_DATA.map((s, i) => (
        <div key={i} className="spark"
          style={{ '--color': color, left: `${s.x}%`, top: `${s.y}%`, '--delay': `${s.delay}s`, '--dur': `${s.duration}s` }}
        />
      ))}
    </>
  )
}

function formGuide(games, playerId, n = 8) {
  return games
    .filter(g => g.placements.some(p => p.playerId === playerId))
    .slice(0, n)
    .map(g => g.placements.find(p => p.playerId === playerId).place)
}

function computeH2H(games, players) {
  const matrix = {}
  for (const a of players) {
    for (const b of players) {
      if (a.id === b.id) continue
      const key = [a.id, b.id].sort().join('_')
      if (matrix[key]) continue
      const together = games.filter(g =>
        g.placements.some(p => p.playerId === a.id) &&
        g.placements.some(p => p.playerId === b.id)
      )
      const aW = together.filter(g => g.placements.find(p => p.playerId === a.id)?.place === 1).length
      const bW = together.filter(g => g.placements.find(p => p.playerId === b.id)?.place === 1).length
      matrix[key] = { played: together.length, [a.id]: aW, [b.id]: bW }
    }
  }
  return matrix
}

function gameDominance(games, players) {
  const types = [...new Set(games.map(g => g.gameType))]
  return types.map(type => {
    const tg = games.filter(g => g.gameType === type)
    const counts = {}
    tg.forEach(g => {
      const w = g.placements.find(p => p.place === 1)
      if (w) counts[w.playerId] = (counts[w.playerId] || 0) + 1
    })
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    const champion = top ? players.find(p => p.id === top[0]) : null
    return { type, played: tg.length, champion, wins: top?.[1] ?? 0 }
  }).sort((a, b) => b.played - a.played)
}

function getStatBadges(player, allStats) {
  const badges = []
  const sorted = [...allStats].sort((a, b) => b.points - a.points)
  if (sorted[0]?.id === player.id) badges.push({ icon: '👑', label: 'KING', color: '#FFD700' })
  if (player.streak >= 3) badges.push({ icon: '⚡', label: `${player.streak} STREAK`, color: '#FF6B35' })
  else if (player.streak >= 2) badges.push({ icon: '🔥', label: 'ON FIRE', color: '#FF6B35' })
  if (player.winRate >= 65 && player.played >= 3) badges.push({ icon: '🎯', label: 'SHARP', color: '#43E97B' })
  if (player.podiumRate >= 75 && player.played >= 3) badges.push({ icon: '🏆', label: 'PODIUM HOG', color: '#C0C8D8' })
  const maxPlayed = Math.max(...allStats.map(s => s.played))
  if (player.played === maxPlayed && player.played > 0) badges.push({ icon: '🎖️', label: 'VETERAN', color: '#00C2FF' })
  return badges
}

// ── Activity ticker ───────────────────────────────────────────────────────────
function ActivityTicker({ games }) {
  if (games.length === 0) return null
  const items = games.slice(0, 15)
  return (
    <div className="ticker-wrap">
      <span className="ticker-label">► NOW ◄</span>
      <div className="ticker-track">
        <div className="ticker-inner">
          {[...items, ...items].map((g, i) => {
            const w = g.placements.find(p => p.place === 1)
            return (
              <span key={i} className="ticker-item">
                <span style={{ color: w?.playerColor ?? 'var(--text)' }}>🏆 {w?.playerName ?? '?'}</span>
                {' won '}<span style={{ color: 'var(--muted)' }}>{g.gameType}</span>
                {' ·· '}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Champion hero ─────────────────────────────────────────────────────────────
function ChampionPanel({ champion, runner_up, stats, games }) {
  const pts  = useCounter(champion.points)
  const wins = useCounter(champion.wins)
  const lead = champion.points - (runner_up?.points ?? 0)
  const form   = useMemo(() => formGuide(games, champion.id, 8), [games, champion.id])
  const badges = useMemo(() => getStatBadges(champion, stats), [champion, stats])

  return (
    <div className="champion-panel">
      <Sparks color={champion.color} />
      <div className="champion-glow" style={{ background: champion.color }} />
      <div className="champion-glow champion-glow-2" style={{ background: champion.color }} />

      <div className="champ-header-row">
        <div className="champ-header-badge">
          <StatusDot color={champion.color} />
          ◄◄ RANK #1 — COMPETITION LEADER ►►
        </div>
        {lead > 0 && (
          <div className="lead-pill" style={{ borderColor: champion.color + '60', color: champion.color }}>
            +{lead} PTS AHEAD OF 2ND
          </div>
        )}
        {champion.streak > 1 && (
          <div className="streak-pill">
            <span className="streak-fire">🔥</span>
            {champion.streak}-GAME WIN STREAK
          </div>
        )}
      </div>

      <div className="champion-body">
        <div className="champion-identity">
          <Particles color={champion.color} />
          <div className="champion-rings-wrap">
            <div className="champ-ring r1" style={{ borderColor: champion.color + '50' }} />
            <div className="champ-ring r2" style={{ borderColor: champion.color + '30' }} />
            <div className="champ-ring r3" style={{ borderColor: champion.color + '15' }} />
            <div className="champion-avatar" style={{ background: champion.color + '20', boxShadow: `0 0 50px ${champion.color}55, 0 0 100px ${champion.color}22` }}>
              <span style={{ color: champion.color }}>{initials(champion.name)}</span>
            </div>
          </div>
          <div className="champion-crown">👑</div>
          <div className="champion-name" style={{ textShadow: `0 0 40px ${champion.color}66` }}>{champion.name}</div>

          <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            {form.map((place, i) => <FormSquare key={i} place={place} />)}
          </div>

          {badges.length > 0 && (
            <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.6rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              {badges.map((b, i) => <Badge key={i} {...b} />)}
            </div>
          )}
        </div>

        <div className="champion-stats-grid">
          <div className="cs-big">
            <div className="cs-val" style={{ color: champion.color }}>{pts}</div>
            <div className="cs-lbl">HIGH SCORE</div>
          </div>
          <div className="cs-big">
            <div className="cs-val">{wins}</div>
            <div className="cs-lbl">🏆 VICTORIES</div>
          </div>
          <div className="cs-big">
            <div className="cs-val">{champion.podiums}</div>
            <div className="cs-lbl">🥉 PODIUMS</div>
          </div>
          <div className="cs-big">
            <div className="cs-val">{champion.played}</div>
            <div className="cs-lbl">CREDITS USED</div>
          </div>

          <div className="cs-ring">
            <div className="cs-ring-inner">
              <Ring pct={champion.winRate} color={champion.color} size={80} stroke={6} />
              <div className="cs-ring-label">
                <div style={{ fontSize: '1.1rem', fontWeight: 900 }}>{champion.winRate}%</div>
                <div style={{ fontSize: '0.55rem', color: 'var(--muted)', letterSpacing: '0.1em' }}>WIN%</div>
              </div>
            </div>
          </div>

          <div className="cs-ring">
            <div className="cs-ring-inner">
              <Ring pct={champion.podiumRate} color="#F7971E" size={80} stroke={6} />
              <div className="cs-ring-label">
                <div style={{ fontSize: '1.1rem', fontWeight: 900 }}>{champion.podiumRate}%</div>
                <div style={{ fontSize: '0.55rem', color: 'var(--muted)', letterSpacing: '0.1em' }}>PODIUM%</div>
              </div>
            </div>
          </div>

          <div className="cs-wide">
            <div className="cs-lbl" style={{ marginBottom: '0.35rem' }}>HOME STAGE</div>
            <div style={{ fontSize: '1rem', fontWeight: 800, fontFamily: "'Courier New', monospace" }}>{champion.favGame}</div>
          </div>

          <div className="cs-wide">
            <div className="cs-lbl" style={{ marginBottom: '0.35rem' }}>KILL STREAK</div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: champion.streak > 1 ? '#FF6B35' : 'var(--muted)' }}>
              {champion.streak > 1 ? `🔥 ${champion.streak} WINS` : champion.streak === 1 ? '1 WIN' : '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="scanline" />
    </div>
  )
}

// ── Chump corner ──────────────────────────────────────────────────────────────
function ChumpPanel({ chump, champion, games }) {
  const losses = useMemo(() =>
    games.filter(g => { const p = g.placements.find(p => p.playerId === chump.id); return p && p.place === 0 }).length
  , [games, chump.id])

  const gap  = champion.points - chump.points
  const form = useMemo(() => formGuide(games, chump.id, 8), [games, chump.id])

  const loseStreak = useMemo(() => {
    const sorted = games.filter(g => g.placements.some(p => p.playerId === chump.id)).slice(0, 10)
    let s = 0
    for (const g of sorted) {
      const p = g.placements.find(p => p.playerId === chump.id)
      if (p?.place === 0) s++
      else break
    }
    return s
  }, [games, chump.id])

  const lossCounter = useCounter(losses)

  return (
    <div className="chump-panel">
      <div className="chump-glow" />
      <div className="chump-header">
        <span className="chump-badge">💩 HALL OF SHAME</span>
        <StatusDot color="#FF4040" />
      </div>

      <div className="chump-body">
        <div className="chump-identity">
          <div className="chump-avatar" style={{ background: chump.color + '15', borderColor: '#FF4040' }}>
            <span style={{ color: '#FF4040' }}>{initials(chump.name)}</span>
          </div>
          <div className="chump-name">{chump.name}</div>
          <div className="chump-subtitle">CERTIFIED CHUMP</div>
          <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.6rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            {form.map((place, i) => <FormSquare key={i} place={place} />)}
          </div>
        </div>

        <div className="chump-stats">
          <div className="chump-stat big-shame">
            <div className="chump-stat-val">{lossCounter}</div>
            <div className="chump-stat-lbl">☠ GAME OVERS</div>
          </div>
          <div className="chump-stat">
            <div className="chump-stat-val" style={{ color: '#FF4040' }}>{chump.winRate}%</div>
            <div className="chump-stat-lbl">WIN RATE</div>
          </div>
          <div className="chump-stat">
            <div className="chump-stat-val">{chump.points}</div>
            <div className="chump-stat-lbl">PTS</div>
          </div>
          <div className="chump-stat">
            <div className="chump-stat-val" style={{ color: '#FF4040' }}>−{gap}</div>
            <div className="chump-stat-lbl">BEHIND LEADER</div>
          </div>
          {loseStreak >= 2 && (
            <div className="chump-streak-alert">
              ☠️ ON A {loseStreak}-GAME LOSING STREAK
            </div>
          )}
          <div className="tilt-meter-wrap">
            <div className="tilt-label">TILT METER</div>
            <div className="tilt-track">
              <div className="tilt-fill" style={{ width: `${Math.max(100 - chump.winRate, 20)}%` }} />
            </div>
            <div className="tilt-pegged">🤡 TILTED</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Points Race ───────────────────────────────────────────────────────────────
function PointsRace({ stats }) {
  const max = stats[0]?.points || 1
  return (
    <div className="cockpit-panel">
      <div className="panel-header"><StatusDot color="#FFD700" /><span>◄ SCORE RACE ►</span></div>
      {stats.map((p, i) => {
        const pct = (p.points / max) * 100
        return (
          <div key={p.id} className="race-row">
            <div className="race-player-info">
              <span className="race-rank" style={{ color: i === 0 ? '#FFD700' : 'var(--muted)' }}>{i + 1}</span>
              <div className="dot" style={{ background: p.color, boxShadow: `0 0 6px ${p.color}` }} />
              <span className="race-name">{p.name}</span>
            </div>
            <div className="race-track">
              <div className="race-bar"
                style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${p.color}66, ${p.color})`, boxShadow: `0 0 14px ${p.color}66` }}
              />
              {i === 0 && <div className="race-leader-dot" style={{ left: `${pct}%`, background: p.color, boxShadow: `0 0 8px ${p.color}` }} />}
            </div>
            <span className="race-pts" style={{ color: p.color }}>{p.points}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Form Guide ────────────────────────────────────────────────────────────────
function FormGuide({ stats, games }) {
  return (
    <div className="cockpit-panel">
      <div className="panel-header"><StatusDot color="#00C2FF" /><span>◄ BATTLE RECORD ►</span></div>
      <div className="form-legend">
        {[{ label: 'WIN', color: '#43E97B' }, { label: '2ND', color: '#C0C8D8' }, { label: '3RD', color: '#CD7F32' }, { label: 'LOSS', color: '#FF4040' }].map(l => (
          <span key={l.label} className="form-legend-item">
            <span className="form-sq-mini" style={{ background: l.color + '25', borderColor: l.color, color: l.color }}>{l.label[0]}</span>
            <span style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>{l.label}</span>
          </span>
        ))}
      </div>
      {stats.map(player => {
        const form = formGuide(games, player.id, 8)
        return (
          <div key={player.id} className="form-row">
            <div className="form-player">
              <div className="dot" style={{ background: player.color, boxShadow: `0 0 5px ${player.color}` }} />
              <span className="form-player-name">{player.name}</span>
            </div>
            <div className="form-squares">
              {form.length === 0
                ? <span style={{ color: 'var(--muted2)', fontSize: '0.75rem' }}>no games yet</span>
                : form.map((place, i) => <FormSquare key={i} place={place} />)
              }
            </div>
            <div className="form-pct" style={{ color: player.winRate > 50 ? '#43E97B' : '#FF4040' }}>
              {player.winRate}%
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── H2H Matrix ────────────────────────────────────────────────────────────────
function H2HMatrix({ players, games }) {
  const h2h = useMemo(() => computeH2H(games, players), [games, players])
  if (players.length < 2) return null

  return (
    <div className="cockpit-panel">
      <div className="panel-header"><StatusDot color="#A29BFE" /><span>◄ VS. MODE ►</span></div>
      <div className="h2h-wrap" style={{ overflowX: 'auto' }}>
        <table className="h2h-table">
          <thead>
            <tr>
              <th className="h2h-th h2h-corner" />
              {players.map(p => (
                <th key={p.id} className="h2h-th">
                  <div className="h2h-header-cell">
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                    <span style={{ color: p.color, fontSize: '0.75rem', fontWeight: 700 }}>{p.name.split(' ')[0]}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map(rowP => (
              <tr key={rowP.id}>
                <td className="h2h-row-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: rowP.color }} />
                    <span style={{ color: rowP.color, fontSize: '0.75rem', fontWeight: 700 }}>{rowP.name.split(' ')[0]}</span>
                  </div>
                </td>
                {players.map(colP => {
                  if (rowP.id === colP.id) return <td key={colP.id} className="h2h-td h2h-self">—</td>
                  const key = [rowP.id, colP.id].sort().join('_')
                  const rec = h2h[key]
                  if (!rec || rec.played === 0) return <td key={colP.id} className="h2h-td h2h-none">vs</td>
                  const myWins    = rec[rowP.id] ?? 0
                  const theirWins = rec[colP.id] ?? 0
                  const leading = myWins > theirWins
                  const tied    = myWins === theirWins
                  return (
                    <td key={colP.id} className="h2h-td" style={{
                      color: tied ? 'var(--muted)' : leading ? rowP.color : '#FF4040',
                      fontWeight: 800,
                    }}>
                      {myWins}–{theirWins}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: '0.68rem', color: 'var(--muted2)', marginTop: '0.75rem' }}>
        Wins only. Row player vs column player.
      </div>
    </div>
  )
}

// ── Game Dominance ────────────────────────────────────────────────────────────
function GameDominance({ games, players }) {
  const dom = useMemo(() => gameDominance(games, players), [games, players])
  if (dom.length === 0) return null
  return (
    <div className="cockpit-panel">
      <div className="panel-header"><StatusDot color="#F7971E" /><span>◄ STAGE MASTERS ►</span></div>
      <div className="dom-list">
        {dom.map(({ type, played, champion, wins }) => (
          <div key={type} className="dom-row">
            <div className="dom-game">{type}</div>
            <div className="dom-bar-wrap">
              <div className="dom-bar-track">
                <div className="dom-bar-fill"
                  style={{
                    width: `${played ? (wins / played) * 100 : 0}%`,
                    background: champion?.color ?? 'var(--muted)',
                    boxShadow: champion ? `0 0 8px ${champion.color}66` : 'none'
                  }}
                />
              </div>
            </div>
            {champion ? (
              <div className="dom-champion" style={{ color: champion.color }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: champion.color }} />
                {champion.name} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>({wins}/{played})</span>
              </div>
            ) : (
              <div className="dom-champion" style={{ color: 'var(--muted2)' }}>No winner yet</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Full player cards grid ────────────────────────────────────────────────────
function PlayerCard({ player, rank, games, allStats }) {
  const pts     = useCounter(player.points)
  const form    = useMemo(() => formGuide(games, player.id, 5), [games, player.id])
  const badges  = useMemo(() => getStatBadges(player, allStats), [player, allStats])
  const losses  = useMemo(() => games.filter(g => g.placements.find(p => p.playerId === player.id)?.place === 0).length, [games, player.id])
  const seconds = useMemo(() => games.filter(g => g.placements.find(p => p.playerId === player.id)?.place === 2).length, [games, player.id])
  const thirds  = useMemo(() => games.filter(g => g.placements.find(p => p.playerId === player.id)?.place === 3).length, [games, player.id])

  return (
    <div className="player-cockpit-card" style={{ '--player-color': player.color }}>
      <div className="pcc-top-bar" style={{ background: `linear-gradient(90deg, ${player.color}40, transparent)`, borderColor: player.color + '60' }} />

      <div className="pcc-header">
        <span className="pcc-rank-num" style={{ color: rank === 0 ? '#FFD700' : rank === 1 ? '#C0C8D8' : rank === 2 ? '#CD7F32' : 'var(--muted)' }}>
          {rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `#${rank + 1}`}
        </span>
        <div className="pcc-avatar-wrap">
          <Ring pct={player.winRate} color={player.color} size={54} stroke={4} />
          <div className="pcc-avatar-inner" style={{ background: player.color + '20', borderColor: player.color + '60' }}>
            <span style={{ color: player.color }}>{initials(player.name)}</span>
          </div>
        </div>
        <div className="pcc-name-block">
          <div className="pcc-name">{player.name}</div>
          <div className="pcc-fav">{player.favGame}</div>
        </div>
        <StatusDot color={player.color} />
      </div>

      <div className="pcc-pts-row">
        <div className="pcc-pts-big" style={{ color: player.color, textShadow: `0 0 20px ${player.color}44` }}>{pts}</div>
        <div className="pcc-pts-lbl">PTS</div>
      </div>

      {/* Pts breakdown */}
      {(player.achievementPoints > 0 || player.competitionPoints > 0) && (
        <div className="pcc-pts-breakdown">
          <span style={{ color: player.color }}>{player.competitionPoints} comp</span>
          <span style={{ color: 'var(--muted2)' }}>+</span>
          <span style={{ color: '#FFD700' }}>{player.achievementPoints} ach</span>
        </div>
      )}

      <div className="pcc-breakdown">
        {[
          { label: 'W', val: player.wins, color: '#43E97B' },
          { label: '2nd', val: seconds, color: '#C0C8D8' },
          { label: '3rd', val: thirds, color: '#CD7F32' },
          { label: 'L', val: losses, color: '#FF4040' },
        ].map(s => (
          <div key={s.label} className="pcc-breakdown-cell">
            <div style={{ color: s.color, fontWeight: 800, fontSize: '1.1rem' }}>{s.val}</div>
            <div style={{ color: 'var(--muted2)', fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="pcc-rings-row">
        <div className="pcc-ring-cell">
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <Ring pct={player.winRate} color={player.color} size={52} stroke={4} />
            <div className="pcc-ring-overlay">{player.winRate}%</div>
          </div>
          <div className="pcc-ring-lbl">WIN%</div>
        </div>
        <div className="pcc-ring-cell">
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <Ring pct={player.podiumRate} color="#F7971E" size={52} stroke={4} />
            <div className="pcc-ring-overlay">{player.podiumRate}%</div>
          </div>
          <div className="pcc-ring-lbl">PODIUM%</div>
        </div>
        <div className="pcc-ring-cell">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem' }}>
            {player.streak > 1
              ? <span style={{ fontSize: '1.1rem', color: '#FF6B35', fontWeight: 800 }}>🔥{player.streak}</span>
              : <span style={{ fontSize: '1.1rem', color: 'var(--muted2)', fontWeight: 800 }}>—</span>}
          </div>
          <div className="pcc-ring-lbl">STREAK</div>
        </div>
      </div>

      <div className="pcc-form-row">
        {form.map((place, i) => <FormSquare key={i} place={place} />)}
        {form.length === 0 && <span style={{ fontSize: '0.72rem', color: 'var(--muted2)' }}>no games</span>}
      </div>

      {badges.length > 0 && (
        <div className="pcc-badges">
          {badges.map((b, i) => <Badge key={i} {...b} />)}
        </div>
      )}

      {/* Achievement badges earned in this room */}
      {player.earnedAchs?.length > 0 && (
        <div className="pcc-ach-row">
          {player.earnedAchs.map(a => (
            <span key={a.id} className="rs-ach-badge" title={`${a.name}: ${a.description}`}>
              {a.icon} <span style={{ fontSize: '0.65rem' }}>+{a.pointValue}</span>
            </span>
          ))}
        </div>
      )}

      <div className="pcc-glow-bar" style={{ background: player.color, boxShadow: `0 0 10px ${player.color}` }} />
    </div>
  )
}

// ── Rankings table ────────────────────────────────────────────────────────────
function RankingsTable({ stats }) {
  const max = stats[0]?.points || 1
  return (
    <div className="cockpit-panel">
      <div className="panel-header"><StatusDot color="#7C6FFF" /><span>◄ HIGH SCORES ►</span></div>
      <div className="rankings-header">
        <span>#</span><span>Player</span><span style={{ textAlign: 'center' }}>Pts</span>
        <span style={{ textAlign: 'center' }}>W</span><span style={{ textAlign: 'center' }} className="col-played">GP</span>
        <span>Race</span><span className="col-streak" style={{ textAlign: 'center' }}>Streak</span>
      </div>
      {stats.map((player, i) => (
        <div key={player.id} className="ranking-row">
          <span className={`rank-badge ${i===0?'gold':i===1?'silver':i===2?'bronze':''}`}>
            {i < 3 ? ['🥇','🥈','🥉'][i] : i + 1}
          </span>
          <div className="player-info">
            <div className="dot" style={{ background: player.color, boxShadow: `0 0 6px ${player.color}` }} />
            <div><div className="player-name-sm">{player.name}</div><div className="fav-game">{player.favGame}</div></div>
          </div>
          <span className="stat-cell" style={{ color: player.color, fontWeight: 900 }}>{player.points}</span>
          <span className="stat-cell">{player.wins}</span>
          <span className="stat-cell col-played">{player.played}</span>
          <div className="bar-track" style={{ flex: 1 }}>
            <div className="bar-fill" style={{ width: `${(player.points/max)*100}%`, background: player.color, boxShadow: `0 0 8px ${player.color}88` }} />
          </div>
          <div className="streak-badge col-streak">
            {player.streak > 1 ? <span style={{ color: '#FF6B35' }}>🔥{player.streak}</span>
              : player.streak === 1 ? <span>1</span>
              : <span style={{ color: 'var(--muted2)' }}>—</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Room history ──────────────────────────────────────────────────────────────
function RoomHistory({ games, onDelete }) {
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState(true)

  if (games.length === 0) return null

  const allTypes = [...new Set(games.map(g => g.gameType))].sort()
  const filtered = filter ? games.filter(g => g.gameType === filter) : games

  return (
    <div className="cockpit-panel">
      <div className="panel-header" style={{ cursor: 'pointer' }} onClick={() => setExpanded(v => !v)}>
        <StatusDot color="#FF6B8A" />
        <span>◄ BATTLE LOG ►</span>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: '0.72rem' }}>
          {games.length} game{games.length !== 1 ? 's' : ''} {expanded ? '▲' : '▼'}
        </span>
      </div>

      {expanded && (
        <>
          {allTypes.length > 1 && (
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {['', ...allTypes].map(t => (
                <button key={t} className="btn btn-ghost"
                  style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', ...(filter === t ? { borderColor: 'var(--muted)', color: 'var(--text)' } : {}) }}
                  onClick={() => setFilter(t)}
                >
                  {t || 'All'}
                </button>
              ))}
            </div>
          )}
          <div className="history-list">
            {filtered.map(game => {
              const sorted = [...game.placements].sort((a, b) => {
                if (a.place === 0 && b.place !== 0) return 1
                if (a.place !== 0 && b.place === 0) return -1
                return a.place - b.place
              })
              return (
                <div key={game.id} className="game-row">
                  <span className="game-date">{formatDate(game.date)}</span>
                  <div>
                    <div className="game-type">{game.gameType}</div>
                    <div className="game-placements-inline">
                      {sorted.map(({ playerId, playerName, playerColor, place, points }) => {
                        if (!playerName) return null
                        return (
                          <span key={playerId} className="placement-pill"
                            style={{ color: playerColor, borderColor: playerColor + '40' }}
                          >
                            {PLACE_EMOJI[place]} {playerName}
                            {place > 0 && <span style={{ color: 'var(--muted)', fontWeight: 500 }}> +{points}</span>}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                  <button className="btn btn-danger" onClick={() => onDelete(game.id)} title="Remove">✕</button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Results modal ─────────────────────────────────────────────────────────────
const WINNER_LINES = [
  'Undefeated. Untouchable. Insufferable.',
  'Please hold your applause. Actually, don\'t.',
  'The rest of you were just warming the seat.',
  'Rumour has it they let everyone else win. Rumour is wrong.',
  'Already updating their bio.',
]
const LOSER_LINES = [
  'Better luck next time. And the time after that.',
  'Participation trophy is in the mail. Maybe.',
  'The group chat will remember this.',
  'Not last place in life. Just here.',
  'They tried their best. This was their best.',
]

function ResultsModal({ stats, roomName, onClose }) {
  const winner = stats[0]
  const loser  = stats[stats.length - 1]
  const maxPts = winner?.totalPoints || 1

  const winnerLine = useMemo(() => WINNER_LINES[Math.floor(Math.random() * WINNER_LINES.length)], [])
  const loserLine  = useMemo(() => LOSER_LINES[Math.floor(Math.random() * LOSER_LINES.length)], [])

  return (
    <div className="results-overlay" onClick={onClose}>
      <div className="results-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="results-header">
          <div className="results-title">GAME OVER</div>
          <div className="results-subtitle">{roomName} — Final Standings</div>
          <button className="results-close" onClick={onClose}>✕</button>
        </div>

        {/* Winner hero */}
        {winner && (
          <div className="results-winner" style={{ '--wcolor': winner.color }}>
            <div className="rw-glow" style={{ background: winner.color }} />
            <div className="rw-crown">👑</div>
            <div className="rw-avatar" style={{ background: winner.color + '20', borderColor: winner.color, boxShadow: `0 0 40px ${winner.color}66` }}>
              <span style={{ color: winner.color }}>{initials(winner.name)}</span>
            </div>
            <div className="rw-name" style={{ color: winner.color, textShadow: `0 0 30px ${winner.color}88` }}>{winner.name}</div>
            <div className="rw-title">CHAMPION OF THE NIGHT</div>
            <div className="rw-pts">
              <span style={{ color: winner.color }}>{winner.competitionPoints}</span>
              <span className="rw-pts-sep"> + </span>
              <span style={{ color: '#FFD700' }}>{winner.achievementPoints}</span>
              <span className="rw-pts-total"> = {winner.totalPoints} PTS</span>
            </div>
            <div className="rw-quip">"{winnerLine}"</div>
          </div>
        )}

        {/* Stacked bar chart */}
        <div className="results-chart">
          <div className="results-chart-legend">
            <span className="rc-legend-dot" style={{ background: 'var(--arc-cyan)' }} /> Comp pts
            <span className="rc-legend-dot" style={{ background: '#FFD700', marginLeft: '0.75rem' }} /> Achievement pts
          </div>
          {stats.map((p, i) => {
            const compPct = (p.competitionPoints / maxPts) * 100
            const achPct  = (p.achievementPoints  / maxPts) * 100
            return (
              <div key={p.id} className="rc-row">
                <div className="rc-rank">
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                </div>
                <div className="rc-name" style={{ color: p.color }}>{p.name}</div>
                <div className="rc-bar-wrap">
                  <div className="rc-bar-track">
                    <div className="rc-bar-comp" style={{ width: `${compPct}%`, background: p.color, boxShadow: `0 0 8px ${p.color}66` }} />
                    <div className="rc-bar-ach"  style={{ width: `${achPct}%`,  boxShadow: '0 0 8px rgba(255,215,0,0.5)' }} />
                  </div>
                </div>
                <div className="rc-total" style={{ color: p.color }}>{p.totalPoints}</div>
              </div>
            )
          })}
        </div>

        {/* Loser shame */}
        {stats.length >= 2 && loser.id !== winner.id && (
          <div className="results-loser">
            <span className="rl-badge">💀 HALL OF SHAME</span>
            <span className="rl-name" style={{ color: '#FF4757' }}>{loser.name}</span>
            <span className="rl-pts">{loser.totalPoints} pts</span>
            <span className="rl-quip">"{loserLine}"</span>
          </div>
        )}

        <button className="btn btn-ghost" style={{ width: '100%', marginTop: '0.5rem', fontFamily: "'Courier New', monospace", letterSpacing: '0.08em', fontSize: '0.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={onClose}>
          ► PRESS ANY KEY TO CONTINUE ◄
        </button>
      </div>
    </div>
  )
}

// ── Room selector strip ──────────────────────────────────────────────────────
const STATUS_META = {
  active:    { color: '#43E97B', flag: '🏁', label: 'GREEN FLAG',   arcade: 'GO!',      cls: 'sel-active' },
  upcoming:  { color: '#00C2FF', flag: '🔵', label: 'GEAR UP',      arcade: 'READY',    cls: 'sel-upcoming' },
  completed: { color: '#888',    flag: '🏆', label: 'RACE OVER',    arcade: 'FINISH',   cls: 'sel-completed' },
}
const STATUS_COLORS = { active: '#43E97B', upcoming: '#00C2FF', completed: 'var(--muted)' }
const STATUS_LABELS = { active: '🟢 LIVE', upcoming: 'UPCOMING', completed: 'DONE' }

const STATUS_FILTER_OPTIONS = [
  { value: '',          label: 'ALL' },
  { value: 'active',    label: '🏁 LIVE' },
  { value: 'upcoming',  label: '🔵 READY' },
  { value: 'completed', label: '🏆 DONE' },
]

function RoomSelector({ rooms, selectedId, onSelect, onEdit }) {
  const [search, setSearch]         = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [copiedId, setCopiedId]     = useState(null)

  function handleShare(e, roomId) {
    e.stopPropagation()
    const url = `${window.location.origin}${window.location.pathname}#room/${roomId}`
    navigator.clipboard?.writeText(url).catch(() => {})
    setCopiedId(roomId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const filtered = rooms.filter(r => {
    const matchStatus = !statusFilter || r.status === statusFilter
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  return (
    <div className="room-sel-strip">
      <div className="room-sel-header">
        <div className="room-sel-title">
          <span className="room-sel-arcade-label">INSERT COIN</span>
          <span className="room-sel-subtitle">SELECT COMPETITION</span>
        </div>
        <div className="room-sel-controls">
          <div className="room-sel-status-filters">
            {STATUS_FILTER_OPTIONS.map(o => (
              <button key={o.value}
                className={`room-sel-filter-btn ${statusFilter === o.value ? 'active' : ''}`}
                onClick={() => setStatusFilter(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
          <input
            className="room-sel-search"
            placeholder="🔍 Search rooms…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="room-sel-scroll">
        {filtered.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: '0.8rem', padding: '0.5rem 0' }}>No rooms match</div>
        )}
        {filtered.map(room => {
          const meta = STATUS_META[room.status] ?? STATUS_META.upcoming
          const isSelected = selectedId === room.id
          return (
            <div key={room.id} className={`room-sel-btn ${meta.cls} ${isSelected ? 'active' : ''}`}>
              <div className="room-sel-flag">{meta.flag}</div>
              <div className="room-sel-btn-body">
                <div className="room-sel-name">{room.name}</div>
                <div className="room-sel-date">
                  {new Date(room.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flexShrink: 0 }}>
                <button className="room-sel-action-btn" onClick={() => onSelect(room.id)}>
                  {isSelected ? '▲ VIEWING' : '▼ VIEW'}
                </button>
                <button className="room-sel-action-btn edit" onClick={() => onEdit(room.id)}>
                  ✎ EDIT
                </button>
                <button className="room-sel-action-btn share" onClick={e => handleShare(e, room.id)}>
                  {copiedId === room.id ? '✓ COPIED' : '🔗 SHARE'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Neural Connection Map (Games × Achievements) ──────────────────────────────
function NeuralConnectionMap({ roomGames, games, achievements, stats }) {
  const containerRef   = useRef(null)
  const gameNodeRefs   = useRef({})
  const achNodeRefs    = useRef({})
  const playerNodeRefs = useRef({})
  const [gameLines,   setGameLines]   = useState([])
  const [playerLines, setPlayerLines] = useState([])

  const playerMap  = Object.fromEntries(stats.map(p => [p.id, p]))
  const doneIds    = new Set(games.map(g => g.roomGameId).filter(Boolean))
  const linkedAchs = achievements.filter(a => a.roomGameId)
  const freeAchs   = achievements.filter(a => !a.roomGameId)
  const doneCount  = doneIds.size
  const pct        = roomGames.length ? Math.round((doneCount / roomGames.length) * 100) : 0
  const claimed    = achievements.filter(a => a.earnedByIds.length > 0).length
  const totalPts   = achievements.reduce((s, a) => s + a.pointValue, 0)

  // Players who have earned at least one achievement, sorted by ach pts desc
  const achPlayers = useMemo(() =>
    stats
      .map(p => {
        const earnedAchs = achievements.filter(a => a.earnedByIds.includes(p.id))
        return { ...p, earnedAchs, achPts: earnedAchs.reduce((s, a) => s + a.pointValue, 0) }
      })
      .filter(p => p.earnedAchs.length > 0)
      .sort((a, b) => b.achPts - a.achPts),
  [stats, achievements])

  const orderedAchs = [
    ...roomGames.flatMap(rg => linkedAchs.filter(a => a.roomGameId === rg.id)),
    ...freeAchs,
  ]

  useEffect(() => {
    function measure() {
      const container = containerRef.current
      if (!container) return
      const cr = container.getBoundingClientRect()

      // Game → Achievement lines
      const newGameLines = []
      achievements.forEach(ach => {
        if (!ach.roomGameId) return
        const gEl = gameNodeRefs.current[ach.roomGameId]
        const aEl = achNodeRefs.current[ach.id]
        if (!gEl || !aEl) return
        const gr = gEl.getBoundingClientRect()
        const ar = aEl.getBoundingClientRect()
        newGameLines.push({
          id:      ach.id,
          x1:      gr.right - cr.left,
          y1:      gr.top   + gr.height / 2 - cr.top,
          x2:      ar.left  - cr.left,
          y2:      ar.top   + ar.height / 2 - cr.top,
          claimed: ach.earnedByIds.length > 0,
          pts:     ach.pointValue,
        })
      })
      setGameLines(newGameLines)

      // Achievement → Player lines (only claimed)
      const newPlayerLines = []
      achievements.forEach(ach => {
        if (!ach.earnedByIds.length) return
        const aEl = achNodeRefs.current[ach.id]
        if (!aEl) return
        const ar = aEl.getBoundingClientRect()
        ach.earnedByIds.forEach(pid => {
          const pEl = playerNodeRefs.current[pid]
          if (!pEl) return
          const pr = pEl.getBoundingClientRect()
          newPlayerLines.push({
            id:    `${ach.id}__${pid}`,
            achId: ach.id,
            pid,
            color: playerMap[pid]?.color || '#FFD700',
            pts:   ach.pointValue,
            x1:    ar.right - cr.left,
            y1:    ar.top   + ar.height / 2 - cr.top,
            x2:    pr.left  - cr.left,
            y2:    pr.top   + pr.height / 2 - cr.top,
          })
        })
      })
      setPlayerLines(newPlayerLines)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [roomGames, achievements, games, stats])

  const totalLinks = gameLines.length + playerLines.length
  const maxPts = Math.max(1, ...achievements.map(a => Math.max(1, a.pointValue)))

  return (
    <div className="neural-map" ref={containerRef}>
      {/* HUD corner brackets */}
      <div className="neural-corner tl" /><div className="neural-corner tr" />
      <div className="neural-corner bl" /><div className="neural-corner br" />

      {/* SVG connection layer */}
      <svg className="neural-svg">
        <defs>
          <filter id="bloom-strong" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="blur1" />
            <feGaussianBlur stdDeviation="8" result="blur2" in="SourceGraphic" />
            <feMerge>
              <feMergeNode in="blur2" />
              <feMergeNode in="blur1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="bloom-soft" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="particle-cyan" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#00E5FF" stopOpacity="1" />
            <stop offset="100%" stopColor="#00E5FF" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="particle-gold" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#FFD700" stopOpacity="1" />
            <stop offset="100%" stopColor="#FFD700" stopOpacity="0" />
          </radialGradient>
          {/* Per-player particle gradients */}
          {achPlayers.map(p => (
            <radialGradient key={p.id} id={`pp-${p.id.replace(/-/g,'')}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor={p.color} stopOpacity="1" />
              <stop offset="100%" stopColor={p.color} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>

        {/* ── Game → Achievement ── */}
        {gameLines.map((l, idx) => {
          const w        = Math.min(1, Math.max(0, l.pts) / maxPts)  // 0–1 weight
          const cpx      = Math.max(90, Math.abs(l.y2 - l.y1) * 0.65)
          const pathD    = `M ${l.x1} ${l.y1} C ${l.x1 + cpx} ${l.y1}, ${l.x2 - cpx} ${l.y2}, ${l.x2} ${l.y2}`
          const pathId   = `np-${l.id.replace(/-/g,'')}`
          const color    = l.claimed ? '#FFD700' : '#00E5FF'
          const sw       = l.claimed ? 1.5 + w * 2 : 1 + w * 1.5
          const durNum   = l.claimed ? 1.1 - w * 0.4 : 2.2 - w * 1.2
          const dur      = `${durNum.toFixed(2)}s`
          const pr       = 3 + w * 3   // particle glow radius
          const d0       = (idx * 0.31) % 1.5
          const delay    = `${d0}s`
          const trailDel = `${d0 - durNum * 0.45}s`
          return (
            <g key={l.id}>
              <path d={pathD} fill="none" stroke={color} strokeWidth={8 + w * 6}
                opacity={l.claimed ? 0.06 + w * 0.08 : 0.04 + w * 0.06} filter="url(#bloom-strong)" />
              <path d={pathD} fill="none" stroke={color} strokeWidth={3 + w * 2}
                opacity={l.claimed ? 0.15 + w * 0.15 : 0.08 + w * 0.1} filter="url(#bloom-soft)" />
              <path id={pathId} d={pathD} fill="none" stroke={color}
                strokeWidth={sw} opacity={l.claimed ? 0.85 + w * 0.1 : 0.4 + w * 0.3}
                strokeDasharray="8 5"
                className={l.claimed ? 'neural-line claimed' : 'neural-line'} />
              <circle r={pr} fill={`url(#particle-${l.claimed ? 'gold' : 'cyan'})`} filter="url(#bloom-soft)">
                <animateMotion dur={dur} repeatCount="indefinite" begin={delay}><mpath href={`#${pathId}`} /></animateMotion>
              </circle>
              <circle r={1.5 + w * 1.5} fill={color} opacity="0.95">
                <animateMotion dur={dur} repeatCount="indefinite" begin={delay}><mpath href={`#${pathId}`} /></animateMotion>
              </circle>
              <circle r={pr * 0.65} fill={`url(#particle-${l.claimed ? 'gold' : 'cyan'})`} opacity="0.7">
                <animateMotion dur={dur} repeatCount="indefinite" begin={trailDel}><mpath href={`#${pathId}`} /></animateMotion>
              </circle>
              <circle cx={l.x1} cy={l.y1} r={2 + w * 2} fill={color} opacity="0.7" filter="url(#bloom-soft)" />
              <circle cx={l.x2} cy={l.y2} r={3 + w * 3} fill={color} opacity={l.claimed ? 1 : 0.65} filter="url(#bloom-strong)" />
            </g>
          )
        })}

        {/* ── Achievement → Player ── */}
        {playerLines.map((l, idx) => {
          const w        = Math.min(1, Math.max(0, l.pts) / maxPts)
          const cpx      = Math.max(90, Math.abs(l.y2 - l.y1) * 0.65)
          const pathD    = `M ${l.x1} ${l.y1} C ${l.x1 + cpx} ${l.y1}, ${l.x2 - cpx} ${l.y2}, ${l.x2} ${l.y2}`
          const pathId   = `pp-path-${l.id.replace(/[-_]/g,'')}`
          const gradId   = `url(#pp-${l.pid.replace(/-/g,'')})`
          const sw       = 1.5 + w * 2.5
          const durNum   = 1.3 - w * 0.6
          const dur      = `${durNum.toFixed(2)}s`
          const pr       = 3 + w * 4
          const d0       = (idx * 0.28) % 1.4
          const delay    = `${d0}s`
          const trailDel = `${d0 - durNum * 0.45}s`
          return (
            <g key={l.id}>
              <path d={pathD} fill="none" stroke={l.color} strokeWidth={8 + w * 8}
                opacity={0.05 + w * 0.1} filter="url(#bloom-strong)" />
              <path d={pathD} fill="none" stroke={l.color} strokeWidth={3 + w * 2}
                opacity={0.12 + w * 0.18} filter="url(#bloom-soft)" />
              <path id={pathId} d={pathD} fill="none" stroke={l.color}
                strokeWidth={sw} opacity={0.85 + w * 0.12} strokeDasharray="6 4"
                className="neural-line claimed" />
              <circle r={pr} fill={gradId} filter="url(#bloom-soft)">
                <animateMotion dur={dur} repeatCount="indefinite" begin={delay}><mpath href={`#${pathId}`} /></animateMotion>
              </circle>
              <circle r={1.5 + w * 2} fill={l.color} opacity="0.95">
                <animateMotion dur={dur} repeatCount="indefinite" begin={delay}><mpath href={`#${pathId}`} /></animateMotion>
              </circle>
              <circle r={pr * 0.6} fill={gradId} opacity="0.65">
                <animateMotion dur={dur} repeatCount="indefinite" begin={trailDel}><mpath href={`#${pathId}`} /></animateMotion>
              </circle>
              <circle cx={l.x1} cy={l.y1} r={2 + w * 2} fill={l.color} opacity="0.8" filter="url(#bloom-soft)" />
              <circle cx={l.x2} cy={l.y2} r={4 + w * 3} fill={l.color} opacity="1" filter="url(#bloom-strong)" />
            </g>
          )
        })}
      </svg>

      {/* Full-width header */}
      <div className="neural-header">
        <div className="neural-header-left">
          <span className="neural-header-label">◈ GAME SCHEDULE</span>
          <span className="neural-stat-pill">{doneCount}/{roomGames.length} COMPLETE</span>
        </div>
        <div className="neural-header-mid">
          <span className="neural-title-main">SYNAPTIC LINK MATRIX</span>
          {totalLinks > 0 && (
            <span className="neural-title-sub">{totalLinks} LINK{totalLinks !== 1 ? 'S' : ''} ACTIVE</span>
          )}
        </div>
        <div className="neural-header-right">
          <span className="neural-stat-pill gold">{claimed}/{achievements.length} CLAIMED</span>
          <span className="neural-header-label" style={{ textAlign: 'right' }}>PLAYERS ◈</span>
        </div>
      </div>

      {/* Col 1 — games */}
      <div className="neural-col neural-col-games">
        {roomGames.length === 0 ? (
          <div className="neural-empty">NO EVENTS QUEUED</div>
        ) : (
          <>
            {roomGames.map(rg => {
              const done   = doneIds.has(rg.id)
              const linked = linkedAchs.filter(a => a.roomGameId === rg.id).length
              return (
                <div key={rg.id} ref={el => gameNodeRefs.current[rg.id] = el}
                  className={`neural-node game-node ${done ? 'done' : 'pending'}`}>
                  <span className="nn-order">#{rg.order}</span>
                  <span className="nn-name">{rg.name}</span>
                  {linked > 0 && <span className="nn-link-count">⚡{linked}</span>}
                  <span className={`nn-status ${done ? 'done' : ''}`}>{done ? '✓' : '○'}</span>
                  <div className={`nn-connector right ${linked > 0 ? 'active' : ''}`} />
                </div>
              )
            })}
            <div className="neural-progress">
              <span className={pct === 100 ? 'neural-progress-done' : ''}>{doneCount}/{roomGames.length}</span>
              <div className="np-track"><div className="np-fill" style={{ width: `${pct}%` }} /></div>
              <span className={pct === 100 ? 'neural-progress-done' : 'neural-progress-pct'}>{pct}%</span>
            </div>
          </>
        )}
      </div>

      {/* Gap 1 */}
      <div className="neural-gap" />

      {/* Col 2 — achievements */}
      <div className="neural-col neural-col-achs">
        {achievements.length === 0 ? (
          <div className="neural-empty">NO ACHIEVEMENTS SET</div>
        ) : (
          <>
            {orderedAchs.map(a => {
              const earner = a.earnedByIds[0] ? playerMap[a.earnedByIds[0]] : null
              const isFree = !a.roomGameId
              return (
                <div key={a.id} ref={el => achNodeRefs.current[a.id] = el}
                  className={`neural-node ach-node ${earner ? 'claimed' : ''} ${isFree ? 'free' : ''}`}
                  style={earner ? { '--earner-color': earner.color } : undefined}>
                  {!isFree && <div className={`nn-connector left ${earner ? 'claimed' : 'active'}`} />}
                  <span className="nn-icon">{a.icon}</span>
                  <div className="nn-ach-text">
                    <div className="nn-name">{a.name}</div>
                    {earner
                      ? <div className="nn-earner" style={{ color: earner.color }}>🏅 {earner.name}</div>
                      : <div className="nn-earner nn-unclaimed">unclaimed</div>}
                  </div>
                  <span className="nn-pts" style={a.pointValue < 0 ? { color: '#FF6B8A' } : undefined}>
                    {a.pointValue > 0 ? '+' : ''}{a.pointValue}
                  </span>
                  {earner && <div className="nn-connector right claimed" />}
                </div>
              )
            })}
            {freeAchs.length > 0 && linkedAchs.length > 0 && (
              <div className="neural-free-label">── general ──</div>
            )}
            <div className="neural-ach-summary">
              <span>{achievements.length - claimed} up for grabs</span>
              <span className="neural-pts-total">{totalPts} pts</span>
            </div>
          </>
        )}
      </div>

      {/* Gap 2 */}
      <div className="neural-gap neural-gap-2" />

      {/* Col 3 — players */}
      <div className="neural-col neural-col-players">
        {achPlayers.length === 0 ? (
          <div className="neural-empty" style={{ fontSize: '0.6rem' }}>NO ACHIEVEMENTS<br />EARNED YET</div>
        ) : (
          achPlayers.map(p => (
            <div key={p.id} ref={el => playerNodeRefs.current[p.id] = el}
              className="neural-node player-node">
              <div className="nn-connector left" style={{ borderColor: p.color, boxShadow: `0 0 6px ${p.color}bb` }} />
              <div className="nn-player-avatar" style={{ background: p.color + '22', color: p.color, borderColor: p.color + '55' }}>
                {initials(p.name)}
              </div>
              <div className="nn-ach-text">
                <div className="nn-name">{p.name}</div>
                <div className="nn-earner" style={{ color: p.color }}>
                  {p.earnedAchs.length} ach · +{p.achPts}pts
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function Dashboard({ onRoomOpen }) {
  const [rooms, setRooms]               = useState([])
  const [selectedRoomId, setSelectedRoomId] = useState(() => localStorage.getItem(LAST_ROOM_KEY) ?? null)
  const [stats, setStats]               = useState([])
  const [games, setGames]               = useState([])
  const [roomGames, setRoomGames]       = useState([])
  const [achievements, setAchievements] = useState([])
  const [showResults, setShowResults]   = useState(false)

  function selectRoom(id) {
    setSelectedRoomId(id)
    if (id) localStorage.setItem(LAST_ROOM_KEY, id)
  }

  async function refresh() {
    const r = await getRooms()
    setRooms(r)
    setSelectedRoomId(prev => {
      if (prev && r.some(x => x.id === prev)) return prev
      const auto = r.find(x => x.status === 'active') ?? r.find(x => x.status === 'upcoming') ?? r[0]
      const next = auto?.id ?? null
      if (next) localStorage.setItem(LAST_ROOM_KEY, next)
      return next
    })
  }

  async function refreshRoomData(roomId) {
    if (!roomId) { setStats([]); setGames([]); setRoomGames([]); setAchievements([]); return }
    const [s, allGames, rg, achs] = await Promise.all([
      getRoomStats(roomId),
      getGames(),
      getRoomGames(roomId).catch(() => []),
      getAchievements(roomId).catch(() => []),
    ])
    setStats(s)
    setGames(allGames.filter(g => g.roomId === roomId).sort((a, b) => new Date(b.date) - new Date(a.date)))
    setRoomGames(rg)
    setAchievements(achs)
  }

  async function handleDeleteGame(id) {
    await deleteGame(id)
    refreshRoomData(selectedRoomId)
  }

  useEffect(() => { refresh() }, [])
  useEffect(() => { refreshRoomData(selectedRoomId) }, [selectedRoomId])

  const selectedRoom = rooms.find(r => r.id === selectedRoomId) ?? null
  const roomPlayers  = useMemo(() => stats.map(s => ({ id: s.id, name: s.name, color: s.color })), [stats])

  const champion  = stats[0]
  const chump     = stats[stats.length - 1]
  const showChump = stats.length >= 2 && chump?.id !== champion?.id

  if (rooms.length === 0) {
    return (
      <div className="cockpit">
        <div className="cockpit-grid-bg" />
        <div className="cockpit-panel" style={{ padding: '3.5rem 2rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem', filter: 'drop-shadow(0 0 20px rgba(0,229,255,0.5))' }}>🕹️</div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: '1.3rem', fontWeight: 900, letterSpacing: '0.2em', color: 'var(--arc-cyan)', textShadow: '0 0 14px rgba(0,229,255,0.8)', marginBottom: '0.5rem' }}>GAME NOT FOUND</div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.18em', color: 'var(--arc-yellow)', textShadow: '0 0 10px rgba(255,230,0,0.7)', animation: 'blink 1.2s step-end infinite', marginBottom: '1rem' }}>► INSERT COIN TO START ◄</div>
          <div style={{ color: 'var(--muted)', fontSize: '0.82rem', fontFamily: "'Courier New', monospace" }}>Create a room in the Rooms tab.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="cockpit">
      <div className="cockpit-grid-bg" />

      {showResults && stats.length > 0 && (
        <ResultsModal stats={stats} roomName={selectedRoom?.name ?? ''} onClose={() => setShowResults(false)} />
      )}

      <RoomSelector rooms={rooms} selectedId={selectedRoomId} onSelect={selectRoom} onEdit={onRoomOpen} />

      {selectedRoom && (
        <div className="dashboard-room-header">
          <div style={{ flex: 1 }}>
            <div className="drh-name">{selectedRoom.name}</div>
            <div className="drh-date">
              {new Date(selectedRoom.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
            <div className="drh-status" style={{ color: STATUS_COLORS[selectedRoom.status] }}>
              {STATUS_LABELS[selectedRoom.status]}
            </div>
          </div>
          {stats.length > 0 && (
            <button className="btn-results-trigger" onClick={() => setShowResults(true)}>
              <span className="brt-icon">🏁</span>
              <span className="brt-text">FINAL<br/>RESULTS</span>
            </button>
          )}
        </div>
      )}

      <NeuralConnectionMap roomGames={roomGames} games={games} achievements={achievements} stats={stats} />

      {games.length > 0 && <ActivityTicker games={games} />}

      {champion
        ? <ChampionPanel champion={champion} runner_up={stats[1]} stats={stats} games={games} />
        : <div className="cockpit-panel" style={{ padding: '2.5rem 2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem', filter: 'drop-shadow(0 0 10px rgba(0,229,255,0.4))' }}>🎮</div>
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: '0.9rem', fontWeight: 900, letterSpacing: '0.16em', color: 'var(--arc-cyan)', textShadow: '0 0 10px rgba(0,229,255,0.6)', marginBottom: '0.4rem' }}>NO DATA YET</div>
            <div style={{ color: 'var(--muted)', fontSize: '0.8rem', fontFamily: "'Courier New', monospace" }}>Head to Rooms → Schedule to log results.</div>
          </div>
      }

      {showChump && <ChumpPanel chump={chump} champion={champion} games={games} />}

      {stats.length > 0 && (
        <div className="dual-panel">
          <FormGuide stats={stats} games={games} />
          <PointsRace stats={stats} />
        </div>
      )}

      {stats.length > 0 && (
        <div className="player-cards-grid">
          {stats.map((p, i) => (
            <PlayerCard key={p.id} player={p} rank={i} games={games} allStats={stats} />
          ))}
        </div>
      )}

      {stats.length > 0 && (
        <div className="dual-panel">
          <GameDominance games={games} players={roomPlayers} />
          <H2HMatrix players={roomPlayers} games={games} />
        </div>
      )}

      {stats.length > 0 && <RankingsTable stats={stats} />}

      <RoomHistory games={games} onDelete={handleDeleteGame} />
    </div>
  )
}
