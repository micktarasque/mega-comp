import { useState } from 'react'
import { verifyRoomCode } from '../db/mockDb'

export default function CodeModal({ roomId, roomName, onVerified, onCancel }) {
  const [code, setCode]       = useState('')
  const [error, setError]     = useState('')
  const [shaking, setShaking] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const result = await verifyRoomCode(roomId, code)
    if (result.error) {
      setError(result.error)
      setShaking(true)
      setTimeout(() => setShaking(false), 500)
      setCode('')
      return
    }
    onVerified()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className={`modal-box ${shaking ? 'shake' : ''}`}>
        <div className="modal-icon">🔐</div>
        <div className="modal-title">Room Code Required</div>
        <div className="modal-sub">{roomName}</div>
        <p className="modal-hint">Enter the 5-character room code to unlock editing.</p>
        <form onSubmit={handleSubmit}>
          <input
            className="input code-input"
            value={code}
            onChange={e => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)); setError('') }}
            placeholder="XXXXX"
            maxLength={5}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          {error && <div className="code-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={code.length < 3}>
              Unlock
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
