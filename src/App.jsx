import { useState } from 'react'
import Dashboard from './components/Dashboard'
import History from './components/History'
import Rooms from './components/Rooms'
import RoomDetail from './components/RoomDetail'

const TABS = [
  { id: 'leaderboard', label: 'Dashboard' },
  { id: 'rooms',       label: 'Rooms' },
  { id: 'history',     label: 'History' },
]

function Toast({ messages }) {
  return (
    <div className="toast-wrap">
      {messages.map(m => <div key={m.id} className="toast">{m.text}</div>)}
    </div>
  )
}

export default function App() {
  const [tab, setTab]                   = useState('leaderboard')
  const [selectedRoomId, setSelectedRoomId] = useState(null)
  const [toasts, setToasts]             = useState([])

  function toast(text) {
    const id = Date.now()
    setToasts(prev => [...prev, { id, text }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }

  function handleTabChange(id) {
    setTab(id)
    if (id !== 'rooms') setSelectedRoomId(null)
  }

  return (
    <div className="app">
      <nav className="nav">
        <span className="nav-logo">Mega Comp</span>
        <div className="nav-tabs">
          {TABS.map(t => (
            <button key={t.id} className={`nav-tab ${tab === t.id ? 'active' : ''}`} onClick={() => handleTabChange(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {tab === 'leaderboard' && (
        <Dashboard />
      )}

      {tab === 'rooms' && !selectedRoomId && (
        <Rooms onRoomSelect={setSelectedRoomId} onToast={toast} />
      )}

      {tab === 'rooms' && selectedRoomId && (
        <RoomDetail
          key={selectedRoomId}
          roomId={selectedRoomId}
          onBack={() => setSelectedRoomId(null)}
          onToast={toast}
        />
      )}

      {tab === 'history' && (
        <History onToast={toast} />
      )}

      <Toast messages={toasts} />
    </div>
  )
}
