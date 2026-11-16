import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Copy,
  Cpu,
  Database,
  Gauge,
  Layers3,
  LockKeyhole,
  Play,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  WalletCards,
  Zap,
} from 'lucide-react'
import { requestApi, requestApiOptional, setEngine, setNetwork } from './api'
import type { Network, Wallet } from './types'

const REFRESH_INTERVAL = 10_000
const FOUND_STORAGE_KEY = 'vaultline.found.wallets.v1'
const ENGINE_STORAGE_KEY = 'vaultline.engine.active.v1'

type Notice = { type: 'success' | 'error' | 'info'; message: string } | null
type RawRecord = Record<string, unknown>
type ConsoleLog = { time: string; tone: 'ok' | 'warn' | 'error' | 'info'; text: string }
type StatsReading = { label: string; value: string; detail: string }

function textValue(value: unknown, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function networkValue(value: unknown): Network {
  return String(value ?? '').toUpperCase().includes('ETH') ? 'ETH' : 'BTC'
}

function normalizeWallets(payload: unknown): Wallet[] {
  const source = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' && payload !== null
      ? (() => {
          const record = payload as RawRecord
          const nested = record.wallets ?? record.found ?? record.data ?? record.results
          return Array.isArray(nested) ? nested : [record]
        })()
      : []

  return source.filter((item): item is RawRecord => typeof item === 'object' && item !== null).map((item, index) => {
    const address = textValue(item.address ?? item.wallet_address ?? item.public_key ?? item.addr)
    const mnemonic = textValue(item.mnemonic ?? item.mnemonic_phrase ?? item.seed_phrase ?? item.phrase ?? item.seed)
    return {
      id: textValue(item.id, `${address}-${index}`),
      network: networkValue(item.currency ?? item.coin ?? item.network ?? item.mode ?? item.type),
      address,
      balance: textValue(item.balance ?? item.amount ?? item.value ?? item.total),
      mnemonic,
    }
  })
}

function readStoredWallets(): Wallet[] {
  if (typeof window === 'undefined') return []
  try {
    const value = JSON.parse(window.localStorage.getItem(FOUND_STORAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value as Wallet[] : []
  } catch {
    return []
  }
}

function readStoredEngineState() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(ENGINE_STORAGE_KEY) === 'true'
}

function walletKey(wallet: Wallet) {
  return `${wallet.network}:${wallet.address}`
}

function mergeWallets(existing: Wallet[], incoming: Wallet[]) {
  const merged = [...existing]
  const keys = new Set(existing.map(walletKey))
  for (const wallet of incoming) {
    if (!keys.has(walletKey(wallet))) {
      merged.unshift(wallet)
      keys.add(walletKey(wallet))
    }
  }
  return merged
}

function objectValue(payload: unknown): RawRecord | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  return payload as RawRecord
}

function normalizeStatus(payload: unknown) {
  const root = objectValue(payload)
  const record = objectValue(root?.status) ?? objectValue(root?.data) ?? root
  if (!record) return null
  return {
    attempts: record.current_attempt ?? record.currentAttempt ?? record.attempts ?? record.total,
    running: record.is_running ?? record.isRunning ?? record.running,
    network: record.network ?? record.mode,
    targetsLoaded: record.targets_loaded ?? record.targetsLoaded,
  }
}

function normalizeStats(payload: unknown) {
  const root = objectValue(payload)
  const record = objectValue(root?.stats) ?? objectValue(root?.data) ?? root
  if (!record) return null
  const count = record.target_count ?? record.targetCount ?? record.count ?? record.total
  if (count !== undefined && count !== null) {
    return { label: 'TARGET COUNT', value: textValue(count), detail: 'GET /STATS · LIVE' } satisfies StatsReading
  }
  return null
}

function normalizeCurrent(payload: unknown) {
  const root = objectValue(payload)
  const nested = root?.current ?? root?.data ?? root
  const item = Array.isArray(payload) ? payload[payload.length - 1] : nested
  const record = objectValue(item)
  if (!record) return null
  const seed = record.seed ?? record.mnemonic ?? record.mnemonic_phrase ?? record.phrase
  const address = record.address ?? record.wallet_address ?? record.public_key
  if (!seed && !address) return null
  return { seed: textValue(seed), address: textValue(address), timestamp: textValue(record.timestamp ?? record.time, '') }
}

function formatTime(value: Date | null) {
  if (!value) return '--:--:--'
  return value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function StatusDot({ active = true, color = 'emerald' }: { active?: boolean; color?: 'emerald' | 'yellow' | 'red' }) {
  const colors = { emerald: 'bg-emerald-400', yellow: 'bg-yellow-300', red: 'bg-red-400' }
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${colors[color]} ${active ? 'shadow-[0_0_10px_currentColor]' : 'opacity-40'}`} />
}

function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  if (!notice) return null
  const isError = notice.type === 'error'
  return (
    <div className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-xs ${isError ? 'border-red-400/25 bg-red-400/[0.07] text-red-200' : 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200'}`}>
      {isError ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
      <span className="flex-1 leading-5">{notice.message}</span>
      <button onClick={onDismiss} className="text-white/35 hover:text-white" aria-label="Fechar aviso">×</button>
    </div>
  )
}

function Metric({ label, value, detail, accent = 'blue', icon }: { label: string; value: string; detail: string; accent?: 'blue' | 'green' | 'yellow'; icon: ReactNode }) {
  const accentClass = { blue: 'text-sky-300', green: 'text-emerald-300', yellow: 'text-yellow-300' }[accent]
  return (
    <div className="terminal-card p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="mono text-[10px] font-bold tracking-[0.2em] text-slate-500">{label}</p>
          <p className={`mono mt-3 text-2xl font-medium tracking-tight ${accentClass}`}>{value}</p>
          <p className="mono mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-600">{detail}</p>
        </div>
        <span className={`rounded-lg border border-white/[0.06] bg-black/20 p-2 ${accentClass}`}>{icon}</span>
      </div>
    </div>
  )
}

function ConsolePanel({ logs, onClear, onRefresh }: { logs: ConsoleLog[]; onClear: () => void; onRefresh: () => void }) {
  const tone = { ok: 'text-emerald-300', warn: 'text-yellow-300', error: 'text-red-300', info: 'text-sky-300' }
  const consoleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight
  }, [logs])

  return (
    <section className="terminal-card flex h-[410px] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <div className="flex items-center gap-3"><Terminal className="h-4 w-4 text-sky-300" /><div><p className="mono text-[11px] font-bold tracking-[0.2em] text-slate-200">SYSTEM CONSOLE</p><p className="mono mt-1 text-[9px] uppercase tracking-[0.16em] text-slate-600">live API events / local session</p></div></div>
        <div className="flex items-center gap-2"><span className="mono flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-2 py-1 text-[9px] font-bold tracking-[0.16em] text-emerald-300"><StatusDot /> LIVE</span><button onClick={onRefresh} className="rounded-md p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-white" title="Atualizar a API"><RefreshCw className="h-3.5 w-3.5" /></button><button onClick={onClear} className="rounded-md p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-red-300" title="Limpar console"><Trash2 className="h-3.5 w-3.5" /></button></div>
      </div>
      <div ref={consoleRef} className="console-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {logs.length === 0 && <p className="mono text-xs text-slate-600">console cleared — waiting for events...</p>}
        {logs.map((log, index) => <div key={`${log.time}-${index}`} className="mono flex gap-3 text-[11px] leading-5"><span className="shrink-0 text-sky-400/70">[{log.time}]</span><span className={tone[log.tone]}>{log.text}</span></div>)}
      </div>
      <div className="flex items-center gap-2 border-t border-white/[0.07] px-4 py-2.5"><span className="text-emerald-300">›</span><span className="mono text-[10px] text-slate-600">awaiting command input</span><span className="ml-auto mono text-[9px] uppercase tracking-[0.15em] text-slate-700">read-only</span></div>
    </section>
  )
}

