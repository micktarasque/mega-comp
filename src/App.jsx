import { useState, useEffect } from 'react'
import Dashboard from './components/Dashboard'
import Rooms from './components/Rooms'
import RoomDetail from './components/RoomDetail'

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'rooms',     label: 'Rooms',     icon: '🎮' },
]

function Toast({ messages }) {
  return (
    <div className="toast-wrap">
      {messages.map(m => <div key={m.id} className="toast">{m.text}</div>)}
    </div>
  )
}

function parseHash() {
  const m = window.location.hash.match(/^#room\/(.+)$/)
  return m ? m[1] : null
}

export default function App() {
  const [tab, setTab]                   = useState(() => parseHash() ? 'rooms' : 'dashboard')
  const [selectedRoomId, setSelectedRoomId] = useState(parseHash)
  const [toasts, setToasts]             = useState([])

  useEffect(() => {
    function onHashChange() {
      const id = parseHash()
      if (id) { setTab('rooms'); setSelectedRoomId(id) }
      else { setSelectedRoomId(null) }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function openRoom(id) {
    window.location.hash = id ? `room/${id}` : ''
    setSelectedRoomId(id)
    setTab('rooms')
  }

  function toast(text) {
    const id = Date.now()
    setToasts(prev => [...prev, { id, text }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }

  function handleTabChange(id) {
    setTab(id)
    if (id !== 'rooms') { window.location.hash = ''; setSelectedRoomId(null) }
  }

  return (
    <div className="app">
      <nav className="nav">
        <span className="nav-logo">Party — Mega Comp</span>
        <div className="nav-tabs">
          {TABS.map(t => (
            <button key={t.id} className={`nav-tab ${tab === t.id ? 'active' : ''}`} onClick={() => handleTabChange(t.id)}>
              <span className="nav-tab-icon">{t.icon}</span>
              <span className="nav-tab-label">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <nav className="bottom-nav">
        {TABS.map(t => (
          <button key={t.id} className={`bottom-nav-tab ${tab === t.id ? 'active' : ''}`} onClick={() => handleTabChange(t.id)}>
            <span className="bottom-nav-icon">{t.icon}</span>
            <span className="bottom-nav-label">{t.label}</span>
          </button>
        ))}
      </nav>

      {tab === 'dashboard' && <Dashboard onRoomOpen={openRoom} />}

      {tab === 'rooms' && !selectedRoomId && (
        <Rooms onRoomSelect={openRoom} onToast={toast} />
      )}

      {tab === 'rooms' && selectedRoomId && (
        <RoomDetail
          key={selectedRoomId}
          roomId={selectedRoomId}
          onBack={() => openRoom(null)}
          onToast={toast}
        />
      )}

      <Toast messages={toasts} />
    </div>
  )
}
