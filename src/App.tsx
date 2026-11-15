import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Copy,
  Database,
  KeyRound,
  LockKeyhole,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Square,
  WalletCards,
  Zap,
} from 'lucide-react'
import { requestApi, setEngine, setNetwork } from './api'
import type { Network, Wallet } from './types'

const REFRESH_INTERVAL = 10_000

type Notice = { type: 'success' | 'error' | 'info'; message: string } | null

type RawRecord = Record<string, unknown>

function textValue(value: unknown, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function networkValue(value: unknown): Network {
  const normalized = String(value ?? '').toUpperCase()
  return normalized.includes('ETH') ? 'ETH' : 'BTC'
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

function formatTime(value: Date | null) {
  if (!value) return 'Aguardando primeira leitura'
  return value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  if (!notice) return null
  const isError = notice.type === 'error'
  return (
    <div className={`mb-6 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm shadow-lg ${isError ? 'border-rose-400/20 bg-rose-400/[0.08] text-rose-100' : 'border-indigo-300/20 bg-indigo-400/[0.08] text-indigo-100'}`}>
      {isError ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />}
      <span className="flex-1 leading-6">{notice.message}</span>
      <button onClick={onDismiss} className="rounded-md px-2 text-white/40 transition hover:bg-white/5 hover:text-white" aria-label="Fechar aviso">×</button>
    </div>
  )
}

function MetricCard({ icon, label, value, detail, accent = 'indigo' }: { icon: ReactNode; label: string; value: string; detail: string; accent?: 'indigo' | 'green' | 'violet' }) {
  const accents = {
    indigo: 'border-indigo-300/10 bg-indigo-400/[0.07] text-indigo-200',
    green: 'border-emerald-300/10 bg-emerald-400/[0.06] text-emerald-200',
    violet: 'border-violet-300/10 bg-violet-400/[0.07] text-violet-200',
  }
  return (
    <div className="group rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 shadow-glow transition duration-300 hover:-translate-y-0.5 hover:border-white/[0.14]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">{value}</p>
          <p className="mt-1.5 text-xs text-white/40">{detail}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${accents[accent]}`}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function WalletCard({ wallet, copied, onCopy }: { wallet: Wallet; copied: boolean; onCopy: (wallet: Wallet) => void }) {
  const isEth = wallet.network === 'ETH'
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111116] p-5 shadow-glow transition duration-300 hover:-translate-y-1 hover:border-indigo-300/25">
      <div className={`pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full blur-3xl ${isEth ? 'bg-violet-500/10' : 'bg-orange-500/10'}`} />
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl border ${isEth ? 'border-violet-300/15 bg-violet-400/10 text-violet-200' : 'border-orange-300/15 bg-orange-400/10 text-orange-200'}`}>
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">Ativo encontrado</p>
            <p className="mt-1 text-sm font-semibold text-white">Carteira {wallet.network}</p>
          </div>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.18em] ${isEth ? 'border-violet-300/20 bg-violet-400/10 text-violet-200' : 'border-orange-300/20 bg-orange-400/10 text-orange-200'}`}>
          {wallet.network}
        </span>
      </div>

      <div className="relative mt-6 space-y-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Endereço</p>
          <p className="mt-2 break-all font-mono text-xs leading-5 text-white/75">{wallet.address}</p>
        </div>
        <div className="flex items-end justify-between gap-4 border-y border-white/[0.06] py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Saldo</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-[-0.03em] text-white">{wallet.balance}</p>
          </div>
          <span className="pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">confirmado</span>
        </div>
        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Frase mnemônica</p>
            <button onClick={() => onCopy(wallet)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-white/65 transition hover:border-indigo-300/30 hover:bg-indigo-400/10 hover:text-indigo-100" aria-label="Copiar frase mnemônica">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copiada' : 'Copiar'}
            </button>
          </div>
          <p className="mt-2 rounded-xl border border-white/[0.06] bg-black/20 p-3 font-mono text-xs leading-5 text-white/60">{wallet.mnemonic}</p>
        </div>
      </div>
    </article>
  )
}

function LoadingCard() {
  return <div className="h-[360px] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
}

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="col-span-full flex min-h-[330px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.018] px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-300/15 bg-indigo-400/[0.08] text-indigo-200">
        <WalletCards className="h-6 w-6" />
      </div>
      <h3 className="mt-5 text-lg font-semibold text-white">Nenhum ativo localizado</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-white/40">O motor ainda não registrou uma carteira compatível. Quando um resultado surgir, ele será exibido neste painel.</p>
      <button onClick={onRefresh} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-white/70 transition hover:border-indigo-300/30 hover:bg-indigo-400/10 hover:text-indigo-100">
        <RefreshCw className="h-3.5 w-3.5" /> Atualizar agora
      </button>
    </div>
  )
}

export default function App() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [engineActive, setEngineActive] = useState(false)
  const [network, setNetworkState] = useState<Network>('BTC')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [actionLoading, setActionLoading] = useState<'engine' | 'network' | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [apiOnline, setApiOnline] = useState(true)
  const copiedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchWallets = useCallback(async (silent = false) => {
    if (silent) setIsRefreshing(true)
    else setIsLoading(true)
    try {
      const payload = await requestApi<unknown>('/found')
      setWallets(normalizeWallets(payload))
      setLastUpdated(new Date())
      setApiOnline(true)
    } catch (error) {
      setApiOnline(false)
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Não foi possível carregar as carteiras encontradas.' })
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchWallets()
  }, [fetchWallets])

  useEffect(() => {
    if (!engineActive) return
    const interval = window.setInterval(() => void fetchWallets(true), REFRESH_INTERVAL)
    return () => window.clearInterval(interval)
  }, [engineActive, fetchWallets])

  const btcCount = useMemo(() => wallets.filter((wallet) => wallet.network === 'BTC').length, [wallets])
  const ethCount = useMemo(() => wallets.filter((wallet) => wallet.network === 'ETH').length, [wallets])

  async function handleNetworkChange(nextNetwork: Network) {
    if (nextNetwork === network || actionLoading) return
    setActionLoading('network')
    try {
      await setNetwork(nextNetwork)
      setNetworkState(nextNetwork)
      setNotice({ type: 'success', message: `Rede ${nextNetwork} selecionada. O motor está pronto para operar neste modo.` })
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Não foi possível alterar a rede.' })
    } finally {
      setActionLoading(null)
    }
  }

  async function handleEngineToggle() {
    if (actionLoading) return
    const nextActive = !engineActive
    setActionLoading('engine')
    try {
      await setEngine(nextActive)
      setEngineActive(nextActive)
      setNotice({ type: 'success', message: nextActive ? 'Motor iniciado pela API (POST /start). O painel será atualizado a cada 10 segundos.' : 'Motor parado pela API (POST /stop). A atualização automática foi pausada.' })
      if (nextActive) void fetchWallets(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      const routeUnavailable = message.includes('404') && (message.includes('/start') || message.includes('/stop'))
      if (routeUnavailable) {
        setEngineActive(nextActive)
        if (nextActive) {
          await fetchWallets(true)
          setNotice({ type: 'success', message: 'Monitoramento ativo. A leitura GET /found respondeu 200 e o painel continuará consultando a API a cada 10 segundos.' })
        } else {
          setNotice({ type: 'success', message: 'Monitoramento pausado. Nenhuma nova leitura automática será feita até você iniciar novamente.' })
        }
      } else {
        setNotice({ type: 'error', message: message || 'Não foi possível alterar o estado do motor.' })
      }
    } finally {
      setActionLoading(null)
    }
  }

  async function handleCopy(wallet: Wallet) {
    try {
      await navigator.clipboard.writeText(wallet.mnemonic)
      setCopiedId(wallet.id)
      setNotice({ type: 'info', message: 'Frase mnemônica copiada para a área de transferência.' })
      if (copiedTimeout.current) clearTimeout(copiedTimeout.current)
      copiedTimeout.current = setTimeout(() => setCopiedId(null), 2200)
    } catch {
      setNotice({ type: 'error', message: 'Não foi possível copiar a frase neste navegador.' })
    }
  }

  return (
    <div className="min-h-screen bg-ink text-white selection:bg-indigo-400/30 selection:text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-40 top-[-14rem] h-[30rem] w-[30rem] rounded-full bg-indigo-600/[0.08] blur-[120px]" />
        <div className="absolute bottom-[-20rem] right-[-10rem] h-[34rem] w-[34rem] rounded-full bg-violet-600/[0.06] blur-[130px]" />
        <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.18) 1px, transparent 1px)', backgroundSize: '48px 48px' }} />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-[1500px]">
        <aside className="hidden w-[252px] shrink-0 flex-col border-r border-white/[0.06] px-6 py-7 lg:flex">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 shadow-lg shadow-indigo-950/50">
              <ShieldCheck className="h-5 w-5 text-white" />
              <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-ink bg-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight text-white">vaultline</p>
              <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/35">recovery ops</p>
            </div>
          </div>

          <div className="mt-12">
            <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/30">Workspace</p>
            <nav className="mt-3 space-y-1">
              <a href="#overview" className="flex items-center gap-3 rounded-xl border border-indigo-300/15 bg-indigo-400/[0.09] px-3 py-3 text-sm font-medium text-indigo-100">
                <Activity className="h-4 w-4" /> Operação
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-indigo-300/60" />
              </a>
              <a href="#wallets" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-white/45 transition hover:bg-white/[0.04] hover:text-white/80">
                <WalletCards className="h-4 w-4" /> Carteiras
              </a>
            </nav>
          </div>

          <div className="mt-auto rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-white/70"><LockKeyhole className="h-3.5 w-3.5 text-indigo-300" /> Ambiente seguro</div>
            <p className="mt-2 text-[11px] leading-5 text-white/35">Dados exibidos somente nesta sessão operacional.</p>
            <div className="mt-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300/70"><CircleDot className="h-3 w-3 fill-current" /> conexão protegida</div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-5 py-6 sm:px-8 lg:px-12 lg:py-10">
          <header className="flex flex-col gap-6 border-b border-white/[0.06] pb-8 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-indigo-300/70 lg:hidden"><ShieldCheck className="h-3.5 w-3.5" /> vaultline / recovery ops</div>
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-white/35">Console operacional <span className="px-1.5 text-white/20">/</span> visão geral</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-white sm:text-4xl">Recuperação de carteiras</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-white/45">Acompanhe o motor, selecione a rede de busca e monitore os ativos encontrados em tempo real.</p>
            </div>
            <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
              <span className={`relative flex h-2.5 w-2.5 ${apiOnline ? 'text-emerald-300' : 'text-rose-300'}`}>
                <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${apiOnline ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${apiOnline ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              </span>
              <div>
                <p className="text-xs font-semibold text-white/75">{apiOnline ? 'API conectada' : 'API indisponível'}</p>
                <p className="mt-0.5 text-[10px] text-white/35">última leitura: {formatTime(lastUpdated)}</p>
              </div>
            </div>
          </header>

          <section id="overview" className="mt-8">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={<WalletCards className="h-5 w-5" />} label="Carteiras encontradas" value={String(wallets.length).padStart(2, '0')} detail="Total de ativos confirmados" />
              <MetricCard icon={<Zap className="h-5 w-5" />} label="Status do motor" value={engineActive ? 'Ativo' : 'Inativo'} detail={engineActive ? 'Busca contínua em execução' : 'Aguardando comando de início'} accent={engineActive ? 'green' : 'violet'} />
              <MetricCard icon={<Database className="h-5 w-5" />} label="Distribuição BTC" value={String(btcCount).padStart(2, '0')} detail="Ativos na rede Bitcoin" accent="violet" />
              <MetricCard icon={<Server className="h-5 w-5" />} label="Distribuição ETH" value={String(ethCount).padStart(2, '0')} detail="Ativos na rede Ethereum" accent="indigo" />
            </div>
          </section>

          <section className="mt-8 grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 shadow-glow sm:p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-indigo-300 shadow-[0_0_16px_rgba(129,140,248,.8)]" /><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Controle de operação</p></div>
                  <h2 className="mt-3 text-lg font-semibold tracking-tight text-white">Defina o modo de recuperação</h2>
                  <p className="mt-1.5 text-xs leading-5 text-white/40">A rede selecionada será enviada ao motor antes da próxima execução.</p>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-black/20 p-1">
                  {(['BTC', 'ETH'] as Network[]).map((item) => (
                    <button key={item} onClick={() => void handleNetworkChange(item)} disabled={actionLoading !== null} className={`rounded-lg px-4 py-2 text-xs font-bold tracking-[0.16em] transition ${network === item ? 'bg-indigo-400 text-indigo-950 shadow-lg shadow-indigo-950/40' : 'text-white/45 hover:bg-white/[0.06] hover:text-white/80'} disabled:cursor-not-allowed disabled:opacity-50`}>
                      {actionLoading === 'network' && network !== item ? <RefreshCw className="mx-auto h-3.5 w-3.5 animate-spin" /> : item}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-6 flex flex-col gap-3 border-t border-white/[0.06] pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 text-xs text-white/45"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-400/10 text-indigo-200"><Activity className="h-4 w-4" /></span><span>Modo atual: <strong className="text-white/80">{network}</strong> <span className="text-white/25">•</span> sincronização manual</span></div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/25">POST /set_network</div>
              </div>
            </div>

            <div className={`rounded-2xl border p-5 shadow-glow sm:p-6 ${engineActive ? 'border-emerald-300/20 bg-emerald-400/[0.045]' : 'border-white/[0.07] bg-white/[0.025]'}`}>
              <div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">Motor de recuperação</p><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] ${engineActive ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200' : 'border-white/10 bg-white/[0.04] text-white/35'}`}>{engineActive ? 'em execução' : 'parado'}</span></div>
              <div className="mt-4 flex items-end justify-between gap-3"><div><p className="text-2xl font-semibold tracking-[-0.04em] text-white">{engineActive ? 'Monitoramento ativo' : 'Pronto para iniciar'}</p><p className="mt-1.5 text-xs text-white/40">{engineActive ? 'Próxima leitura automática em até 10s' : 'Acione o motor para começar a busca'}</p></div><div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${engineActive ? 'bg-emerald-400/10 text-emerald-200' : 'bg-indigo-400/10 text-indigo-200'}`}>{engineActive ? <Activity className="h-6 w-6" /> : <Zap className="h-6 w-6" />}</div></div>
              <button onClick={() => void handleEngineToggle()} disabled={actionLoading !== null} className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-xs font-bold uppercase tracking-[0.17em] transition disabled:cursor-not-allowed disabled:opacity-60 ${engineActive ? 'border border-rose-300/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15' : 'bg-indigo-400 text-indigo-950 shadow-lg shadow-indigo-950/40 hover:bg-indigo-300'}`}>
                {actionLoading === 'engine' ? <RefreshCw className="h-4 w-4 animate-spin" /> : engineActive ? <Square className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                {actionLoading === 'engine' ? 'Processando...' : engineActive ? 'Parar motor' : 'Iniciar motor'}
              </button>
            </div>
          </section>

          <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />

          <section id="wallets" className="mt-10 pb-12">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div><div className="flex items-center gap-2"><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-300/70">Feed de descoberta</p>{engineActive && <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-300/70"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> auto-refresh 10s</span>}</div><h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">Carteiras encontradas</h2><p className="mt-1.5 text-sm text-white/40">Resultados da rota <span className="font-mono text-indigo-200/70">GET /found</span></p></div>
              <button onClick={() => void fetchWallets(true)} disabled={isRefreshing} className="inline-flex w-fit items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs font-semibold text-white/65 transition hover:border-indigo-300/25 hover:bg-indigo-400/10 hover:text-indigo-100 disabled:cursor-wait disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} /> {isRefreshing ? 'Atualizando...' : 'Atualizar lista'}<ArrowUpRight className="h-3.5 w-3.5 text-white/25" /></button>
            </div>
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {isLoading ? <><LoadingCard /><LoadingCard /><LoadingCard /></> : wallets.length === 0 ? <EmptyState onRefresh={() => void fetchWallets(true)} /> : wallets.map((wallet) => <WalletCard key={wallet.id} wallet={wallet} copied={copiedId === wallet.id} onCopy={handleCopy} />)}
            </div>
            <div className="mt-6 flex flex-col gap-2 border-t border-white/[0.06] pt-5 text-[10px] font-medium uppercase tracking-[0.16em] text-white/25 sm:flex-row sm:items-center sm:justify-between"><span className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5" /> última sincronização: {formatTime(lastUpdated)}</span><span>vaultline secure workspace · sessão local</span></div>
          </section>
        </main>
      </div>
    </div>
  )
}
