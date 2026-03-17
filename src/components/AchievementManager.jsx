import { useEffect, useState } from 'react'
import { getAchievements, addAchievement, updateAchievement, deleteAchievement, awardAchievement, revokeAchievement } from '../db/supabaseDb'

const EMOJI_PRESETS = ['⭐','🏆','🔥','💀','👑','🎯','⚡','🎩','🩸','🗣️','💥','🐦','🎖️','🥊','🎲','🧠','💎','🤡','😤','🥇']

function AchievementCard({ ach, players, playerMap, onUpdated, onToast, verified, onNeedCode }) {
  const [awarding, setAwarding]     = useState(false)
  const [selectedPlayer, setSelected] = useState('')
  const [editing, setEditing]       = useState(false)
  const [editData, setEditData]     = useState({ ...ach })

  const earners  = ach.earnedByIds.map(id => playerMap[id]).filter(Boolean)
  const locked   = ach.awardedOnce && ach.earnedByIds.length > 0
  const eligible = players.filter(p => !ach.earnedByIds.includes(p.id) && (!ach.awardedOnce || !locked))

  async function handleAward(e) {
    e.preventDefault()
    if (!selectedPlayer) return
    const result = await awardAchievement(ach.id, selectedPlayer)
    if (result?.error) { onToast(`⚠️ ${result.error}`); return }
    const p = playerMap[selectedPlayer]
    onToast(`${p?.name} earned "${ach.name}"! +${ach.pointValue}pts`)
    setAwarding(false); setSelected(''); onUpdated()
  }

  async function handleRevoke(playerId) {
    await revokeAchievement(ach.id, playerId)
    onUpdated()
  }

  async function handleDelete() {
    if (!confirm(`Delete achievement "${ach.name}"?`)) return
    await deleteAchievement(ach.id)
    onUpdated()
  }

  async function handleSaveEdit(e) {
    e.preventDefault()
    await updateAchievement(ach.id, { ...editData, pointValue: Number(editData.pointValue) })
    setEditing(false); onUpdated()
  }

  if (editing) {
    return (
      <div className="achievement-card editing">
        <form onSubmit={handleSaveEdit} className="form-grid">
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 100px', gap: '0.75rem', alignItems: 'end' }}>
            <div className="field">
              <label className="label">Icon</label>
              <select className="select" value={editData.icon} onChange={e => setEditData(d => ({ ...d, icon: e.target.value }))} style={{ width: '4rem', textAlign: 'center', fontSize: '1.2rem' }}>
                {EMOJI_PRESETS.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Name</label>
              <input className="input" value={editData.name} onChange={e => setEditData(d => ({ ...d, name: e.target.value }))} required />
            </div>
            <div className="field">
              <label className="label">Points</label>
              <input type="number" className="input" min={-99} max={99} value={editData.pointValue} onChange={e => setEditData(d => ({ ...d, pointValue: e.target.value }))} />
            </div>
          </div>
          <div className="field">
            <label className="label">Description</label>
            <textarea className="input" rows={2} value={editData.description} onChange={e => setEditData(d => ({ ...d, description: e.target.value }))} style={{ resize: 'vertical' }} />
          </div>
          <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.75rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={editData.awardedOnce} onChange={e => setEditData(d => ({ ...d, awardedOnce: e.target.checked }))} />
              <span className="label" style={{ margin: 0 }}>Award once only (exclusive)</span>
            </label>
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
    <div className={`achievement-card ${locked ? 'locked' : ''}`}>
      <div className="ach-header">
        <div className="ach-icon">{ach.icon}</div>
        <div className="ach-title-block">
          <div className="ach-name">{ach.name}</div>
          <div className="ach-meta">
            <span className="ach-pts">+{ach.pointValue} pts</span>
            {ach.awardedOnce
              ? <span className="ach-mode exclusive">Exclusive</span>
              : <span className="ach-mode multi">Multi-award</span>}
          </div>
        </div>
        <div className="ach-actions">
          <button className="icon-btn" onClick={() => verified ? setEditing(true) : onNeedCode()} title="Edit">✎</button>
          <button className="icon-btn danger" onClick={() => verified ? handleDelete() : onNeedCode()} title="Delete">✕</button>
        </div>
      </div>

      {ach.description && <div className="ach-desc">{ach.description}</div>}

      {/* Earners */}
      {earners.length > 0 && (
        <div className="ach-earners">
          {earners.map(p => (
            <div key={p.id} className="ach-earner" style={{ borderColor: p.color + '50', background: p.color + '10' }}>
              <span style={{ color: p.color }}>✓ {p.name}</span>
              <button className="revoke-btn" onClick={() => verified ? handleRevoke(p.id) : onNeedCode()} title="Revoke">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Award section */}
      {!locked && eligible.length > 0 && (
        awarding ? (
          <form className="award-form" onSubmit={handleAward}>
            <select className="select" value={selectedPlayer} onChange={e => setSelected(e.target.value)} required style={{ flex: 1 }}>
              <option value="">Select player…</option>
              {eligible.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!selectedPlayer}>Award</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAwarding(false); setSelected('') }}>Cancel</button>
          </form>
        ) : (
          <button className="btn btn-ghost btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => verified ? setAwarding(true) : onNeedCode()}>
            {verified ? '🏅 Award to Player' : '🔒 Award to Player'}
          </button>
        )
      )}

      {locked && <div className="ach-locked-note">Awarded — exclusive achievement claimed</div>}
      {!locked && eligible.length === 0 && ach.earnedByIds.length > 0 && <div className="ach-locked-note">All eligible players have earned this</div>}
    </div>
  )
}

function AddAchievementForm({ roomId, onAdded, onCancel }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [icon, setIcon] = useState('⭐')
  const [pts, setPts]   = useState(2)
  const [once, setOnce] = useState(true)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    await addAchievement(roomId, { name: name.trim(), description: desc.trim(), icon, pointValue: Number(pts), awardedOnce: once })
    onAdded()
  }

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="section-title">Define Achievement</div>
      <form className="form-grid" onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
          <div className="field">
            <label className="label">Icon</label>
            <select className="select" value={icon} onChange={e => setIcon(e.target.value)} style={{ width: '4rem', textAlign: 'center', fontSize: '1.2rem' }}>
              {EMOJI_PRESETS.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Achievement Name</label>
            <input className="input" placeholder="e.g. Comeback King" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label className="label">Points</label>
            <input type="number" className="input" min={-99} max={99} value={pts} onChange={e => setPts(e.target.value)} style={{ width: '80px' }} />
          </div>
        </div>

        <div className="field">
          <label className="label">Description / How to earn</label>
          <textarea className="input" rows={2} placeholder="Describe what earns this achievement…" value={desc} onChange={e => setDesc(e.target.value)} style={{ resize: 'vertical' }} />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={once} onChange={e => setOnce(e.target.checked)} />
          <div>
            <span className="label" style={{ display: 'block' }}>Exclusive (award once only)</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Uncheck to allow multiple players to earn it</span>
          </div>
        </label>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()} style={{ opacity: name.trim() ? 1 : 0.4 }}>Add Achievement</button>
        </div>
      </form>
    </div>
  )
}

export default function AchievementManager({ room, roomPlayers, onToast, verified, onNeedCode }) {
  const [achievements, setAchievements] = useState([])
  const [adding, setAdding]             = useState(false)

  async function refresh() {
    setAchievements(await getAchievements(room.id))
  }

  useEffect(() => { refresh() }, [room.id])

  const playerMap = Object.fromEntries(roomPlayers.map(p => [p.id, p]))

  const totalPts = achievements.reduce((sum, a) => sum + a.pointValue * a.earnedByIds.length, 0)
  const awarded  = achievements.filter(a => a.earnedByIds.length > 0).length

  return (
    <div>
      <div className="schedule-meta" style={{ marginBottom: '1rem' }}>
        <span>{achievements.length} achievement{achievements.length !== 1 ? 's' : ''} defined</span>
        <span className="meta-sep">·</span>
        <span>{awarded} awarded</span>
        <span className="meta-sep">·</span>
        <span>{totalPts} pts in play</span>
      </div>

      {achievements.length === 0 && (
        <div className="empty" style={{ paddingTop: '2rem' }}>No achievements defined yet — add the first one below.</div>
      )}

      <div className="achievements-list">
        {achievements.map(ach => (
          <AchievementCard key={ach.id} ach={ach} players={roomPlayers} playerMap={playerMap} onUpdated={refresh} onToast={onToast} verified={verified} onNeedCode={onNeedCode} />
        ))}
      </div>

      {adding ? (
        <AddAchievementForm roomId={room.id} onAdded={() => { setAdding(false); refresh() }} onCancel={() => setAdding(false)} />
      ) : (
        <button className="btn btn-ghost" style={{ marginTop: '1rem' }} onClick={() => verified ? setAdding(true) : onNeedCode()}>
          {verified ? '+ Define Achievement' : '🔒 Define Achievement'}
        </button>
      )}
    </div>
  )
}
