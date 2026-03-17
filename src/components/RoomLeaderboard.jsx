import { useEffect, useState } from 'react'
import { getRoomStats, getAchievements } from '../db/mockDb'

function initials(n) { return n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) }

function useCounter(target, duration = 1000) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    let start = performance.now()
    function step(now) {
      const t = Math.min((now - start) / duration, 1)
      const e = 1 - Math.pow(1 - t, 3)
      setVal(Math.round(e * target))
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [target])
  return val
}

function Ring({ pct, color, size = 48, stroke = 4 }) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const fill = (Math.min(pct, 100) / 100) * circ
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.34,1.56,0.64,1)', filter: `drop-shadow(0 0 4px ${color}88)` }}
      />
    </svg>
  )
}

function PlayerRow({ player, rank, maxTotal, achievements }) {
  const totalPts = useCounter(player.totalPoints)
  const compPts  = useCounter(player.competitionPoints)
  const achPts   = useCounter(player.achievementPoints)
  const compPct  = maxTotal ? (player.competitionPoints / maxTotal) * 100 : 0
  const achPct   = maxTotal ? (player.achievementPoints / maxTotal) * 100 : 0
  const medals   = ['🥇', '🥈', '🥉']

  return (
    <div className={`room-standings-row ${rank === 0 ? 'rank-first' : ''}`}>
      <div className="rs-rank">{rank < 3 ? medals[rank] : rank + 1}</div>

      <div className="rs-player">
        <div className="rs-avatar-wrap">
          <Ring pct={player.winRate} color={player.color} size={44} stroke={3} />
          <div className="rs-avatar" style={{ background: player.color + '20', color: player.color }}>
            {initials(player.name)}
          </div>
        </div>
        <div>
          <div className="rs-name">{player.name}</div>
          <div className="rs-meta">{player.wins}W · {player.played}GP · {player.winRate}% wr</div>
        </div>
      </div>

      {/* Points breakdown bar */}
      <div className="rs-pts-block">
        <div className="rs-pts-bar-wrap">
          <div className="rs-pts-bar-track">
            <div className="rs-pts-seg comp" style={{ width: `${compPct}%`, background: player.color, boxShadow: `0 0 8px ${player.color}66` }} />
            <div className="rs-pts-seg ach"  style={{ width: `${achPct}%`,  background: '#FFD700', boxShadow: '0 0 8px #FFD70066' }} />
          </div>
        </div>
        <div className="rs-pts-numbers">
          <span className="rs-pts-comp" style={{ color: player.color }}>{compPts}</span>
          <span className="rs-pts-sep">+</span>
          <span className="rs-pts-ach">{achPts}</span>
          <span className="rs-pts-eq">=</span>
          <span className="rs-pts-total">{totalPts}</span>
        </div>
        <div className="rs-pts-labels">
          <span>🎮 Comp</span>
          <span>+</span>
          <span>🏅 Ach</span>
          <span>=</span>
          <span>Total</span>
        </div>
      </div>

      {/* Earned achievements */}
      {player.earnedAchs?.length > 0 && (
        <div className="rs-badges">
          {player.earnedAchs.map(a => (
            <span key={a.id} className="rs-ach-badge" title={`${a.name}: ${a.description}`}>
              {a.icon} <span style={{ fontSize: '0.65rem' }}>+{a.pointValue}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function RoomLeaderboard({ room }) {
  const [stats, setStats]     = useState([])
  const [achs, setAchs]       = useState([])

  useEffect(() => {
    Promise.all([getRoomStats(room.id), getAchievements(room.id)]).then(([s, a]) => {
      setStats(s); setAchs(a)
    })
  }, [room.id])

  if (stats.length === 0) return <div className="empty">No results logged yet.</div>

  const maxTotal   = stats[0]?.totalPoints || 1
  const totalComp  = stats.reduce((s, p) => s + p.competitionPoints, 0)
  const totalAch   = stats.reduce((s, p) => s + p.achievementPoints, 0)
  const achMap     = Object.fromEntries(achs.map(a => [a.id, a]))

  return (
    <div>
      {/* Summary bar */}
      <div className="rs-summary">
        <div className="rs-sum-cell">
          <div className="rs-sum-val">{stats.reduce((s, p) => s + p.played, 0)}</div>
          <div className="rs-sum-lbl">Games Played</div>
        </div>
        <div className="rs-sum-cell">
          <div className="rs-sum-val" style={{ color: stats[0]?.color }}>{stats[0]?.totalPoints ?? 0}</div>
          <div className="rs-sum-lbl">Leader Points</div>
        </div>
        <div className="rs-sum-cell">
          <div className="rs-sum-val">{totalComp}</div>
          <div className="rs-sum-lbl">🎮 Comp Pts</div>
        </div>
        <div className="rs-sum-cell">
          <div className="rs-sum-val" style={{ color: '#FFD700' }}>{totalAch}</div>
          <div className="rs-sum-lbl">🏅 Ach Pts</div>
        </div>
        <div className="rs-sum-cell">
          <div className="rs-sum-val">{achs.filter(a => a.earnedByIds.length > 0).length}/{achs.length}</div>
          <div className="rs-sum-lbl">Achievements</div>
        </div>
      </div>

      <div className="rs-legend">
        <span style={{ color: 'var(--muted)', fontSize: '0.68rem' }}>Bar: </span>
        <span className="rs-legend-comp">🎮 Competition pts</span>
        <span style={{ color: 'var(--muted)' }}> + </span>
        <span className="rs-legend-ach">🏅 Achievement pts</span>
      </div>

      <div className="room-standings-list">
        {stats.map((player, i) => (
          <PlayerRow key={player.id} player={player} rank={i} maxTotal={maxTotal} achievements={achs} />
        ))}
      </div>
    </div>
  )
}