function WalletTable({ wallets, onCopy, copiedId }: { wallets: Wallet[]; onCopy: (wallet: Wallet) => void; copiedId: string | null }) {
  const liveRows = wallets.map((wallet) => ({ coin: wallet.network, phrase: wallet.mnemonic, value: wallet.balance, time: 'STORED' }))
  return (
    <section id="wallets" className="terminal-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><WalletCards className="h-4 w-4 text-emerald-300" /><p className="mono text-[11px] font-bold tracking-[0.2em] text-slate-200">RECOVERED WALLETS</p></div><p className="mono mt-1 text-[9px] uppercase tracking-[0.16em] text-slate-600">GET /found · local browser history</p></div><span className="mono rounded border border-emerald-300/20 bg-emerald-300/[0.05] px-2 py-1 text-[9px] font-bold tracking-[0.15em] text-emerald-300/80">PERSISTED</span></div>
      {liveRows.length === 0 ? <div className="flex min-h-[180px] flex-col items-center justify-center px-6 text-center"><WalletCards className="h-7 w-7 text-slate-700" /><p className="mono mt-4 text-xs text-slate-500">NO STORED RECORDS</p><p className="mono mt-2 text-[10px] text-slate-700">GET /found respondeu 200 e ainda não retornou uma carteira.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left"><thead className="border-b border-white/[0.05] bg-black/20"><tr className="mono text-[9px] font-bold tracking-[0.18em] text-slate-600"><th className="px-4 py-3">COIN</th><th className="px-4 py-3">MNEMONIC PHRASE (BIP39)</th><th className="px-4 py-3">VALUE</th><th className="px-4 py-3">TIMESTAMP</th><th className="px-4 py-3"></th></tr></thead><tbody className="divide-y divide-white/[0.045]">{liveRows.map((row, index) => <tr key={`${row.coin}-${index}`} className="group text-xs text-slate-400"><td className="px-4 py-4"><span className={`mono rounded border px-2 py-1 text-[10px] font-bold ${row.coin === 'BTC' ? 'border-orange-300/20 text-orange-300' : 'border-violet-300/20 text-violet-300'}`}>{row.coin}</span></td><td className="mono px-4 py-4 text-[11px] text-slate-400">{row.phrase}</td><td className="mono px-4 py-4 text-emerald-300/80">{row.value}</td><td className="mono px-4 py-4 text-[11px] text-slate-600">{row.time}</td><td className="px-4 py-4 text-right"><button onClick={() => onCopy(wallets[index])} className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-[10px] text-slate-500 hover:border-sky-300/30 hover:text-sky-300">{copiedId === wallets[index].id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copiedId === wallets[index].id ? 'COPIED' : 'COPY'}</button></td></tr>)}</tbody></table></div>}
    </section>
  )
}

