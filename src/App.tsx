import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Check, Play, Square, RotateCcw, Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { requestApi, resetEngine, setEngine } from './api'
import type { Wallet } from './types'

const FOUND_STORAGE_KEY = 'vaultline.found.v3'
const PAGE_SIZE = 50

type Status = {
  running: boolean
  total: number
  targets_loaded: number
  bloom_hits: number
  api_checks: number
  confirmed: number
  unverified: number
}

function readStored(): Wallet[] {
  try {
    const v = localStorage.getItem(FOUND_STORAGE_KEY)
    const parsed = JSON.parse(v ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function satsToBtc(sats: unknown) {
  const n = Number(sats)
  if (!Number.isFinite(n)) return '—'
  return n === 0 ? '0 BTC' : `${(n / 1e8).toFixed(8)} BTC`
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return new Intl.NumberFormat('pt-BR').format(n)
}

function normalizeFound(payload: unknown): { total: number; items: Wallet[] } {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null
  const rawItems = Array.isArray(record?.items)
    ? record.items
    : Array.isArray(payload)
      ? payload
      : []
  const items = rawItems.filter((item): item is Wallet => Boolean(item && typeof item === 'object'))
  const total = typeof record?.total === 'number' ? record.total : items.length
  return { total, items }
}

export default function App() {
  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [wallets, setWallets] = useState<Wallet[]>(readStored)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loadingPage, setLoadingPage] = useState(false)
  const [action, setAction] = useState<'start' | 'stop' | 'reset' | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const copiedRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchPage = useCallback(async (p: number) => {
    setLoadingPage(true)
    try {
      const payload = await requestApi<unknown>(`/found?page=${p}&limit=${PAGE_SIZE}`)
      const res = normalizeFound(payload)
      setTotal(res.total)
      setWallets(prev => {
        const existing = new Map(prev.map(w => [w.address, w]))
        for (const w of res.items) existing.set(w.address, w)
        const merged = Array.from(existing.values())
        try { localStorage.setItem(FOUND_STORAGE_KEY, JSON.stringify(merged)) } catch {}
        return merged
      })
    } catch {}
    setLoadingPage(false)
  }, [])

  useEffect(() => { void fetchPage(1) }, [fetchPage])

  useEffect(() => {
    const src = new EventSource('/api/events')
    src.onopen = () => setConnected(true)
    src.onerror = () => setConnected(false)
    src.addEventListener('status', (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data) as Status
        setStatus(d)
        setConnected(true)
      } catch {}
    })
    return () => src.close()
  }, [])

  const run = async (a: 'start' | 'stop' | 'reset') => {
    if (action) return
    setAction(a)
    try {
      if (a === 'reset') { await resetEngine(); await fetchPage(1) }
      else await setEngine(a === 'start')
    } catch {}
    setAction(null)
  }

  const copy = async (w: Wallet) => {
    try {
      await navigator.clipboard.writeText(w.mnemonic)
      setCopied(w.id)
      if (copiedRef.current) clearTimeout(copiedRef.current)
      copiedRef.current = setTimeout(() => setCopied(null), 2000)
    } catch {}
  }

  const running = status?.running ?? false
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageItems = wallets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="min-h-screen bg-[#0a0c10] text-slate-200">
      {/* Header */}
      <div className="border-b border-white/[0.08] bg-[#0d1017]">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-white tracking-wide">Bitcoin Scanner</p>
            <p className="text-xs text-slate-500 mt-0.5">BIP39 · {fmt(status?.targets_loaded)} endereços no filtro</p>
          </div>
          <div className="flex items-center gap-2">
            {connected
              ? <span className="flex items-center gap-1.5 text-xs text-emerald-400"><Wifi className="h-3.5 w-3.5" /> Online</span>
              : <span className="flex items-center gap-1.5 text-xs text-red-400"><WifiOff className="h-3.5 w-3.5" /> Offline</span>
            }
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
        {/* Status + Controles */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#0d1017] p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2.5">
              <span className={`h-2.5 w-2.5 rounded-full ${running ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-slate-600'}`} />
              <span className={`text-xl font-semibold ${running ? 'text-emerald-300' : 'text-slate-400'}`}>
                {running ? 'Rodando' : 'Parado'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1 ml-5">
              {running ? 'Gerando e verificando carteiras...' : 'Clique em Iniciar para começar'}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => void run('start')}
              disabled={action !== null || running}
              className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-30 transition"
            >
              {action === 'start' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
              Iniciar
            </button>
            <button
              onClick={() => void run('stop')}
              disabled={action !== null || !running}
              className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2 text-sm text-red-300 hover:bg-red-500/20 disabled:opacity-30 transition"
            >
              {action === 'stop' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4 fill-current" />}
              Parar
            </button>
            <button
              onClick={() => void run('reset')}
              disabled={action !== null}
              className="flex items-center gap-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-4 py-2 text-sm text-yellow-300 hover:bg-yellow-500/20 disabled:opacity-30 transition"
            >
              {action === 'reset' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Resetar
            </button>
          </div>
        </div>

        {/* Métricas */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {([
            { label: 'Endereços verificados', value: fmt(status?.total), color: 'text-sky-300' },
            { label: 'Bloom hits', value: fmt(status?.bloom_hits), color: 'text-violet-300' },
            { label: 'Checagens API', value: fmt(status?.api_checks), color: 'text-blue-300' },
            { label: 'Confirmados', value: fmt(status?.confirmed), color: 'text-emerald-300' },
          ] as const).map(m => (
            <div key={m.label} className="rounded-2xl border border-white/[0.08] bg-[#0d1017] px-5 py-4">
              <p className="text-xs text-slate-500">{m.label}</p>
              <p className={`text-2xl font-semibold mt-2 ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>

        {/* Tabela de carteiras encontradas */}
        <div className="rounded-2xl border border-white/[0.08] bg-[#0d1017] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Carteiras Encontradas</p>
              <p className="text-xs text-slate-500 mt-0.5">{fmt(total)} total · somente com saldo real</p>
            </div>
            {total > 0 && (
              <span className="text-xs text-slate-500">Pág. {page}/{pages}</span>
            )}
          </div>

          {loadingPage ? (
            <div className="flex items-center justify-center py-16 text-slate-600 text-sm">Carregando...</div>
          ) : pageItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
              <div className="h-10 w-10 rounded-full bg-white/[0.04] flex items-center justify-center">
                <svg className="h-5 w-5 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 104.5 4.5a7.5 7.5 0 0012.15 12.15z" />
                </svg>
              </div>
              <p className="text-sm text-slate-500">Nenhuma carteira confirmada ainda</p>
              <p className="text-xs text-slate-700">Aparece aqui quando um endereço com saldo for encontrado</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-xs text-slate-600 border-b border-white/[0.05]">
                      <th className="px-5 py-3 text-left font-medium">Rede</th>
                      <th className="px-5 py-3 text-left font-medium">Frase mnemônica</th>
                      <th className="px-5 py-3 text-left font-medium">Endereço</th>
                      <th className="px-5 py-3 text-left font-medium">Saldo</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {pageItems.map(w => (
                      <tr key={w.id} className="hover:bg-white/[0.02] transition">
                        <td className="px-5 py-4">
                          <span className="rounded-md bg-orange-400/10 border border-orange-400/20 px-2 py-0.5 text-xs font-semibold text-orange-300">
                            {w.network}
                          </span>
                        </td>
                        <td className="px-5 py-4 font-mono text-xs text-slate-300 max-w-[240px] truncate" title={w.mnemonic}>
                          {w.mnemonic}
                        </td>
                        <td className="px-5 py-4 font-mono text-xs text-slate-400 max-w-[200px] truncate" title={w.address}>
                          {w.address}
                        </td>
                        <td className="px-5 py-4 text-xs font-semibold text-emerald-400">
                          {satsToBtc(w.balance)}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button
                            onClick={() => void copy(w)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-400 hover:text-sky-300 hover:border-sky-300/30 transition"
                          >
                            {copied === w.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            {copied === w.id ? 'Copiado' : 'Copiar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="px-5 py-3 border-t border-white/[0.07] flex items-center justify-between">
                  <button
                    onClick={() => { setPage(p => p - 1); void fetchPage(page - 1) }}
                    disabled={page <= 1}
                    className="text-xs text-slate-500 hover:text-white disabled:opacity-30 transition"
                  >
                    ← Anterior
                  </button>
                  <span className="text-xs text-slate-600">{fmt(total)} registros</span>
                  <button
                    onClick={() => { setPage(p => p + 1); void fetchPage(page + 1) }}
                    disabled={page >= pages}
                    className="text-xs text-slate-500 hover:text-white disabled:opacity-30 transition"
                  >
                    Próxima →
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Rodapé */}
        <p className="text-center text-xs text-slate-700 pb-4">
          Atualizado via SSE em tempo real · {connected ? 'conectado' : 'reconectando...'}
        </p>
      </div>
    </div>
  )
}
