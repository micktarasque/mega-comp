import { useEffect, useState } from 'react'
import { getRoom, getPlayers, getGames, getRoomGames, getAchievements, updateRoom, isRoomVerified } from '../db/mockDb'
import RoomSchedule from './RoomSchedule'
import AchievementManager from './AchievementManager'
import RoomLeaderboard from './RoomLeaderboard'
import CodeModal from './CodeModal'

const SUBTABS = [
  { id: 'overview',      label: 'Overview' },
  { id: 'schedule',      label: 'Schedule' },
  { id: 'achievements',  label: 'Achievements' },
  { id: 'standings',     label: 'Standings' },
]

const STATUS_META = {
  upcoming:  { label: 'UPCOMING', cls: 'status-upcoming' },
  active:    { label: '🟢 LIVE',  cls: 'status-active' },
  completed: { label: 'DONE',     cls: 'status-completed' },
}

function initials(n) { return n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) }

function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function RoomOverview({ room, players, games, roomGames, achievements, onEdited, verified, onNeedCode }) {
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState({ name: room.name, description: room.description, date: room.date, status: room.status })

  const playerMap   = Object.fromEntries(players.map(p => [p.id, p]))
  const roomPlayers = players.filter(p => room.invitedPlayerIds.includes(p.id))
  const gamesCount  = games.filter(g => g.roomId === room.id).length
  const achAwarded  = achievements.filter(a => a.earnedByIds.length > 0).length
  const totalPtsInPlay = achievements.reduce((s, a) => s + a.pointValue * a.earnedByIds.length, 0)

  async function handleSave(e) {
    e.preventDefault()
    await updateRoom(room.id, editData)
    setEditing(false); onEdited()
  }

  return (
    <div>
      {editing ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="section-title">Edit Room</div>
          <form className="form-grid" onSubmit={handleSave}>
            <div className="field">
              <label className="label">Room Name</label>
              <input className="input" value={editData.name} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div className="field">
                <label className="label">Date</label>
                <input type="date" className="input" value={editData.date} onChange={e => setEditData(d => ({ ...d, date: e.target.value }))} />
              </div>
              <div className="field">
                <label className="label">Status</label>
                <select className="select" value={editData.status} onChange={e => setEditData(d => ({ ...d, status: e.target.value }))}>
                  <option value="upcoming">Upcoming</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label className="label">Description</label>
              <textarea className="input" rows={3} value={editData.description} onChange={e => setEditData(d => ({ ...d, description: e.target.value }))} style={{ resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save Changes</button>
            </div>
          </form>
        </div>
      ) : (
        <div className="room-overview-header">
          <div style={{ flex: 1 }}>
            <div className="ro-date">{formatDate(room.date)}</div>
            {room.description && <div className="ro-desc">{room.description}</div>}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => verified ? setEditing(true) : onNeedCode()}>
            {verified ? '✎ Edit' : '🔒 Edit'}
          </button>
        </div>
      )}

      {/* Stats strip */}
      <div className="room-stats-strip">
        <div className="rss-cell">
          <div className="rss-val">{roomGames.length}</div>
          <div className="rss-lbl">Games Scheduled</div>
        </div>
        <div className="rss-cell">
          <div className="rss-val">{gamesCount}</div>
          <div className="rss-lbl">Results Logged</div>
        </div>
        <div className="rss-cell">
          <div className="rss-val">{achievements.length}</div>
          <div className="rss-lbl">Achievements</div>
        </div>
        <div className="rss-cell">
          <div className="rss-val" style={{ color: '#FFD700' }}>{achAwarded}</div>
          <div className="rss-lbl">Achievements Awarded</div>
        </div>
        <div className="rss-cell">
          <div className="rss-val">{roomPlayers.length}</div>
          <div className="rss-lbl">Players</div>
        </div>
      </div>

      {/* Players */}
      <div className="section-title" style={{ marginTop: '1.5rem' }}>Lineup</div>
      <div className="room-lineup">
        {roomPlayers.map(p => (
          <div key={p.id} className="lineup-player">
            <div className="lineup-avatar" style={{ background: p.color + '22', borderColor: p.color + '60', color: p.color }}>
              {initials(p.name)}
            </div>
            <div className="lineup-name">{p.name}</div>
          </div>
        ))}
      </div>

      {/* Scheduled games preview */}
      {roomGames.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: '1.5rem' }}>Game Schedule</div>
          <div style={{ display: 'flex', flex: 'column', gap: '0.5rem' }}>
            {roomGames.map(rg => {
              const hasResult = games.some(g => g.roomGameId === rg.id)
              return (
                <div key={rg.id} className="overview-game-row">
                  <span className="ogr-order">#{rg.order}</span>
                  <span className="ogr-name">{rg.name}</span>
                  {rg.pointsMode === 'custom'
                    ? <span className="pts-mode-badge custom">✦ Custom</span>
                    : <span className="pts-mode-badge standard">STD</span>}
                  <span className={`ogr-status ${hasResult ? 'done' : 'pending'}`}>
                    {hasResult ? '✓ Done' : '○ Pending'}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Achievements preview */}
      {achievements.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: '1.5rem' }}>Achievements Up For Grabs</div>
          <div className="overview-achs">
            {achievements.map(a => {
              const earner = a.earnedByIds[0] ? playerMap[a.earnedByIds[0]] : null
              return (
                <div key={a.id} className={`overview-ach-pill ${a.earnedByIds.length > 0 ? 'claimed' : ''}`}>
                  <span className="oa-icon">{a.icon}</span>
                  <div>
                    <div className="oa-name">{a.name}</div>
                    {earner
                      ? <div className="oa-earner" style={{ color: earner.color }}>Claimed by {earner.name}</div>
                      : <div className="oa-earner" style={{ color: 'var(--muted)' }}>Unclaimed</div>}
                  </div>
                  <span className="oa-pts">+{a.pointValue}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default function RoomDetail({ roomId, onBack, onToast }) {
  const [room, setRoom]           = useState(null)
  const [players, setPlayers]     = useState([])
  const [games, setGames]         = useState([])
  const [roomGames, setRoomGames] = useState([])
  const [achs, setAchs]           = useState([])
  const [tab, setTab]             = useState('overview')
  const [verified, setVerified]   = useState(() => isRoomVerified(roomId))
  const [showCodeModal, setShowCodeModal] = useState(false)
  const [copied, setCopied]       = useState(false)

  async function refresh() {
    const [r, p, g, rg, a] = await Promise.all([
      getRoom(roomId), getPlayers(), getGames(), getRoomGames(roomId)?.catch?.(() => []) ?? getRoomGames(roomId), getAchievements(roomId),
    ])
    setRoom(r); setPlayers(p); setGames(g); setRoomGames(rg); setAchs(a)
  }

  useEffect(() => { refresh() }, [roomId])

  if (!room) return <div className="empty">Loading…</div>

  const meta = STATUS_META[room.status] ?? STATUS_META.upcoming

  // Badge counts for tabs
  const pending = roomGames.filter(rg => !games.some(g => g.roomGameId === rg.id)).length
  const unawarded = achs.filter(a => a.earnedByIds.length === 0).length

  function handleCopyCode() {
    navigator.clipboard?.writeText(room.code ?? '').catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      {showCodeModal && (
        <CodeModal
          roomId={roomId}
          roomName={room.name}
          onVerified={() => { setVerified(true); setShowCodeModal(false) }}
          onCancel={() => setShowCodeModal(false)}
        />
      )}

      {/* Back + header */}
      <div className="room-detail-topbar">
        <button className="btn btn-ghost btn-sm back-btn" onClick={onBack}>← Rooms</button>
        <div className={`room-status-badge ${meta.cls}`}>{meta.label}</div>
      </div>

      <div className="room-detail-header">
        <div>
          <div className="room-detail-title">{room.name}</div>
          <div className="room-detail-date">
            {new Date(room.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
        {room.code && (
          <div className="room-code-display">
            <span className="room-code-label">🔑 Code</span>
            <span className="room-code-value">{room.code}</span>
            <button className="btn btn-ghost btn-sm" onClick={handleCopyCode} style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}>
              {copied ? '✓ Copied' : 'Copy'}
            </button>
            {!verified && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCodeModal(true)} style={{ padding: '0.2rem 0.6rem', fontSize: '0.72rem', color: '#00C2FF' }}>
                🔓 Unlock
              </button>
            )}
            {verified && <span className="room-code-unlocked">🔓 Unlocked</span>}
          </div>
        )}
      </div>

      {/* Sub-tab nav */}
      <div className="room-subtabs">
        {SUBTABS.map(t => (
          <button key={t.id} className={`room-subtab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'schedule'     && pending   > 0 && <span className="tab-badge pending">{pending}</span>}
            {t.id === 'achievements' && unawarded  > 0 && <span className="tab-badge available">{unawarded}</span>}
          </button>
        ))}
      </div>

      <div className="room-tab-content">
        {tab === 'overview' && (
          <RoomOverview room={room} players={players} games={games} roomGames={roomGames} achievements={achs} onEdited={refresh} verified={verified} onNeedCode={() => setShowCodeModal(true)} />
        )}
        {tab === 'schedule' && (
          <RoomSchedule room={room} onToast={onToast} verified={verified} onNeedCode={() => setShowCodeModal(true)} key={`sched-${roomId}`} />
        )}
        {tab === 'achievements' && (
          <AchievementManager room={room} onToast={onToast} verified={verified} onNeedCode={() => setShowCodeModal(true)} key={`ach-${roomId}`} />
        )}
        {tab === 'standings' && (
          <RoomLeaderboard room={room} key={`standings-${roomId}`} />
        )}
      </div>
    </div>
  )
}
