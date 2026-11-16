import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity, AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, Cpu,
  Database, Gauge, HeartPulse, Play, Radio, RefreshCw, RotateCcw, Server, ShieldCheck,
  Square, Terminal, Trash2, WalletCards, Wifi, XCircle,
} from 'lucide-react'
import { requestApi, requestApiOptional, resetEngine, setEngine } from './api'
import type { Network, Wallet } from './types'

const FOUND_STORAGE_KEY = 'vaultline.found.wallets.v2'
const ENGINE_STORAGE_KEY = 'vaultline.engine.active.v1'
const PAGE_SIZE = 50

type Notice = { type: 'success' | 'error' | 'info'; message: string } | null
type RawRecord = Record<string, unknown>
type ConsoleLog = { time: string; tone: 'ok' | 'warn' | 'error' | 'info'; text: string }
type EngineStatus = {
  running: boolean
  network: Network | null
  total: number | null
  targetsLoaded: number | null
  bloomHits: number | null
  apiChecks: number | null
  confirmed: number | null
  unverified: number | null
}
type FoundResponse = { page: number; limit: number; total: number; items: Wallet[] }

function textValue(value: unknown, fallback = 'N/A') { return value === null || value === undefined || value === '' ? fallback : String(value) }
function numberValue(value: unknown): number | null { const n = Number(value); return value === null || value === undefined || value === '' || !Number.isFinite(n) ? null : n }
function networkValue(value: unknown): Network { return String(value ?? '').toUpperCase().includes('ETH') ? 'ETH' : 'BTC' }
function formatNumber(value: number | null) { return value === null ? 'N/A' : new Intl.NumberFormat('pt-BR').format(value) }
function formatTime(value: Date | null) { return value ? value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--' }
function satoshisToBtc(value: unknown) { const sats = numberValue(value); return sats === null ? 'N/A' : `${(sats / 100_000_000).toFixed(8)} BTC` }

function objectValue(payload: unknown): RawRecord | null { return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as RawRecord : null }

function normalizeStatus(payload: unknown): EngineStatus | null {
  const root = objectValue(payload)
  const record = objectValue(root?.status) ?? objectValue(root?.data) ?? root
  if (!record) return null
  return {
    running: Boolean(record.running ?? record.is_running ?? record.isRunning),
    network: record.network || record.mode ? networkValue(record.network ?? record.mode) : null,
    total: numberValue(record.total ?? record.total_processed),
    targetsLoaded: numberValue(record.targets_loaded ?? record.targetsLoaded),
    bloomHits: numberValue(record.bloom_hits ?? record.bloomHits),
    apiChecks: numberValue(record.api_checks ?? record.apiChecks),
    confirmed: numberValue(record.confirmed),
    unverified: numberValue(record.unverified),
  }
}

function normalizeFoundItem(item: unknown, index: number): Wallet | null {
  const record = objectValue(item)
  if (!record) return null
  const address = textValue(record.address ?? record.wallet_address ?? record.public_key, '')
  const mnemonic = textValue(record.mnemonic ?? record.seed ?? record.mnemonic_phrase, '')
  if (!address && !mnemonic) return null
  return {
    id: textValue(record.id, `${networkValue(record.network)}:${address || mnemonic}:${index}`),
    network: networkValue(record.network ?? record.currency ?? record.coin),
    address,
    mnemonic,
    balance: satoshisToBtc(record.balance),
  }
}

function normalizeFound(payload: unknown): FoundResponse {
  const root = objectValue(payload)
  const items = Array.isArray(root?.items) ? root.items : Array.isArray(payload) ? payload : []
  return {
    page: numberValue(root?.page) ?? 1,
    limit: numberValue(root?.limit) ?? PAGE_SIZE,
    total: numberValue(root?.total) ?? items.length,
    items: items.map(normalizeFoundItem).filter((item): item is Wallet => item !== null),
  }
}

function readStoredWallets(): Wallet[] {
  if (typeof window === 'undefined') return []
  try { const value = JSON.parse(window.localStorage.getItem(FOUND_STORAGE_KEY) ?? '[]'); return Array.isArray(value) ? value as Wallet[] : [] } catch { return [] }
}
function readStoredEngineState() { return typeof window !== 'undefined' && window.localStorage.getItem(ENGINE_STORAGE_KEY) === 'true' }
function walletKey(wallet: Wallet) { return `${wallet.network}:${wallet.address}` }
function mergeWallets(existing: Wallet[], incoming: Wallet[]) {
  const result = [...existing]; const keys = new Set(existing.map(walletKey))
  incoming.forEach((wallet) => { if (!keys.has(walletKey(wallet))) { result.unshift(wallet); keys.add(walletKey(wallet)) } })
  return result
}

function StatusDot({ active = true, color = 'emerald' }: { active?: boolean; color?: 'emerald' | 'yellow' | 'red' }) {
  const colors = { emerald: 'bg-emerald-400', yellow: 'bg-yellow-300', red: 'bg-red-400' }
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${colors[color]} ${active ? 'shadow-[0_0_10px_currentColor]' : 'opacity-40'}`} />
}
function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  if (!notice) return null
  const error = notice.type === 'error'
  return <div className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-xs ${error ? 'border-red-400/25 bg-red-400/[0.07] text-red-200' : 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200'}`}>
    {error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}<span className="flex-1 leading-5">{notice.message}</span><button onClick={onDismiss} className="text-white/35 hover:text-white">×</button>
  </div>
}
function Metric({ label, value, detail, icon, accent = 'blue' }: { label: string; value: string; detail: string; icon: ReactNode; accent?: 'blue' | 'green' | 'yellow' }) {
  const color = { blue: 'text-sky-300', green: 'text-emerald-300', yellow: 'text-yellow-300' }[accent]
  return <div className="terminal-card p-4"><div className="flex items-start justify-between gap-3"><div><p className="mono text-[10px] font-bold tracking-[0.18em] text-slate-500">{label}</p><p className={`mono mt-3 text-2xl font-medium tracking-tight ${color}`}>{value}</p><p className="mono mt-1 text-[9px] uppercase tracking-[0.14em] text-slate-600">{detail}</p></div><span className={`rounded-lg border border-white/[0.06] bg-black/20 p-2 ${color}`}>{icon}</span></div></div>
}
function RouteMenu() {
  const routes = [
    ['GET', '/health', 'server health'],
    ['GET', '/status', 'live scanner metrics'],
    ['POST', '/start', 'start scanner'],
    ['POST', '/stop', 'stop scanner'],
    ['POST', '/reset', 'reset counters'],
    ['GET', '/found?page=1&limit=50', 'confirmed wallets'],
    ['GET', '/unverified', 'unverified buffer'],
    ['GET', '/candidates', 'candidate counters'],
    ['GET', '/events', 'SSE status stream'],
  ] as const
  return <details className="terminal-card group mb-5 overflow-hidden"><summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3"><div className="flex items-center gap-2"><Wifi className="h-4 w-4 text-sky-300" /><p className="mono text-[11px] font-bold tracking-[0.2em] text-slate-200">API ROUTE MAP</p></div><span className="mono text-[9px] uppercase tracking-[0.16em] text-slate-600 group-open:text-sky-300">{routes.length} endpoints · expand</span></summary><div className="grid gap-2 border-t border-white/[0.07] p-3 sm:grid-cols-2 lg:grid-cols-3">{routes.map(([method, path, description]) => <a key={`${method}-${path}`} href={path.includes('/found') ? '#wallets' : path === '/unverified' ? '#unverified' : path === '/events' ? '#events' : path === '/start' || path === '/stop' || path === '/reset' ? '#controls' : '#metrics'} className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-black/15 px-3 py-2 transition hover:border-sky-300/25 hover:bg-sky-300/[0.04]"><span className={`mono w-10 text-[9px] font-bold ${method === 'POST' ? 'text-yellow-300' : 'text-sky-300'}`}>{method}</span><span className="mono min-w-0 flex-1 truncate text-[10px] text-slate-300">{path}</span><span className="mono hidden text-[9px] text-slate-600 sm:block">{description}</span></a>)}</div></details>
}
function ConsolePanel({ logs, onClear }: { logs: ConsoleLog[]; onClear: () => void }) {
  const ref = useRef<HTMLDivElement>(null); const tones = { ok: 'text-emerald-300', warn: 'text-yellow-300', error: 'text-red-300', info: 'text-sky-300' }
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [logs])
  return <section className="terminal-card flex h-[360px] flex-col overflow-hidden"><div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3"><div className="flex items-center gap-3"><Terminal className="h-4 w-4 text-sky-300" /><div><p className="mono text-[11px] font-bold tracking-[0.2em] text-slate-200">EVENT STREAM</p><p className="mono mt-1 text-[9px] uppercase tracking-[0.16em] text-slate-600">SSE /events · live session</p></div></div><div className="flex items-center gap-2"><span className="mono flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-2 py-1 text-[9px] font-bold tracking-[0.16em] text-emerald-300"><StatusDot /> LIVE</span><button onClick={onClear} className="rounded-md p-1.5 text-slate-500 hover:text-red-300" title="Limpar console"><Trash2 className="h-3.5 w-3.5" /></button></div></div><div ref={ref} className="console-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-4">{logs.length === 0 && <p className="mono text-xs text-slate-600">SSE aguardando eventos...</p>}{logs.map((log, index) => <div key={`${log.time}-${index}`} className="mono flex gap-3 text-[11px] leading-5"><span className="shrink-0 text-sky-400/70">[{log.time}]</span><span className={tones[log.tone]}>{log.text}</span></div>)}</div><div className="flex items-center gap-2 border-t border-white/[0.07] px-4 py-2.5"><span className="text-emerald-300">›</span><span className="mono text-[10px] text-slate-600">server-sent events active</span><span className="ml-auto mono text-[9px] uppercase tracking-[0.15em] text-slate-700">no polling</span></div></section>
}
function WalletTable({ wallets, total, page, pages, onPage, onCopy, copiedId, loading }: { wallets: Wallet[]; total: number; page: number; pages: number; onPage: (page: number) => void; onCopy: (wallet: Wallet) => void; copiedId: string | null; loading: boolean }) {
  return <section id="wallets" className="terminal-card overflow-hidden"><div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><WalletCards className="h-4 w-4 text-emerald-300" /><p className="mono text-[11px] font-bold tracking-[0.2em] text-slate-200">CONFIRMED WALLETS</p></div><p className="mono mt-1 text-[9px] uppercase tracking-[0.16em] text-slate-600">GET /found · {formatNumber(total)} total · {formatNumber(wallets.length)} nesta página · newest first</p></div><span className="mono rounded border border-emerald-300/20 bg-emerald-300/[0.05] px-2 py-1 text-[9px] font-bold tracking-[0.15em] text-emerald-300/80">PAGE {page}/{pages}</span></div>{loading ? <div className="p-8 text-center mono text-xs text-slate-500">LOADING /FOUND...</div> : wallets.length === 0 ? <div className="flex min-h-[150px] flex-col items-center justify-center px-6 text-center"><WalletCards className="h-7 w-7 text-slate-700" /><p className="mono mt-4 text-xs text-slate-500">NO CONFIRMED WALLETS</p></div> : <div className="max-h-[430px] overflow-auto"><table className="w-full min-w-[720px] text-left"><thead className="sticky top-0 z-10 border-b border-white/[0.05] bg-[#0b111b]"><tr className="mono text-[9px] font-bold tracking-[0.18em] text-slate-600"><th className="px-4 py-3">TYPE</th><th className="px-4 py-3">MNEMONIC</th><th className="px-4 py-3">ADDRESS</th><th className="px-4 py-3">BALANCE</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-white/[0.045]">{wallets.map((wallet) => <tr key={wallet.id} className="text-xs text-slate-400"><td className="px-4 py-4"><span className={`mono rounded border px-2 py-1 text-[10px] font-bold ${wallet.network === 'BTC' ? 'border-orange-300/20 text-orange-300' : 'border-violet-300/20 text-violet-300'}`}>{wallet.network}</span></td><td className="mono max-w-[210px] truncate px-4 py-4 text-[11px]" title={wallet.mnemonic}>{wallet.mnemonic}</td><td className="mono max-w-[220px] truncate px-4 py-4 text-[11px]" title={wallet.address}>{wallet.address}</td><td className="mono px-4 py-4 text-emerald-300/80">{wallet.balance}</td><td className="px-4 py-4 text-right"><button onClick={() => onCopy(wallet)} className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-[10px] text-slate-500 hover:border-sky-300/30 hover:text-sky-300">{copiedId === wallet.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copiedId === wallet.id ? 'COPIED' : 'COPY'}</button></td></tr>)}</tbody></table></div>}<div className="flex items-center justify-between border-t border-white/[0.07] px-4 py-3"><button onClick={() => onPage(page - 1)} disabled={page <= 1 || loading} className="inline-flex items-center gap-1 rounded border border-white/10 px-3 py-2 mono text-[10px] text-slate-500 disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /> PREV</button><span className="mono text-[10px] text-slate-600">{formatNumber(total)} record(s)</span><button onClick={() => onPage(page + 1)} disabled={page >= pages || loading} className="inline-flex items-center gap-1 rounded border border-white/10 px-3 py-2 mono text-[10px] text-slate-500 disabled:opacity-30">NEXT <ChevronRight className="h-3.5 w-3.5" /></button></div></section>
}

