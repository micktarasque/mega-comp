import { useEffect, useState } from 'react'
import { getGames, getPlayers, deleteGame, PLACE_EMOJI, POINTS } from '../db/mockDb'

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function History({ refreshKey, onToast }) {
  const [games, setGames] = useState([])
  const [players, setPlayers] = useState([])
  const [filter, setFilter] = useState('')

  async function refresh() {
    const [g, p] = await Promise.all([getGames(), getPlayers()])
    setGames(g)
    setPlayers(p)
  }

  useEffect(() => { refresh() }, [refreshKey])

  const playerMap = Object.fromEntries(players.map(p => [p.id, p]))
  const allTypes  = [...new Set(games.map(g => g.gameType))].sort()
  const filtered  = filter ? games.filter(g => g.gameType === filter) : games

  async function handleDelete(id) {
    await deleteGame(id)
    onToast('Game removed')
    refresh()
  }

  return (
    <div>
      {allTypes.length > 1 && (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {['', ...allTypes].map(t => (
            <button key={t} className="btn btn-ghost"
              style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem', ...(filter === t ? { borderColor: 'var(--muted)', color: 'var(--text)' } : {}) }}
              onClick={() => setFilter(t)}
            >
              {t || 'All'}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty">No games logged yet.</div>
      ) : (
        <div className="history-list">
          {filtered.map(game => {
            // sort placements: 1st, 2nd, 3rd, then losers
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
                    {sorted.map(({ playerId, place }) => {
                      const p = playerMap[playerId]
                      if (!p) return null
                      return (
                        <span key={playerId} className="placement-pill"
                          style={{ color: p.color, borderColor: p.color + '40' }}
                        >
                          {PLACE_EMOJI[place]} {p.name}
                          {place > 0 && <span style={{ color: 'var(--muted)', fontWeight: 500 }}> +{POINTS[place]}</span>}
                        </span>
                      )
                    })}
                  </div>
                </div>
                <button className="btn btn-danger" onClick={() => handleDelete(game.id)} title="Remove game">✕</button>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ color: 'var(--muted)', fontSize: '0.75rem', marginTop: '1.25rem', textAlign: 'center' }}>
        {filtered.length} game{filtered.length !== 1 ? 's' : ''} logged
      </div>
    </div>
  )
}
