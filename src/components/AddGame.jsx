import { useEffect, useState } from 'react'
import { getPlayers, addGame, POINTS, PLACE_EMOJI, PLACE_LABEL } from '../db/supabaseDb'

const GAME_TYPES = ['Chess', 'Mario Kart', 'Poker', 'Catan', 'Ping Pong', 'Darts', 'Smash Bros', 'Uno', 'Pool']
const PLACES = [1, 2, 3, 0]

export default function AddGame({ onGameAdded, onToast }) {
  const [players, setPlayers] = useState([])
  const [gameType, setGameType] = useState('')
  const [customGame, setCustomGame] = useState('')
  const [participantIds, setParticipantIds] = useState([])
  const [placements, setPlacements] = useState({}) // { playerId: place }
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])

  useEffect(() => { getPlayers().then(setPlayers) }, [])

  function toggleParticipant(id) {
    setParticipantIds(prev => {
      if (prev.includes(id)) {
        setPlacements(p => { const n = { ...p }; delete n[id]; return n })
        return prev.filter(p => p !== id)
      }
      return [...prev, id]
    })
  }

  function setPlace(playerId, place) {
    setPlacements(prev => {
      const next = { ...prev }
      // 1st/2nd/3rd are exclusive — clear any other player who holds this slot
      if (place > 0) {
        Object.keys(next).forEach(pid => {
          if (next[pid] === place && pid !== playerId) delete next[pid]
        })
      }
      next[playerId] = place
      return next
    })
  }

  const finalGameType = gameType === '__custom__' ? customGame : gameType
  const participants  = players.filter(p => participantIds.includes(p.id))
  const allAssigned   = participantIds.length >= 2 && participantIds.every(id => placements[id] !== undefined)
  const hasFirst      = Object.values(placements).includes(1)
  const canSubmit     = finalGameType.trim() && allAssigned && hasFirst

  async function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    const placementArr = participantIds.map(id => ({ playerId: id, place: placements[id] }))
    await addGame(finalGameType.trim(), placementArr, date)
    const winner = players.find(p => placements[p.id] === 1)
    onToast(`${winner?.name} won ${finalGameType.trim()}! 🎉`)
    onGameAdded()
    setGameType(''); setCustomGame(''); setParticipantIds([]); setPlacements({})
    setDate(new Date().toISOString().split('T')[0])
  }

  return (
    <div className="card">
      <div className="section-title">Log a Game</div>
      <form className="form-grid" onSubmit={handleSubmit}>

        <div className="field">
          <label className="label">Game</label>
          <select className="select" value={gameType} onChange={e => setGameType(e.target.value)}>
            <option value="">Select a game…</option>
            {GAME_TYPES.map(g => <option key={g} value={g}>{g}</option>)}
            <option value="__custom__">+ Custom game…</option>
          </select>
        </div>

        {gameType === '__custom__' && (
          <div className="field">
            <label className="label">Custom Game Name</label>
            <input className="input" placeholder="e.g. Jenga" value={customGame} onChange={e => setCustomGame(e.target.value)} />
          </div>
        )}

        <div className="field">
          <label className="label">Date</label>
          <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
        </div>

        <div className="field">
          <label className="label">Who played?</label>
          <div className="participants-grid">
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
          {players.length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: '0.85rem', paddingTop: '0.5rem' }}>
              No players yet — add some from the Leaderboard tab.
            </div>
          )}
        </div>

        {/* Placement assignment — shown once ≥2 players selected */}
        {participants.length >= 2 && (
          <div className="field">
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
                      const active = placements[p.id] === place
                      // Disable 1/2/3 if another player holds that slot (unless this player already has it)
                      const takenBy = place > 0
                        ? Object.entries(placements).find(([pid, pl]) => pl === place && pid !== p.id)
                        : null
                      const disabled = !!takenBy
                      return (
                        <button
                          key={place}
                          type="button"
                          className={`place-btn ${active ? 'active' : ''} ${disabled ? 'taken' : ''}`}
                          style={active ? { borderColor: p.color, color: p.color, background: p.color + '18' } : {}}
                          onClick={() => !disabled && setPlace(p.id, place)}
                          title={disabled ? `${players.find(pl => pl.id === takenBy[0])?.name} has ${PLACE_LABEL[place]}` : PLACE_LABEL[place]}
                        >
                          {PLACE_EMOJI[place]} <span className="place-label">{PLACE_LABEL[place]}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            {!hasFirst && allAssigned === false && (
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
                Assign a placement to each player. At least one must be 1st.
              </div>
            )}
          </div>
        )}

        {/* Points preview */}
        {allAssigned && hasFirst && (
          <div className="points-preview">
            {participants.map(p => (
              <div key={p.id} className="pts-row">
                <div className="dot" style={{ background: p.color }} />
                <span>{p.name}</span>
                <span style={{ color: p.color, fontWeight: 700 }}>+{POINTS[placements[p.id]]} pts</span>
                <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
                  {PLACE_EMOJI[placements[p.id]]} {PLACE_LABEL[placements[p.id]]}
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '0.5rem' }}>
          <button className="btn btn-primary" type="submit"
            disabled={!canSubmit}
            style={{ opacity: canSubmit ? 1 : 0.4, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          >
            Log Game
          </button>
        </div>
      </form>
    </div>
  )
}
