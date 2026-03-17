import { useEffect, useState, useRef, useMemo } from 'react'
import { getRoomStats, getRooms, getPlayers, getGames, addPlayer, removePlayer, POINTS } from '../db/mockDb'

const PALETTE = ['#7C6FFF', '#FF6B8A', '#43E97B', '#F7971E', '#00C2FF', '#FF9F43', '#A29BFE', '#FD79A8']

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

function getStatBadges(player, allStats, games) {
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
function ActivityTicker({ games, playerMap }) {
  if (games.length === 0) return null
  const items = games.slice(0, 15)
  return (
    <div className="ticker-wrap">
      <span className="ticker-label">LIVE</span>
      <div className="ticker-track">
        <div className="ticker-inner">
          {[...items, ...items].map((g, i) => {
            const w = g.placements.find(p => p.place === 1)
            const wp = w ? playerMap[w.playerId] : null
            return (
              <span key={i} className="ticker-item">
                <span style={{ color: wp?.color ?? 'var(--text)' }}>🏆 {wp?.name ?? '?'}</span>
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
  const badges = useMemo(() => getStatBadges(champion, stats, games), [champion, stats, games])

  return (
    <div className="champion-panel">
      <Sparks color={champion.color} />
      <div className="champion-glow" style={{ background: champion.color }} />
      <div className="champion-glow champion-glow-2" style={{ background: champion.color }} />

      <div className="champ-header-row">
        <div className="champ-header-badge">
          <StatusDot color={champion.color} />
          COMPETITION LEADER
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
            <div className="cs-lbl">TOTAL POINTS</div>
          </div>
          <div className="cs-big">
            <div className="cs-val">{wins}</div>
            <div className="cs-lbl">🏆 WINS</div>
          </div>
          <div className="cs-big">
            <div className="cs-val">{champion.podiums}</div>
            <div className="cs-lbl">🥉 PODIUMS</div>
          </div>
          <div className="cs-big">
            <div className="cs-val">{champion.played}</div>
            <div className="cs-lbl">GAMES PLAYED</div>
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
            <div className="cs-lbl" style={{ marginBottom: '0.35rem' }}>FAV BATTLEGROUND</div>
            <div style={{ fontSize: '1rem', fontWeight: 800 }}>{champion.favGame}</div>
          </div>

          <div className="cs-wide">
            <div className="cs-lbl" style={{ marginBottom: '0.35rem' }}>CURRENT STREAK</div>
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
            <div className="chump-stat-lbl">💀 LOSSES</div>
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
      <div className="panel-header"><StatusDot color="#FFD700" /><span>POINTS RACE</span></div>
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
      <div className="panel-header"><StatusDot color="#00C2FF" /><span>RECENT FORM (LAST 8)</span></div>
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
      <div className="panel-header"><StatusDot color="#A29BFE" /><span>HEAD TO HEAD</span></div>
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
      <div className="panel-header"><StatusDot color="#F7971E" /><span>GAME DOMINANCE</span></div>
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
  const badges  = useMemo(() => getStatBadges(player, allStats, games), [player, allStats, games])
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
      <div className="panel-header"><StatusDot color="#7C6FFF" /><span>FULL STANDINGS</span></div>
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

// ── Players manager ───────────────────────────────────────────────────────────
function PlayersManager({ onToast, onRefresh }) {
  const [players, setPlayers] = useState([])
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PALETTE[0])
  const [open, setOpen] = useState(false)

  async function refresh() { setPlayers(await getPlayers()) }
  useEffect(() => { refresh() }, [])

  async function handleAdd(e) {
    e.preventDefault()
    if (!newName.trim()) return
    await addPlayer(newName.trim(), newColor)
    setNewName(''); onToast(`${newName.trim()} added!`)
    refresh(); onRefresh()
  }
  async function handleRemove(id, name) {
    await removePlayer(id); onToast(`${name} removed`); refresh(); onRefresh()
  }

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={() => setOpen(v => !v)}>
        {open ? '▲' : '▼'} Manage Players ({players.length})
      </button>
      {open && (
        <div className="card" style={{ marginTop: '0.75rem' }}>
          <div className="section-title">Players</div>
          <div className="players-grid">
            {players.map(p => (
              <div key={p.id} className="player-card">
                <button className="player-card-del" onClick={() => handleRemove(p.id, p.name)}>✕</button>
                <div className="player-card-avatar" style={{ background: p.color + '28' }}>
                  <span style={{ color: p.color }}>{initials(p.name)}</span>
                </div>
                <div className="player-card-name">{p.name}</div>
              </div>
            ))}
          </div>
          <div className="divider" />
          <div className="section-title">Add Player</div>
          <form onSubmit={handleAdd} className="add-player-form">
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <input className="input" placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div className="field">
              <div className="color-swatches">
                {PALETTE.map(c => (
                  <div key={c} className={`swatch ${newColor === c ? 'selected' : ''}`}
                    style={{ background: c }} onClick={() => setNewColor(c)} />
                ))}
              </div>
            </div>
            <button className="btn btn-primary" type="submit">Add</button>
          </form>
        </div>
      )}
    </div>
  )
}

// ── Room selector strip ───────────────────────────────────────────────────────
const STATUS_COLORS = { active: '#43E97B', upcoming: '#00C2FF', completed: 'var(--muted)' }
const STATUS_LABELS = { active: '🟢 LIVE', upcoming: 'UPCOMING', completed: 'DONE' }

function RoomSelector({ rooms, selectedId, onSelect }) {
  return (
    <div className="room-sel-strip">
      <div className="room-sel-label">SELECT COMPETITION</div>
      <div className="room-sel-scroll">
        {rooms.map(room => (
          <button
            key={room.id}
            className={`room-sel-btn ${selectedId === room.id ? 'active' : ''}`}
            onClick={() => onSelect(room.id)}
          >
            <div className="room-sel-name">{room.name}</div>
            <div className="room-sel-status" style={{ color: STATUS_COLORS[room.status] ?? 'var(--muted)' }}>
              {STATUS_LABELS[room.status] ?? 'UPCOMING'}
            </div>
            <div className="room-sel-date">
              {new Date(room.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function Dashboard({ onToast, onRefresh }) {
  const [rooms, setRooms]               = useState([])
  const [selectedRoomId, setSelectedRoomId] = useState(null)
  const [stats, setStats]               = useState([])
  const [games, setGames]               = useState([])
  const [players, setPlayers]           = useState([])

  async function refresh() {
    const [r, p] = await Promise.all([getRooms(), getPlayers()])
    setRooms(r)
    setPlayers(p)
    setSelectedRoomId(prev => {
      if (prev && r.some(x => x.id === prev)) return prev
      const auto = r.find(x => x.status === 'active') ?? r.find(x => x.status === 'upcoming') ?? r[0]
      return auto?.id ?? null
    })
  }

  async function refreshRoomData(roomId) {
    if (!roomId) { setStats([]); setGames([]); return }
    const [s, allGames] = await Promise.all([getRoomStats(roomId), getGames()])
    setStats(s)
    setGames(allGames.filter(g => g.roomId === roomId).sort((a, b) => new Date(b.date) - new Date(a.date)))
  }

  useEffect(() => { refresh() }, [])
  useEffect(() => { refreshRoomData(selectedRoomId) }, [selectedRoomId])

  const selectedRoom = rooms.find(r => r.id === selectedRoomId) ?? null
  const playerMap    = useMemo(() => Object.fromEntries(players.map(p => [p.id, p])), [players])
  const roomPlayers  = useMemo(() => players.filter(p => selectedRoom?.invitedPlayerIds.includes(p.id)), [players, selectedRoom])

  const champion  = stats[0]
  const chump     = stats[stats.length - 1]
  const showChump = stats.length >= 2 && chump?.id !== champion?.id

  if (rooms.length === 0) {
    return (
      <div className="cockpit">
        <div className="cockpit-grid-bg" />
        <div className="empty cockpit-panel" style={{ padding: '3rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🏟️</div>
          <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>No competitions yet</div>
          <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Create a room in the Rooms tab to get started.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="cockpit">
      <div className="cockpit-grid-bg" />

      <RoomSelector rooms={rooms} selectedId={selectedRoomId} onSelect={setSelectedRoomId} />

      {selectedRoom && (
        <div className="dashboard-room-header">
          <div className="drh-name">{selectedRoom.name}</div>
          <div className="drh-date">
            {new Date(selectedRoom.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
          <div className="drh-status" style={{ color: STATUS_COLORS[selectedRoom.status] }}>
            {STATUS_LABELS[selectedRoom.status]}
          </div>
        </div>
      )}

      {games.length > 0 && <ActivityTicker games={games} playerMap={playerMap} />}

      {champion
        ? <ChampionPanel champion={champion} runner_up={stats[1]} stats={stats} games={games} />
        : <div className="empty cockpit-panel" style={{ padding: '2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🎮</div>
            <div>No results logged for this competition yet.</div>
            <div style={{ color: 'var(--muted)', fontSize: '0.82rem', marginTop: '0.25rem' }}>Head to Rooms → Schedule to log game results.</div>
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

      <PlayersManager onToast={onToast} onRefresh={() => { refresh(); refreshRoomData(selectedRoomId) }} />
    </div>
  )
}