export default function App() {
  const [engine, setEngineState] = useState<EngineStatus>({ running: readStoredEngineState(), network: null, total: null, targetsLoaded: null, bloomHits: null, apiChecks: null, confirmed: null, unverified: null })
  const [health, setHealth] = useState<'checking' | 'online' | 'offline'>('checking')
  const [eventsConnected, setEventsConnected] = useState(false)
  const [wallets, setWallets] = useState<Wallet[]>(readStoredWallets)
  const [pageWallets, setPageWallets] = useState<Wallet[]>([])
  const [foundTotal, setFoundTotal] = useState(0)
  const [foundPage, setFoundPage] = useState(1)
  const [foundLoading, setFoundLoading] = useState(true)
  const [unverified, setUnverified] = useState<string[]>([])
  const [notice, setNotice] = useState<Notice>(null)
  const [logs, setLogs] = useState<ConsoleLog[]>([])
  const [actionLoading, setActionLoading] = useState<'start' | 'stop' | 'reset' | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [lastEvent, setLastEvent] = useState<Date | null>(null)
  const copiedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const addLog = useCallback((tone: ConsoleLog['tone'], text: string) => setLogs((current) => [...current.slice(-11), { time: formatTime(new Date()), tone, text }]), [])
  const applyStatus = useCallback((next: EngineStatus) => {
    setEngineState(next)
    if (typeof window !== 'undefined') window.localStorage.setItem(ENGINE_STORAGE_KEY, String(next.running))
    setLastEvent(new Date())
  }, [])

  const fetchHealth = useCallback(async () => {
    try { await requestApi('/health'); setHealth('online') } catch { setHealth('offline') }
  }, [])
  const fetchFound = useCallback(async (page: number) => {
    setFoundLoading(true)
    try {
      const payload = await requestApi<unknown>(`/found?page=${page}&limit=${PAGE_SIZE}`)
      const result = normalizeFound(payload)
      setPageWallets(result.items)
      setWallets((current) => { const merged = mergeWallets(current, result.items); if (typeof window !== 'undefined') window.localStorage.setItem(FOUND_STORAGE_KEY, JSON.stringify(merged)); return merged })
      setFoundTotal(result.total); setFoundPage(result.page); setHealth('online')
    } catch (error) { setHealth('offline'); addLog('error', error instanceof Error ? error.message : 'GET /found failed') } finally { setFoundLoading(false) }
  }, [addLog])
  const fetchUnverified = useCallback(async () => {
    try { const payload = await requestApi<unknown>('/unverified'); setUnverified(Array.isArray(payload) ? payload.map(String) : []); setHealth('online') } catch (error) { addLog('error', error instanceof Error ? error.message : 'GET /unverified failed') }
  }, [addLog])

  useEffect(() => { void fetchHealth(); void fetchFound(1); void fetchUnverified() }, [fetchHealth, fetchFound, fetchUnverified])

  useEffect(() => {
    const source = new EventSource('/api/events')
    const onStatus = (event: MessageEvent) => { try { const next = normalizeStatus(JSON.parse(event.data)); if (next) applyStatus(next) } catch { addLog('error', 'SSE /events enviou payload inválido') } }
    const onOpen = () => { setEventsConnected(true); setHealth('online'); addLog('ok', 'SSE /events → connected — realtime stream active') }
    const onError = () => { setEventsConnected(false); addLog('warn', 'SSE /events → conexão perdida — reconexão automática') }
    source.addEventListener('status', onStatus); source.onopen = onOpen; source.onerror = onError
    return () => { source.removeEventListener('status', onStatus); source.close() }
  }, [addLog, applyStatus])

  const control = async (action: 'start' | 'stop' | 'reset') => {
    if (actionLoading) return
    setActionLoading(action)
    try {
      if (action === 'reset') await resetEngine()
      else await setEngine(action === 'start')
      addLog('ok', `POST /${action} → 200`)
      setNotice({ type: 'success', message: action === 'reset' ? 'Contadores zerados pela API.' : `Scanner ${action === 'start' ? 'iniciado' : 'parado'} pela API.` })
      if (action === 'reset') await fetchFound(1)
    } catch (error) { addLog('error', error instanceof Error ? error.message : `POST /${action} failed`); setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Comando rejeitado pela API.' }) } finally { setActionLoading(null) }
  }
  async function handleCopy(wallet: Wallet) { try { await navigator.clipboard.writeText(wallet.mnemonic); setCopiedId(wallet.id); if (copiedTimeout.current) clearTimeout(copiedTimeout.current); copiedTimeout.current = setTimeout(() => setCopiedId(null), 2200) } catch { setNotice({ type: 'error', message: 'Não foi possível copiar.' }) } }

  const pages = Math.max(1, Math.ceil(foundTotal / PAGE_SIZE))
  const metrics = useMemo(() => [
    ['ADDRESSES PROCESSED', formatNumber(engine.total), 'GET /EVENTS', <Database className="h-4 w-4" />],
    ['BLOOM HITS', formatNumber(engine.bloomHits), 'GET /EVENTS', <Gauge className="h-4 w-4" />],
    ['API CHECKS', formatNumber(engine.apiChecks), 'GET /EVENTS', <Server className="h-4 w-4" />],
    ['CONFIRMED', formatNumber(engine.confirmed), 'GET /EVENTS', <WalletCards className="h-4 w-4" />],
  ] as const, [engine])

  return <div className="min-h-screen bg-cyber text-slate-200 selection:bg-sky-300/20"><div className="cyber-grid pointer-events-none fixed inset-0" /><div className="relative mx-auto max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
    <header className="mb-5 flex flex-col gap-4 border-b border-white/[0.07] pb-5 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-300/20 bg-sky-300/[0.08] text-sky-300"><ShieldCheck className="h-5 w-5" /></div><div><p className="mono text-sm font-bold tracking-[0.18em] text-white">VAULTLINE <span className="text-sky-300">/</span> OPS</p><p className="mono mt-1 text-[9px] uppercase tracking-[0.22em] text-slate-600">scanner operations terminal</p></div></div><div className="flex flex-wrap items-center gap-2"><span className={`mono flex items-center gap-2 rounded border px-3 py-1.5 text-[10px] ${health === 'online' ? 'border-emerald-400/20 text-emerald-300' : health === 'checking' ? 'border-yellow-400/20 text-yellow-300' : 'border-red-400/20 text-red-300'}`}><StatusDot active={health === 'online'} color={health === 'online' ? 'emerald' : health === 'checking' ? 'yellow' : 'red'} /> HEALTH {health.toUpperCase()}</span><span className={`mono flex items-center gap-2 rounded border px-3 py-1.5 text-[10px] ${eventsConnected ? 'border-sky-300/20 text-sky-300' : 'border-white/[0.08] text-slate-600'}`}><Wifi className="h-3 w-3" /> SSE {eventsConnected ? 'CONNECTED' : 'CONNECTING'}</span></div></header>
    <RouteMenu />
    <div id="controls" className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="mono text-[10px] font-bold tracking-[0.22em] text-sky-300/70">REALTIME MONITORING / {engine.network ?? 'MAINNET'}</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Recovery Operations Center</h1><p className="mono mt-2 text-[10px] text-slate-600">last event {formatTime(lastEvent)} · {eventsConnected ? 'server stream active' : 'waiting for stream'}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => void control('start')} disabled={actionLoading !== null || engine.running} className="mono inline-flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.08] px-4 py-3 text-[10px] font-bold tracking-[0.14em] text-emerald-300 disabled:opacity-40">{actionLoading === 'start' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />} START</button><button onClick={() => void control('stop')} disabled={actionLoading !== null || !engine.running} className="mono inline-flex items-center gap-2 rounded-lg border border-red-400/25 bg-red-400/[0.08] px-4 py-3 text-[10px] font-bold tracking-[0.14em] text-red-300 disabled:opacity-40">{actionLoading === 'stop' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5 fill-current" />} STOP</button><button onClick={() => void control('reset')} disabled={actionLoading !== null} className="mono inline-flex items-center gap-2 rounded-lg border border-yellow-300/20 bg-yellow-300/[0.06] px-4 py-3 text-[10px] font-bold tracking-[0.14em] text-yellow-300 disabled:opacity-40">{actionLoading === 'reset' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} RESET</button></div></div>
    <section id="metrics" className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label, value, detail, icon]) => <Metric key={label} label={label} value={value} detail={detail} icon={icon} accent={label === 'CONFIRMED' ? 'green' : 'blue'} />)}</section>
    <div id="events" className="mb-5 grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_320px]"><aside className="space-y-5"><section className="terminal-card p-4"><div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-2"><Cpu className="h-4 w-4 text-sky-300" /><p className="mono text-[11px] font-bold tracking-[0.2em] text-slate-200">ENGINE STATUS</p></div><StatusDot active={engine.running} color={engine.running ? 'emerald' : 'yellow'} /></div><div className="grid grid-cols-2 gap-3">{[['NETWORK', engine.network ?? 'N/A'], ['TARGETS', formatNumber(engine.targetsLoaded)], ['UNVERIFIED', formatNumber(engine.unverified)], ['FOUND', formatNumber(engine.confirmed)]].map(([label, value]) => <div key={label} className="rounded-lg border border-white/[0.06] bg-black/20 p-3"><p className="mono text-[9px] tracking-[0.14em] text-slate-600">{label}</p><p className="mono mt-2 text-sm text-slate-200">{value}</p></div>)}</div><p className={`mono mt-5 text-2xl ${engine.running ? 'text-emerald-300' : 'text-yellow-300'}`}>{engine.running ? 'RUNNING' : 'STANDBY'}</p></section><section className="terminal-card p-4"><div className="mb-4 flex items-center gap-2"><HeartPulse className="h-4 w-4 text-emerald-300" /><p className="mono text-[11px] font-bold tracking-[0.2em] text-slate-200">SERVER HEALTH</p></div><p className="mono text-xs text-slate-400">/health → <span className={health === 'online' ? 'text-emerald-300' : 'text-red-300'}>{health === 'online' ? '{ ok }' : health.toUpperCase()}</span></p><p className="mono mt-3 text-[10px] leading-5 text-slate-600">SSE connection keeps the dashboard synchronized without manual polling.</p></section></aside><div><ConsolePanel logs={logs} onClear={() => setLogs([])} /></div><aside><section className="terminal-card p-4"><div className="flex items-center gap-2"><Radio className="h-4 w-4 text-sky-300" /><p className="mono text-[11px] font-bold tracking-[0.2em] text-slate-200">STREAM STATUS</p></div><p className={`mono mt-6 text-2xl ${eventsConnected ? 'text-sky-300' : 'text-yellow-300'}`}>{eventsConnected ? 'LIVE' : 'WAITING'}</p><p className="mono mt-2 text-[10px] leading-5 text-slate-600">GET /events<br />status event every 1 second</p><div className="mt-5 border-t border-white/[0.07] pt-4"><p className="mono text-[9px] uppercase tracking-[0.15em] text-slate-600">UNVERIFIED BUFFER</p><p className="mono mt-2 text-xl text-yellow-300">{formatNumber(unverified.length)}</p><p className="mono mt-1 text-[9px] text-slate-700">GET /unverified</p></div></section></aside></div>
    <div className="mb-5"><WalletTable wallets={pageWallets} total={foundTotal} page={foundPage} pages={pages} onPage={(page) => { setFoundPage(page); void fetchFound(page) }} onCopy={handleCopy} copiedId={copiedId} loading={foundLoading} /></div>
    <section className="terminal-card overflow-hidden"><div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-4"><div><div className="flex items-center gap-2"><XCircle className="h-4 w-4 text-yellow-300" /><p className="mono text-[11px] font-bold tracking-[0.2em] text-slate-200">UNVERIFIED WALLETS</p></div><p className="mono mt-1 text-[9px] uppercase tracking-[0.16em] text-slate-600">GET /unverified · all six APIs failed</p></div><span className="mono text-[10px] text-yellow-300">{formatNumber(unverified.length)} ITEM(S)</span></div>{unverified.length === 0 ? <p className="p-6 mono text-xs text-slate-600">NO UNVERIFIED RECORDS</p> : <div className="max-h-64 overflow-y-auto divide-y divide-white/[0.04]">{unverified.map((item, index) => <p key={`${item}-${index}`} className="mono px-4 py-3 text-[11px] text-yellow-200/80">{item}</p>)}</div>}</section>
    <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} /><footer className="flex flex-col gap-2 border-t border-white/[0.07] py-4 mono text-[9px] uppercase tracking-[0.15em] text-slate-700 sm:flex-row sm:justify-between"><span>vaultline terminal // SSE architecture</span><span>only data returned by the connected API is displayed</span></footer>
  </div></div>
}