export default function App() {
  const [wallets, setWallets] = useState<Wallet[]>(readStoredWallets)
  const [engineActive, setEngineActive] = useState(readStoredEngineState)
  const [network, setNetworkState] = useState<Network>('BTC')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [actionLoading, setActionLoading] = useState<'engine' | 'network' | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [apiOnline, setApiOnline] = useState(true)
  const [currentAttempt, setCurrentAttempt] = useState('N/A')
  const [statsReading, setStatsReading] = useState<StatsReading>({ label: 'WALLETS IN DB', value: 'N/A', detail: 'GET /STATUS · TARGETS LOADED' })
  const [statusMode, setStatusMode] = useState<Network | null>(null)
  const [logs, setLogs] = useState<ConsoleLog[]>([])
  const copiedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasTargetsLoaded = useRef(false)

  const addLog = useCallback((tone: ConsoleLog['tone'], text: string) => {
    setLogs((current) => [...current.slice(-11), { time: formatTime(new Date()), tone, text }])
  }, [])

  const fetchWallets = useCallback(async (silent = false, stopOnFound = false) => {
    if (silent) setIsRefreshing(true)
    else setIsLoading(true)
    try {
      const payload = await requestApi<unknown>('/found')
      const nextWallets = normalizeWallets(payload)
      let addedCount = 0
      setWallets((current) => {
        const merged = mergeWallets(current, nextWallets)
        addedCount = merged.length - current.length
        if (typeof window !== 'undefined') window.localStorage.setItem(FOUND_STORAGE_KEY, JSON.stringify(merged))
        return merged
      })
      setLastUpdated(new Date())
      setApiOnline(true)
      addLog(nextWallets.length ? 'ok' : 'warn', `GET /found → 200 — ${nextWallets.length} live record(s) received${addedCount ? ` · ${addedCount} new wallet(s) stored locally` : ''}`)
      if (stopOnFound && nextWallets.length > 0) {
        try {
          await setEngine(false)
          setEngineActive(false)
          if (typeof window !== 'undefined') window.localStorage.setItem(ENGINE_STORAGE_KEY, 'false')
          addLog('ok', 'FOUND detected — POST /stop → 200 — engine stopped automatically')
          setNotice({ type: 'success', message: 'Carteira encontrada, armazenada e exibida. O motor foi parado automaticamente.' })
        } catch (error) {
          addLog('error', error instanceof Error ? `FOUND detected, but automatic stop failed: ${error.message}` : 'FOUND detected, but automatic stop failed')
        }
      }
    } catch (error) {
      setApiOnline(false)
      addLog('error', error instanceof Error ? error.message : 'API connection error')
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Não foi possível carregar as carteiras encontradas.' })
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [addLog])

  const fetchStatus = useCallback(async () => {
    try {
      const payload = await requestApiOptional<unknown>('/status')
      const status = normalizeStatus(payload)
      if (!status) return
      if (status.attempts !== undefined) setCurrentAttempt(textValue(status.attempts))
      if (status.targetsLoaded !== undefined) {
        hasTargetsLoaded.current = true
        setStatsReading({ label: 'WALLETS IN DB', value: textValue(status.targetsLoaded), detail: 'GET /STATUS · TARGETS LOADED' })
      }
      if (typeof status.running === 'boolean') {
        setEngineActive(status.running)
        if (typeof window !== 'undefined') window.localStorage.setItem(ENGINE_STORAGE_KEY, String(status.running))
      }
      const nextNetwork = String(status.network ?? '').toUpperCase()
      if (nextNetwork === 'BTC' || nextNetwork === 'ETH') {
        setNetworkState(nextNetwork)
        setStatusMode(nextNetwork)
      }
    } catch (error) {
      if (error instanceof Error) addLog('error', `GET /status → ${error.message}`)
    }
  }, [addLog])

  const fetchStats = useCallback(async () => {
    try {
      const payload = await requestApiOptional<unknown>('/stats')
      const reading = normalizeStats(payload)
      if (reading !== null && !hasTargetsLoaded.current) setStatsReading(reading)
    } catch (error) {
      if (error instanceof Error && !error.message.includes('404')) addLog('error', `GET /stats → ${error.message}`)
    }
  }, [addLog])

  const fetchCurrent = useCallback(async () => {
    try {
      const payload = await requestApiOptional<unknown>('/current')
      const current = normalizeCurrent(payload)
      if (current) addLog('info', `GET /current → seed ${current.seed} · address ${current.address}${current.timestamp ? ` · ${current.timestamp}` : ''}`)
    } catch (error) {
      if (error instanceof Error) addLog('error', `GET /current → ${error.message}`)
    }
  }, [addLog])

  useEffect(() => { void fetchWallets() }, [fetchWallets])

  useEffect(() => {
    void fetchStatus()
    const interval = window.setInterval(() => void fetchStatus(), 5_000)
    return () => window.clearInterval(interval)
  }, [fetchStatus])

  useEffect(() => {
    void fetchStats()
    const interval = window.setInterval(() => void fetchStats(), 5_000)
    return () => window.clearInterval(interval)
  }, [fetchStats])

  useEffect(() => {
    if (!engineActive) return
    const interval = window.setInterval(() => {
      void fetchWallets(true, true)
      addLog('info', 'automatic polling — next GET /found scheduled in 10s')
    }, REFRESH_INTERVAL)
    return () => window.clearInterval(interval)
  }, [engineActive, fetchWallets, addLog])

  useEffect(() => {
    if (!engineActive) return
    void fetchCurrent()
    const interval = window.setInterval(() => void fetchCurrent(), 500)
    return () => window.clearInterval(interval)
  }, [engineActive, fetchCurrent])

  const btcCount = useMemo(() => wallets.filter((wallet) => wallet.network === 'BTC').length, [wallets])
  const ethCount = useMemo(() => wallets.filter((wallet) => wallet.network === 'ETH').length, [wallets])

  async function handleNetworkChange(nextNetwork: Network) {
    if (nextNetwork === network || actionLoading) return
    setActionLoading('network')
    try {
      await setNetwork(nextNetwork)
      setNetworkState(nextNetwork)
      addLog('ok', `POST /set_network → 200 — mode ${nextNetwork} synchronized`)
      setNotice({ type: 'success', message: `Rede ${nextNetwork} sincronizada pela API.` })
    } catch (error) {
      addLog('error', error instanceof Error ? error.message : 'Network sync error')
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Não foi possível alterar a rede.' })
    } finally { setActionLoading(null) }
  }

  async function handleEngineToggle() {
    if (actionLoading) return
    const nextActive = !engineActive
    setActionLoading('engine')
    try {
      await setEngine(nextActive)
      setEngineActive(nextActive)
      if (typeof window !== 'undefined') window.localStorage.setItem(ENGINE_STORAGE_KEY, String(nextActive))
      addLog('ok', `POST ${nextActive ? '/start' : '/stop'} → 200 — engine ${nextActive ? 'running' : 'stopped'}`)
      setNotice({ type: 'success', message: nextActive ? 'Motor iniciado pela API. Monitoramento real ativo a cada 10 segundos.' : 'Motor parado pela API. Atualização automática pausada.' })
      if (nextActive) void fetchWallets(true, true)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      const routeUnavailable = message.includes('404') && (message.includes('/start') || message.includes('/stop'))
      if (routeUnavailable) {
        setEngineActive(nextActive)
        if (typeof window !== 'undefined') window.localStorage.setItem(ENGINE_STORAGE_KEY, String(nextActive))
        addLog('warn', `POST ${nextActive ? '/start' : '/stop'} indisponível — usando monitoramento local`)
        if (nextActive) await fetchWallets(true)
        setNotice({ type: 'info', message: nextActive ? 'Monitoramento local ativo enquanto a rota do motor não responde.' : 'Monitoramento local pausado.' })
      } else {
        addLog('error', message || 'Engine control error')
        setNotice({ type: 'error', message: message || 'Não foi possível alterar o estado do motor.' })
      }
    } finally { setActionLoading(null) }
  }

  async function handleCopy(wallet: Wallet) {
    try {
      await navigator.clipboard.writeText(wallet.mnemonic)
      setCopiedId(wallet.id)
      setNotice({ type: 'info', message: 'Frase mnemônica copiada para a área de transferência.' })
      if (copiedTimeout.current) clearTimeout(copiedTimeout.current)
      copiedTimeout.current = setTimeout(() => setCopiedId(null), 2200)
    } catch { setNotice({ type: 'error', message: 'Não foi possível copiar a frase neste navegador.' }) }
  }

  return (
    <div className="min-h-screen bg-cyber text-slate-200 selection:bg-sky-300/20">
      <div className="cyber-grid pointer-events-none fixed inset-0" />
      <div className="relative mx-auto max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
        <header className="mb-5 flex flex-col gap-4 border-b border-white/[0.07] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-300/20 bg-sky-300/[0.08] text-sky-300"><ShieldCheck className="h-5 w-5" /></div><div><p className="mono text-sm font-bold tracking-[0.18em] text-white">VAULTLINE <span className="text-sky-300">/</span> OPS</p><p className="mono mt-1 text-[9px] uppercase tracking-[0.22em] text-slate-600">blockchain recovery terminal</p></div></div>
          <div className="flex flex-wrap items-center gap-2"><span className="mono flex items-center gap-2 rounded border border-white/[0.08] bg-black/20 px-3 py-1.5 text-[10px] text-slate-500"><StatusDot active={apiOnline} color={apiOnline ? 'emerald' : 'red'} /> API {apiOnline ? 'ONLINE' : 'OFFLINE'}</span><span className="mono text-[10px] text-slate-600">SESSION // LIVE</span></div>
        </header>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><p className="mono text-[10px] font-bold tracking-[0.22em] text-sky-300/70">MONITORING / MAINNET</p><h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Recovery Operations Center</h1></div><div className="mono flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-slate-600"><Radio className="h-3.5 w-3.5 text-emerald-300" /> secure uplink <span className="text-slate-800">|</span> {formatTime(lastUpdated)}</div></div>

        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="CHAIN SYNC" value="N/A" detail="NOT EXPOSED BY API" icon={<Layers3 className="h-4 w-4" />} />
          <Metric label={statsReading.label} value={statsReading.value} detail={statsReading.detail} icon={<Gauge className="h-4 w-4" />} />
          <Metric label="NODE HEALTH" value="N/A" detail="NOT EXPOSED BY API" icon={<Server className="h-4 w-4" />} />
          <Metric label="SEED WINDOW" value="N/A" detail="NOT EXPOSED BY API" icon={<Zap className="h-4 w-4" />} />
        </section>

        <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
          <aside className="space-y-5">
            <section className="terminal-card p-4"><div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-2"><Cpu className="h-4 w-4 text-sky-300" /><p className="mono text-[11px] font-bold tracking-[0.2em] text-slate-200">ENGINE CONTROL</p></div><span className="mono text-[9px] text-slate-600">LIVE API</span></div><div className="grid grid-cols-2 gap-3">{[['ATTEMPTS', currentAttempt], ['HASH RATE', 'N/A'], ['FOUND', String(wallets.length)], ['PROFIT', 'N/A']].map(([label, value]) => <div key={label} className="rounded-lg border border-white/[0.06] bg-black/20 p-3"><p className="mono text-[9px] tracking-[0.14em] text-slate-600">{label}</p><p className="mono mt-2 text-sm text-slate-200">{value}</p></div>)}</div><div className="mt-5"><div className="mb-2 flex justify-between"><span className="mono text-[9px] tracking-[0.15em] text-slate-500">RECOVERY PRESSURE</span><span className="mono text-[10px] text-slate-500">N/A</span></div><div className="h-1.5 rounded-full bg-white/[0.07]" /></div><button onClick={() => void handleEngineToggle()} disabled={actionLoading !== null} className={`mono mt-5 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-3 text-[10px] font-bold tracking-[0.16em] transition disabled:opacity-50 ${engineActive ? 'border-red-400/30 bg-red-400/10 text-red-300 hover:bg-red-400/20' : 'border-sky-300/20 bg-sky-300/[0.08] text-sky-300 hover:bg-sky-300/[0.14]'}`}>{actionLoading === 'engine' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : engineActive ? <Square className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}{actionLoading === 'engine' ? 'PROCESSING...' : engineActive ? 'STOP ENGINE' : 'START ENGINE'}</button></section>
            <section className="terminal-card p-4"><div className="mb-4 flex items-center gap-2"><Database className="h-4 w-4 text-slate-400" /><p className="mono text-[11px] font-bold tracking-[0.2em] text-slate-200">DATA SOURCE</p></div><div className="space-y-3 mono text-[10px]">{[['Endpoint', 'API /found', 'sky'], ['Records', String(wallets.length), 'emerald'], ['Latency', 'N/A', 'yellow'], ['Transport', 'HTTPS', 'emerald']].map(([label, value, color]) => <div key={label} className="flex items-center justify-between border-b border-white/[0.04] pb-2 last:border-0"><span className="text-slate-600">{label}</span><span className={`flex items-center gap-2 ${color === 'yellow' ? 'text-yellow-300' : color === 'sky' ? 'text-sky-300' : 'text-emerald-300'}`}><StatusDot color={color === 'yellow' ? 'yellow' : 'emerald'} />{value}</span></div>)}</div></section>
          </aside>

          <div className="space-y-5">
            <ConsolePanel logs={logs} onClear={() => setLogs([])} onRefresh={() => void fetchWallets(true)} />
            <section className="terminal-card p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-sky-300" /><p className="mono text-[11px] font-bold tracking-[0.2em] text-slate-200">NETWORK SELECTOR</p></div><p className="mono mt-1 text-[9px] uppercase tracking-[0.15em] text-slate-600">POST /set_network · current mode: {statusMode ?? network}</p></div><div className="flex gap-2">{(['BTC', 'ETH'] as Network[]).map((item) => <button key={item} onClick={() => void handleNetworkChange(item)} disabled={actionLoading !== null} className={`mono rounded border px-5 py-2 text-[10px] font-bold tracking-[0.18em] transition disabled:opacity-50 ${network === item ? 'border-sky-300/40 bg-sky-300/15 text-sky-200' : 'border-white/[0.08] text-slate-500 hover:border-sky-300/25 hover:text-slate-200'}`}>{actionLoading === 'network' && network !== item ? '...' : item}</button>)}</div></div></section>
          </div>

          <aside><div className="terminal-card p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-emerald-300" /><p className="mono text-[11px] font-bold tracking-[0.2em] text-slate-200">CLOUD ENGINE</p></div><StatusDot active={engineActive} color={engineActive ? 'emerald' : 'yellow'} /></div><p className={`mono mt-6 text-2xl ${engineActive ? 'text-emerald-300' : 'text-yellow-300'}`}>{engineActive ? 'RUNNING' : 'STANDBY'}</p><p className="mono mt-2 text-[10px] leading-5 text-slate-600">{engineActive ? 'server running · restored from GET /status' : 'server awaiting start command'}</p></div></aside>
        </div>

        <div className="mt-5"><WalletTable wallets={wallets} onCopy={handleCopy} copiedId={copiedId} /></div>
        <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
        <footer className="flex flex-col gap-2 border-t border-white/[0.07] py-4 mono text-[9px] uppercase tracking-[0.15em] text-slate-700 sm:flex-row sm:justify-between"><span>vaultline terminal // secure workspace</span><span>only responses from the connected API are displayed</span></footer>
      </div>
    </div>
  )
}
