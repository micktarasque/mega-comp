import { useEffect, useState } from 'react'
import { getRooms, addRoom, deleteRoom, updateRoom } from '../db/supabaseDb'

const STATUS_META = {
  upcoming:  { label: 'UPCOMING', cls: 'status-upcoming' },
  active:    { label: 'LIVE',     cls: 'status-active' },
  completed: { label: 'DONE',     cls: 'status-completed' },
}

function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function RoomCard({ room, onOpen, onDelete, onStatusChange }) {
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
    </div>
  )
}

function CreateRoomForm({ onCreated, onCancel }) {
  const [name, setName]     = useState('')
  const [date, setDate]     = useState(new Date().toISOString().split('T')[0])
  const [desc, setDesc]     = useState('')
  const [status, setStatus] = useState('upcoming')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    const room = await addRoom(name.trim(), date, desc.trim(), status)
    onCreated(room?.id ?? null)
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
            <input type="date" className="input date-input" value={date} onChange={e => setDate(e.target.value)} />
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

        <div style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
          Players are added inside the room after creation.
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}
            style={{ opacity: name.trim() ? 1 : 0.4 }}>
            Create Room
          </button>
        </div>
      </form>
    </div>
  )
}

export default function Rooms({ onRoomSelect, onToast }) {
  const [rooms, setRooms]       = useState([])
  const [creating, setCreating] = useState(false)

  async function refresh() {
    setRooms(await getRooms())
  }

  useEffect(() => { refresh() }, [])

  async function handleDelete(id) {
    if (!confirm('Delete this room? All players, game schedules, and results will be permanently removed.')) return
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
            onCreated={id => { setCreating(false); refresh(); onToast('Room created!'); if (id) onRoomSelect(id) }}
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
