import { useEffect, useState } from 'react'
import { getRooms, getPlayers, addRoom, deleteRoom, updateRoom } from '../db/mockDb'

const STATUS_META = {
  upcoming:  { label: 'UPCOMING', cls: 'status-upcoming' },
  active:    { label: 'LIVE',     cls: 'status-active' },
  completed: { label: 'DONE',     cls: 'status-completed' },
}

function initials(n) { return n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) }

function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function PlayerDots({ ids, playerMap, max = 5 }) {
  const shown = ids.slice(0, max)
  const extra = ids.length - max
  return (
    <div className="player-dots">
      {shown.map(id => {
        const p = playerMap[id]
        if (!p) return null
        return (
          <div key={id} className="player-dot-avatar" style={{ background: p.color + '30', borderColor: p.color, color: p.color }} title={p.name}>
            {initials(p.name)}
          </div>
        )
      })}
      {extra > 0 && <div className="player-dot-more">+{extra}</div>}
    </div>
  )
}

function RoomCard({ room, playerMap, gameCount, onOpen, onDelete, onStatusChange }) {
  const meta = STATUS_META[room.status] ?? STATUS_META.upcoming
  return (
    <div className={`room-card ${room.status}`} onClick={onOpen} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpen()}>
      <div className="room-card-header">
        <div className={`room-status-badge ${meta.cls}`}>{meta.label}</div>
        <div className="room-card-actions" onClick={e => e.stopPropagation()}>
          <select
            className="room-status-select"
            value={room.status}
            onChange={e => onStatusChange(room.id, e.target.value)}
            title="Change status"
          >
            <option value="upcoming">Upcoming</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
          <button className="room-card-del" onClick={() => onDelete(room.id)} title="Delete room">✕</button>
        </div>
      </div>

      <div className="room-card-name">{room.name}</div>
      <div className="room-card-date">{formatDate(room.date)}</div>
      {room.description && (
        <div className="room-card-desc">{room.description.length > 100 ? room.description.slice(0, 100) + '…' : room.description}</div>
      )}

      <div className="room-card-footer">
        <PlayerDots ids={room.invitedPlayerIds} playerMap={playerMap} />
        <div className="room-card-meta">
          <span>{gameCount} game{gameCount !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span>{room.invitedPlayerIds.length} player{room.invitedPlayerIds.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  )
}

function CreateRoomForm({ players, onCreated, onCancel }) {
  const [name, setName]     = useState('')
  const [date, setDate]     = useState(new Date().toISOString().split('T')[0])
  const [desc, setDesc]     = useState('')
  const [status, setStatus] = useState('upcoming')
  const [invited, setInvited] = useState(players.map(p => p.id))

  function togglePlayer(id) {
    setInvited(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || invited.length === 0) return
    await addRoom(name.trim(), date, desc.trim(), invited, status)
    onCreated()
  }

  return (
    <div className="create-room-form card">
      <div className="section-title">Create Competition Room</div>
      <form className="form-grid" onSubmit={handleSubmit}>
        <div className="field">
          <label className="label">Room Name</label>
          <input className="input" placeholder="e.g. Game Night Vol.2" value={name} onChange={e => setName(e.target.value)} required />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="field">
            <label className="label">Date</label>
            <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Status</label>
            <select className="select" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="upcoming">Upcoming</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label className="label">Description</label>
          <textarea className="input" rows={3} placeholder="Rules, stakes, vibe…" value={desc} onChange={e => setDesc(e.target.value)} style={{ resize: 'vertical' }} />
        </div>

        <div className="field">
          <label className="label">Invite Players</label>
          <div className="participants-grid">
            {players.map(p => (
              <button key={p.id} type="button"
                className={`participant-chip ${invited.includes(p.id) ? 'selected' : ''}`}
                style={invited.includes(p.id) ? { color: p.color } : {}}
                onClick={() => togglePlayer(p.id)}
              >
                <div className="dot" style={{ background: p.color }} />
                {p.name}
              </button>
            ))}
          </div>
          {players.length === 0 && <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>No players yet — add them from the Leaderboard tab.</div>}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || invited.length === 0}
            style={{ opacity: name.trim() && invited.length ? 1 : 0.4 }}>
            Create Room
          </button>
        </div>
      </form>
    </div>
  )
}

export default function Rooms({ onRoomSelect, onToast }) {
  const [rooms, setRooms]       = useState([])
  const [players, setPlayers]   = useState([])
  const [gameCounts, setGameCounts] = useState({})
  const [creating, setCreating] = useState(false)

  async function refresh() {
    const [r, p] = await Promise.all([getRooms(), getPlayers()])
    setRooms(r)
    setPlayers(p)
  }

  useEffect(() => { refresh() }, [])

  const playerMap = Object.fromEntries(players.map(p => [p.id, p]))

  async function handleDelete(id) {
    if (!confirm('Delete this room? Game results will be kept as free-play.')) return
    await deleteRoom(id)
    onToast('Room deleted')
    refresh()
  }

  async function handleStatusChange(id, status) {
    await updateRoom(id, { status })
    refresh()
  }

  const grouped = {
    active:    rooms.filter(r => r.status === 'active'),
    upcoming:  rooms.filter(r => r.status === 'upcoming'),
    completed: rooms.filter(r => r.status === 'completed'),
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>Competition Rooms</div>
          <div style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>Structured game nights with custom scoring &amp; achievements</div>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New Room</button>
      </div>

      {creating && (
        <div style={{ marginBottom: '1.5rem' }}>
          <CreateRoomForm
            players={players}
            onCreated={() => { setCreating(false); refresh(); onToast('Room created!') }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      {rooms.length === 0 && !creating && (
        <div className="empty cockpit-panel">No rooms yet — create one to get started.</div>
      )}

      {['active', 'upcoming', 'completed'].map(status => {
        const group = grouped[status]
        if (group.length === 0) return null
        return (
          <div key={status} style={{ marginBottom: '1.5rem' }}>
            <div className="section-title" style={{ marginBottom: '0.75rem' }}>
              {status === 'active' ? '🟢 Live' : status === 'upcoming' ? '🔵 Upcoming' : '✓ Completed'}
            </div>
            <div className="rooms-grid">
              {group.map(room => (
                <RoomCard
                  key={room.id}
                  room={room}
                  playerMap={playerMap}
                  gameCount={gameCounts[room.id] ?? 0}
                  onOpen={() => onRoomSelect(room.id)}
                  onDelete={() => handleDelete(room.id)}
                  onStatusChange={handleStatusChange}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
