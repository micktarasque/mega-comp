import { useEffect, useState } from 'react'
import { getRoomGames, addRoomGame, updateRoomGame, deleteRoomGame, getGames, addGame, reorderRoomGame, POINTS, PLACE_EMOJI, PLACE_LABEL } from '../db/supabaseDb'

const PLACES = [1, 2, 3, 0]

function PointsBadge({ pointsMode, customPoints }) {
  if (pointsMode === 'standard') {
    return <span className="pts-mode-badge standard">STD 3·2·1·0</span>
  }
  const cp = customPoints ?? {}
  return <span className="pts-mode-badge custom">✦ {cp[1]}·{cp[2]}·{cp[3]}·{cp[0]}</span>
}

function LogResultInline({ room, roomGame, players, onDone, onToast }) {
  const ptMap = (roomGame.pointsMode === 'custom' && roomGame.customPoints) ? roomGame.customPoints : POINTS
  const [participantIds, setParticipantIds] = useState(players.map(p => p.id))
  const [placements, setPlacements] = useState({})
  const [date, setDate] = useState(room.date)

  function setPlace(playerId, place) {
    setPlacements(prev => {
      const next = { ...prev }
      if (place > 0) Object.keys(next).forEach(pid => { if (next[pid] === place && pid !== playerId) delete next[pid] })
      next[playerId] = place
      return next
    })
  }

  function toggleParticipant(id) {
    setParticipantIds(prev => {
      if (prev.includes(id)) {
        setPlacements(p => { const n = { ...p }; delete n[id]; return n })
        return prev.filter(x => x !== id)
      }
      return [...prev, id]
    })
  }

  const participants = players.filter(p => participantIds.includes(p.id))
  const allAssigned  = participantIds.length >= 2 && participantIds.every(id => placements[id] !== undefined)
  const hasFirst     = Object.values(placements).includes(1)
  const canSubmit    = allAssigned && hasFirst

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    const placementArr = participantIds.map(id => ({ playerId: id, place: placements[id] }))
    await addGame(roomGame.name, placementArr, date, room.id, roomGame.id)
    const winner = players.find(p => placements[p.id] === 1)
    onToast(`${winner?.name} won ${roomGame.name}! 🎉`)
    onDone()
  }

  return (
    <form className="inline-log-form" onSubmit={handleSubmit}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label className="label">Date</label>
          <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 2 }}>
          <label className="label">Who played?</label>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {players.map(p => (
              <button key={p.id} type="button"
                className={`participant-chip ${participantIds.includes(p.id) ? 'selected' : ''}`}
                style={participantIds.includes(p.id) ? { color: p.color } : {}}
                onClick={() => toggleParticipant(p.id)}
              >
                <div className="dot" style={{ background: p.color }} />
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {participants.length >= 2 && (
        <div className="field" style={{ marginTop: '0.75rem' }}>
          <label className="label">Assign Placements</label>
          <div className="placement-table">
            {participants.map(p => (
              <div key={p.id} className="placement-row">
                <div className="placement-player">
                  <div className="dot" style={{ background: p.color }} />
                  <span>{p.name}</span>
                </div>
                <div className="placement-btns">
                  {PLACES.map(place => {
                    const active  = placements[p.id] === place
                    const takenBy = place > 0 ? Object.entries(placements).find(([pid, pl]) => pl === place && pid !== p.id) : null
                    return (
                      <button key={place} type="button"
                        className={`place-btn ${active ? 'active' : ''} ${takenBy ? 'taken' : ''}`}
                        style={active ? { borderColor: p.color, color: p.color, background: p.color + '18' } : {}}
                        onClick={() => !takenBy && setPlace(p.id, place)}
                      >
                        {PLACE_EMOJI[place]} <span className="place-label">{PLACE_LABEL[place]}</span>
                        {active && <span style={{ marginLeft: '0.25rem', fontWeight: 800 }}>+{ptMap[place]}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm"
          disabled={!canSubmit} style={{ opacity: canSubmit ? 1 : 0.4 }}>
          Log Result
        </button>
      </div>
    </form>
  )
}

function RoomGameCard({ roomGame, room, players, allGames, linkedAchs, isFirst, isLast, onUpdated, onReorder, onToast, verified, onNeedCode }) {
  const results = allGames.filter(g => g.roomGameId === roomGame.id)
  const isDone  = results.length > 0

  // Pending games open by default, done ones collapsed
  const [open, setOpen]     = useState(!isDone)
  const [logging, setLogging]   = useState(false)
  const [editing, setEditing]   = useState(false)
  const [editData, setEditData] = useState({ ...roomGame })

  const ptMap     = (roomGame.pointsMode === 'custom' && roomGame.customPoints) ? roomGame.customPoints : POINTS
  const playerMap = Object.fromEntries(players.map(p => [p.id, p]))

  async function handleDelete() {
    if (!confirm(`Remove "${roomGame.name}" from schedule? Logged results will be kept.`)) return
    await deleteRoomGame(roomGame.id)
    onUpdated()
  }

  async function handleSaveEdit(e) {
    e.preventDefault()
    await updateRoomGame(roomGame.id, {
      name: editData.name,
      description: editData.description,
      pointsMode: editData.pointsMode,
      customPoints: editData.pointsMode === 'custom' ? editData.customPoints : null,
    })
    setEditing(false)
    onUpdated()
  }

  if (editing) {
    return (
      <div className="sgc-card editing">
        <form onSubmit={handleSaveEdit} className="form-grid">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="field">
              <label className="label">Game Name</label>
              <input className="input" value={editData.name} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} required />
            </div>
            <div className="field">
              <label className="label">Points Mode</label>
              <select className="select" value={editData.pointsMode} onChange={e => setEditData(d => ({ ...d, pointsMode: e.target.value }))}>
                <option value="standard">Standard (3·2·1·0)</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>
          {editData.pointsMode === 'custom' && (
            <div className="custom-pts-grid">
              {PLACES.map(place => (
                <div key={place} className="field">
                  <label className="label">{PLACE_EMOJI[place]} {PLACE_LABEL[place]}</label>
                  <input type="number" className="input" min={0} max={99}
                    value={editData.customPoints?.[place] ?? POINTS[place]}
                    onChange={e => setEditData(d => ({ ...d, customPoints: { ...(d.customPoints ?? POINTS), [place]: Number(e.target.value) } }))}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="field">
            <label className="label">Description / Rules</label>
            <textarea className="input" rows={2} value={editData.description} onChange={e => setEditData(d => ({ ...d, description: e.target.value }))} style={{ resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm">Save</button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className={`sgc-card ${isDone ? 'done' : 'pending'} ${open ? 'open' : ''}`}>
      {/* ── Always-visible accordion header ── */}
      <div className="sgc-header" onClick={() => setOpen(o => !o)}>
        <div className="sgc-reorder" onClick={e => e.stopPropagation()}>
          <button className="reorder-btn" disabled={isFirst} onClick={() => onReorder(roomGame.id, 'up')} title="Move up">▲</button>
          <button className="reorder-btn" disabled={isLast}  onClick={() => onReorder(roomGame.id, 'down')} title="Move down">▼</button>
        </div>

        <span className="sgc-order">#{roomGame.order}</span>

        <div className="sgc-title-block">
          <div className="sgc-name">{roomGame.name}</div>
          <div className="sgc-header-meta">
            <PointsBadge pointsMode={roomGame.pointsMode} customPoints={roomGame.customPoints} />
            {linkedAchs.length > 0 && (
              <span className="sgc-ach-count">🏅 {linkedAchs.length} ach</span>
            )}
          </div>
        </div>

        <div className="sgc-header-right" onClick={e => e.stopPropagation()}>
          <span className={`sgc-status-pill ${isDone ? 'done' : 'pending'}`}>
            {isDone ? '✓ Done' : '○ Pending'}
          </span>
          {verified && (
            <>
              <button className="icon-btn" onClick={() => setEditing(true)} title="Edit">✎</button>
              <button className="icon-btn danger" onClick={handleDelete} title="Remove">✕</button>
            </>
          )}
          {!verified && (
            <button className="icon-btn" onClick={onNeedCode} title="Unlock to edit">🔒</button>
          )}
          <button className="sgc-toggle" onClick={() => setOpen(o => !o)}>{open ? '▲' : '▼'}</button>
        </div>
      </div>

      {/* ── Expandable body ── */}
      <div className={`sgc-body ${open ? 'open' : ''}`}>
        <div className="sgc-body-inner">
          {roomGame.description && (
            <div className="sgc-desc">{roomGame.description}</div>
          )}

          {roomGame.pointsMode === 'custom' && roomGame.customPoints && (
            <div className="custom-pts-pills">
              {PLACES.map(p => (
                <span key={p} className="custom-pts-pill">
                  {PLACE_EMOJI[p]} <strong>{roomGame.customPoints[p]}</strong>pts
                </span>
              ))}
            </div>
          )}

          {/* Linked achievements */}
          {linkedAchs.length > 0 && (
            <div className="sgc-achs">
              <div className="sgc-achs-label">Achievements up for grabs</div>
              <div className="sgc-achs-list">
                {linkedAchs.map(a => {
                  const claimed = a.earnedByIds.length > 0
                  return (
                    <div key={a.id} className={`sgc-ach-pill ${claimed ? 'claimed' : ''}`}>
                      <span>{a.icon}</span>
                      <span className="sgc-ach-name">{a.name}</span>
                      <span className="sgc-ach-pts">+{a.pointValue}</span>
                      {claimed && <span className="sgc-ach-claimed">✓ Claimed</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Logged results */}
          {results.length > 0 && (
            <div className="sgc-results">
              {results.map(game => {
                const sorted = [...game.placements].sort((a, b) => {
                  if (a.place === 0 && b.place !== 0) return 1
                  if (b.place === 0 && a.place !== 0) return -1
                  return a.place - b.place
                })
                return (
                  <div key={game.id} className="sgc-result-row">
                    <span className="sgc-result-date">{new Date(game.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    <div className="sgc-result-placements">
                      {sorted.map(({ playerId, playerName, playerColor, place, points }) => (
                        <span key={playerId} className="placement-pill" style={{ color: playerColor, borderColor: playerColor + '50' }}>
                          {PLACE_EMOJI[place]} {playerName}
                          <span style={{ color: 'var(--muted-fg)', fontWeight: 500 }}> +{points}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {!logging ? (
            <button className="btn btn-ghost btn-sm sgc-log-btn" onClick={() => verified ? setLogging(true) : onNeedCode()}>
              {verified ? '+ Log Result' : '🔒 Log Result'}
            </button>
          ) : (
            <LogResultInline room={room} roomGame={roomGame} players={players} onDone={() => { setLogging(false); onUpdated() }} onToast={onToast} />
          )}
        </div>
      </div>
    </div>
  )
}

function AddGameSlotForm({ roomId, currentCount, onAdded, onCancel }) {
  const [name, setName]     = useState('')
  const [desc, setDesc]     = useState('')
  const [mode, setMode]     = useState('standard')
  const [custom, setCustom] = useState({ 1: 3, 2: 2, 3: 1, 0: 0 })

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    await addRoomGame(roomId, { name: name.trim(), description: desc.trim(), pointsMode: mode, customPoints: mode === 'custom' ? custom : null, order: currentCount + 1 })
    onAdded()
  }

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="section-title">Add Game to Schedule</div>
      <form className="form-grid" onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div className="field">
            <label className="label">Game Name</label>
            <input className="input" placeholder="e.g. Smash Bros" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label className="label">Points Mode</label>
            <select className="select" value={mode} onChange={e => setMode(e.target.value)}>
              <option value="standard">Standard (3·2·1·0)</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>

        {mode === 'custom' && (
          <div className="custom-pts-grid">
            {PLACES.map(place => (
              <div key={place} className="field">
                <label className="label">{PLACE_EMOJI[place]} {PLACE_LABEL[place]}</label>
                <input type="number" className="input" min={0} max={99} value={custom[place]}
                  onChange={e => setCustom(c => ({ ...c, [place]: Number(e.target.value) }))} />
              </div>
            ))}
          </div>
        )}

        <div className="field">
          <label className="label">Description / Rules (optional)</label>
          <textarea className="input" rows={2} placeholder="Describe how this game is played and scored…" value={desc} onChange={e => setDesc(e.target.value)} style={{ resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()} style={{ opacity: name.trim() ? 1 : 0.4 }}>Add to Schedule</button>
        </div>
      </form>
    </div>
  )
}

export default function RoomSchedule({ room, roomPlayers, achievements = [], onToast, verified, onNeedCode }) {
  const [roomGames, setRoomGames]   = useState([])
  const [allGames, setAllGames]     = useState([])
  const [addingSlot, setAddingSlot] = useState(false)

  async function refresh() {
    const [rg, g] = await Promise.all([getRoomGames(room.id), getGames()])
    setRoomGames(rg)
    setAllGames(g)
  }

  useEffect(() => { refresh() }, [room.id])

  async function handleReorder(id, direction) {
    await reorderRoomGame(room.id, id, direction)
    refresh()
  }

  const completedCount = roomGames.filter(rg => allGames.some(g => g.roomGameId === rg.id)).length

  if (roomPlayers.length === 0) {
    return (
      <div className="empty" style={{ paddingTop: '2rem' }}>
        Add players in the Overview tab before scheduling games.
      </div>
    )
  }

  return (
    <div>
      <div className="schedule-meta">
        <span>{roomGames.length} game{roomGames.length !== 1 ? 's' : ''} scheduled</span>
        <span className="meta-sep">·</span>
        <span>{completedCount} completed</span>
        <span className="meta-sep">·</span>
        <span>{roomGames.length - completedCount} pending</span>
      </div>

      {roomGames.length === 0 && (
        <div className="empty" style={{ paddingTop: '2rem' }}>No games scheduled yet — add the first one below.</div>
      )}

      <div className="schedule-list">
        {roomGames.map((rg, idx) => (
          <RoomGameCard
            key={rg.id}
            roomGame={rg}
            room={room}
            players={roomPlayers}
            allGames={allGames}
            linkedAchs={achievements.filter(a => a.roomGameId === rg.id)}
            isFirst={idx === 0}
            isLast={idx === roomGames.length - 1}
            onUpdated={refresh}
            onReorder={handleReorder}
            onToast={onToast}
            verified={verified}
            onNeedCode={onNeedCode}
          />
        ))}
      </div>

      {addingSlot ? (
        <AddGameSlotForm roomId={room.id} currentCount={roomGames.length} onAdded={() => { setAddingSlot(false); refresh() }} onCancel={() => setAddingSlot(false)} />
      ) : (
        <button className="btn btn-ghost" style={{ marginTop: '1rem' }} onClick={() => verified ? setAddingSlot(true) : onNeedCode()}>
          {verified ? '+ Add Game to Schedule' : '🔒 Add Game to Schedule'}
        </button>
      )}
    </div>
  )
}
