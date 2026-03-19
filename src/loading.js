// Global loading signal — framework-free so supabaseDb.js can import it safely.
let _count = 0
const _cbs = new Set()

function notify() { _cbs.forEach(fn => fn(_count > 0)) }

export function startLoad() { _count++; notify() }
export function endLoad()   { _count = Math.max(0, _count - 1); notify() }
export function onLoad(fn)  { _cbs.add(fn); return () => _cbs.delete(fn) }
