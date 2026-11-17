import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "BIP39 Quantum-Brute" }],
  }),
  component: HomePage,
});

// ─── types ────────────────────────────────────────────────────────────────────

type Status = {
  running: boolean;
  network: string;
  active_network?: string;
  total: number;
  targets_loaded: number;
  bloom_hits: number;
  api_checks: number;
  confirmed: number;
  unverified: number;
};

type FoundWallet = {
  mnemonic: string;
  address: string;
  balance: number;
  network: string;
  private_key?: string | null;
  timestamp?: string | number | null;
  found_at?: string | number | null;
  created_at?: string | number | null;
};

type Coin = "BTC" | "ETH" | "BSC" | "SOL";

const FOUND_WALLETS_STORAGE_KEY = "bip39-quantum-brute:found-wallets";

function asCoin(value: unknown): Coin | null {
  const normalized = String(value ?? "").toUpperCase();
  return normalized === "BTC" ||
    normalized === "ETH" ||
    normalized === "BSC" ||
    normalized === "SOL"
    ? normalized
    : null;
}

type LogEntry = {
  id: string;
  ts: string;
  kind: "info" | "hit" | "confirm" | "warn" | "error" | "start" | "stop";
  text: string;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("pt-BR").format(n);
}

function formatBalance(balance: unknown, network: string) {
  const n = Number(balance);
  if (!Number.isFinite(n)) return "—";
  const coin = network.trim().toUpperCase();

  switch (coin) {
    case "BTC":
      return `${(n / 1e8).toFixed(8)} BTC`;
    case "ETH":
      return `${(n / 1e18).toFixed(18)} ETH`;
    case "BSC":
      return `${(n / 1e18).toFixed(18)} BNB`;
    case "SOL":
      return `${(n / 1e9).toFixed(9)} SOL`;
    default:
      return `${n} ${coin}`;
  }
}

function isBrainwallet(wallet: FoundWallet) {
  return wallet.mnemonic.trimStart().toUpperCase().startsWith("BW:");
}

function displayMnemonic(wallet: FoundWallet) {
  return isBrainwallet(wallet)
    ? wallet.mnemonic.trimStart().replace(/^BW:\s*/i, "")
    : wallet.mnemonic;
}

function walletCopyValue(wallet: FoundWallet) {
  return wallet.private_key?.trim() || wallet.mnemonic;
}

function walletKey(wallet: FoundWallet) {
  return [wallet.network, wallet.address, wallet.mnemonic, wallet.private_key ?? ""].join("|");
}

function walletDateValue(wallet: FoundWallet) {
  const raw = wallet.timestamp ?? wallet.found_at ?? wallet.created_at;
  if (raw == null || raw === "") return null;
  const numeric = typeof raw === "number" || /^\d+$/.test(String(raw)) ? Number(raw) : NaN;
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(String(raw));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatWalletDate(wallet: FoundWallet) {
  const date = walletDateValue(wallet);
  return date
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(date)
    : "—";
}

function sortWalletsNewest(items: FoundWallet[]) {
  const datedItems = items.some((item) => walletDateValue(item) != null);
  if (!datedItems) return [...items].reverse();

  return [...items].sort((a, b) => {
    const aTime = walletDateValue(a)?.getTime();
    const bTime = walletDateValue(b)?.getTime();
    if (aTime == null || bTime == null) return 0;
    return bTime - aTime;
  });
}

function now() {
  return new Date().toLocaleTimeString("pt-BR", { hour12: false });
}

let _logId = 0;
function mkLog(kind: LogEntry["kind"], text: string): LogEntry {
  const uniqueId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++_logId}`;
  return { id: uniqueId, ts: now(), kind, text };
}

// ─── component ────────────────────────────────────────────────────────────────

function HomePage() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [wallets, setWallets] = useState<FoundWallet[]>([]);
  const [walletsTotal, setWalletsTotal] = useState(0);
  const [walletsPage, setWalletsPage] = useState(1);
  const [loadingWallets, setLoadingWallets] = useState(false);
  const [action, setAction] = useState<"start" | "stop" | "reset" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectedCoin, setSelectedCoin] = useState<Coin>("BTC");
  const [networkAction, setNetworkAction] = useState<Coin | null>(null);
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [homeWalletsVisible, setHomeWalletsVisible] = useState(true);

  const prevStatusRef = useRef<Status | null>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(true);
  const walletsLoadedRef = useRef(false);
  const knownWalletsRef = useRef(new Set<string>());

  const PAGE_SIZE = 20;

  // ── log helper ──
  const addLog = useCallback((kind: LogEntry["kind"], text: string) => {
    setLogs((prev) => {
      const next = [...prev, mkLog(kind, text)];
      return next.length > 120 ? next.slice(-120) : next;
    });
  }, []);

  const unlockAudio = useCallback(() => {
    if (typeof window === "undefined") return;
    const audioWindow = window as Window &
      typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const AudioContextConstructor = window.AudioContext ?? audioWindow.webkitAudioContext;
    if (!AudioContextConstructor) return;
    audioContextRef.current ??= new AudioContextConstructor();
    void audioContextRef.current.resume();
  }, []);

  const playPositiveBalanceAlert = useCallback(() => {
    if (!soundEnabledRef.current) return;
    const context = audioContextRef.current;
    if (!context || context.state !== "running") return;

    const start = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.85, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.35);
    gain.connect(context.destination);

    for (const [frequency, offset] of [
      [880, 0],
      [1174.66, 0.18],
      [1567.98, 0.36],
    ] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(frequency, start + offset);
      oscillator.connect(gain);
      oscillator.start(start + offset);
      oscillator.stop(start + 1.35);
    }
  }, []);

  const toggleSound = () => {
    const nextEnabled = !soundEnabledRef.current;
    soundEnabledRef.current = nextEnabled;
    setSoundEnabled(nextEnabled);
    if (nextEnabled) unlockAudio();
  };

  // auto-scroll terminal
  useEffect(() => {
    const container = logsContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }, [logs]);

  // ── fetch found wallets ──
  const fetchWallets = useCallback(async (page: number): Promise<FoundWallet[]> => {
    if (!walletsLoadedRef.current) setLoadingWallets(true);
    try {
      const res = await fetch(`/api/found?page=${page}&limit=${PAGE_SIZE}`);
      if (res.ok) {
        const data = (await res.json()) as
          { total?: number; items?: FoundWallet[] } | FoundWallet[];
        const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
        const total = Array.isArray(data) ? data.length : Number(data.total ?? items.length);
        const itemKeys = items.map(walletKey);
        const hasNewWallet =
          knownWalletsRef.current.size > 0 &&
          itemKeys.some((key) => !knownWalletsRef.current.has(key));
        const newItems = items.filter((item) => !knownWalletsRef.current.has(walletKey(item)));
        if (hasNewWallet) setHomeWalletsVisible(true);
        knownWalletsRef.current = new Set([...knownWalletsRef.current, ...itemKeys]);
        const existingItems = items.filter((item) => !newItems.includes(item));
        const orderedItems = hasNewWallet
          ? [...newItems.reverse(), ...existingItems.reverse()]
          : sortWalletsNewest(items);
        setWalletsTotal(Number.isFinite(total) ? total : items.length);
        setWallets(orderedItems);
        walletsLoadedRef.current = true;
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            FOUND_WALLETS_STORAGE_KEY,
            JSON.stringify({ savedAt: new Date().toISOString(), total, items: orderedItems }),
          );
        }
        setLoadingWallets(false);
        return orderedItems;
      }
    } catch {
      // A API pode estar temporariamente indisponível; novas ações tentarão novamente.
    }
    setLoadingWallets(false);
    return [];
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = JSON.parse(
          window.localStorage.getItem(FOUND_WALLETS_STORAGE_KEY) ?? "null",
        ) as { total?: number; items?: FoundWallet[] } | null;
        if (cached && Array.isArray(cached.items)) {
          setWallets(cached.items);
          setWalletsTotal(Number(cached.total ?? cached.items.length));
          knownWalletsRef.current = new Set(cached.items.map(walletKey));
          walletsLoadedRef.current = true;
        }
      } catch {
        window.localStorage.removeItem(FOUND_WALLETS_STORAGE_KEY);
      }
    }
    void fetchWallets(1);
  }, [fetchWallets]);

  // ── SSE connection ──
  useEffect(() => {
    addLog("info", "Inicializando painel...");
    addLog("info", "Conectando ao motor BIP39...");
    let src: EventSource;

    function connect() {
      src = new EventSource("/api/events");

      src.onopen = () => {
        setConnected(true);
        addLog("info", "Conexão SSE estabelecida");
      };

      src.onerror = () => {
        setConnected(false);
        addLog("error", "SSE desconectado — reconectando em 5s...");
      };

      src.addEventListener("status", (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data) as Status;
          const activeCoin = asCoin(d.active_network ?? d.network);
          if (activeCoin) setSelectedCoin(activeCoin);
          setConnected(true);
          setStatus((prev) => {
            const old = prev;
            prevStatusRef.current = old;

            // detect changes and emit log entries
            if (old) {
              if (!old.running && d.running)
                addLog("start", "Motor INICIADO — gerando mnemonics...");
              if (old.running && !d.running) addLog("stop", "Motor PARADO");

              const newHits = d.bloom_hits - old.bloom_hits;
              if (newHits > 0)
                addLog(
                  "hit",
                  `Bloom filter: ${newHits} hit${newHits > 1 ? "s" : ""} detectado${newHits > 1 ? "s" : ""}`,
                );

              const newChecks = d.api_checks - old.api_checks;
              if (newChecks > 0 && newChecks <= 5) {
                for (let i = 0; i < newChecks; i++) {
                  addLog("info", "Verificando saldo via blockchain API...");
                }
              } else if (newChecks > 5) {
                addLog("info", `+${newChecks} verificações via blockchain API`);
              }

              const newConf = d.confirmed - old.confirmed;
              if (newConf > 0) {
                addLog(
                  "confirm",
                  `⚡ ${newConf} CARTEIRA${newConf > 1 ? "S" : ""} CONFIRMADA${newConf > 1 ? "S" : ""} COM SALDO!`,
                );
                void fetchWallets(1).then((latestWallets) => {
                  const hasPositiveBalance = latestWallets.some(
                    (wallet) => Number(wallet.balance) > 0,
                  );
                  if (hasPositiveBalance) playPositiveBalanceAlert();
                });
              }

              if (d.running && d.total > old.total) {
                const delta = d.total - old.total;
                if (delta >= 10_000) {
                  addLog("info", `+${fmt(delta)} endereços processados (total: ${fmt(d.total)})`);
                }
              }
            } else {
              addLog(
                "info",
                `Motor ${d.running ? "em execução" : "parado"} · Rede: ${d.network} · Alvo: ${fmt(d.targets_loaded)} endereços`,
              );
            }

            return d;
          });
        } catch {
          // Ignora eventos SSE malformados sem interromper o stream.
        }
      });
    }

    connect();
    return () => {
      try {
        src.close();
      } catch {
        // O EventSource já pode ter sido encerrado durante o unmount.
      }
    };
  }, [addLog, fetchWallets, playPositiveBalanceAlert]);

  // ── control actions ──
  const run = async (a: "start" | "stop" | "reset") => {
    if (action) return;
    unlockAudio();
    setAction(a);
    try {
      const res = await fetch(`/api/${a}`, { method: "POST" });
      if (res.ok) {
        if (a === "reset") {
          addLog("warn", "Contador resetado — buscando carteiras...");
          await fetchWallets(1);
        }
      } else {
        addLog("error", `Falha ao executar ação: ${a}`);
      }
    } catch {
      addLog("error", `Erro de rede ao executar: ${a}`);
    }
    setAction(null);
  };

  const selectCoin = async (coin: Coin) => {
    if (networkAction || coin === selectedCoin) return;
    setNetworkAction(coin);
    try {
      const res = await fetch("/api/network", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ network: coin }),
      });
      if (res.ok) {
        setSelectedCoin(coin);
        addLog("info", `Rede alterada para ${coin}`);
        void fetchWallets(1);
      } else {
        addLog("error", `Falha ao selecionar a rede ${coin}`);
      }
    } catch {
      addLog("error", `Erro de rede ao selecionar ${coin}`);
    }
    setNetworkAction(null);
  };

  const copy = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(address);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard pode não estar disponível fora de um contexto seguro.
    }
  };

  const running = status?.running ?? false;
  const totalPages = Math.max(1, Math.ceil(walletsTotal / PAGE_SIZE));

  // ── log line colors ──
  const logColor: Record<LogEntry["kind"], string> = {
    info: "text-slate-400",
    hit: "text-yellow-400",
    confirm: "text-emerald-400 font-bold",
    warn: "text-orange-400",
    error: "text-red-400",
    start: "text-cyan-400",
    stop: "text-slate-500",
  };

  // ── render ──
  return (
    <div className="min-h-screen bg-[#0a0c10] text-slate-200 font-mono">
      {/* ─── HEADER ─────────────────────────────────────────────────────── */}
      <header className="border-b border-white/[0.08] bg-[#0d1017] sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <span className="text-cyan-400 text-sm font-bold">₿</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-white tracking-widest uppercase">
                BIP39 Quantum-Brute
              </p>
              <p className="text-xs text-slate-600">
                {status
                  ? `Rede: ${status.network} · ${fmt(status.targets_loaded)} alvos no filtro`
                  : "Carregando..."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setWalletsOpen(true);
                setWalletsPage(1);
                void fetchWallets(1);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-1.5 text-xs text-cyan-300 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10"
            >
              <span aria-hidden="true">▣</span>
              Carteiras
              {walletsTotal > 0 && (
                <span className="rounded-full bg-cyan-400/15 px-1.5 py-0.5 text-[10px] text-cyan-200">
                  {fmt(walletsTotal)}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={toggleSound}
              aria-label={soundEnabled ? "Silenciar alerta de saldo" : "Ativar alerta de saldo"}
              title={soundEnabled ? "Alerta sonoro ativado" : "Alerta sonoro silenciado"}
              className={`rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
                soundEnabled
                  ? "border-yellow-500/25 bg-yellow-500/10 text-yellow-300 hover:bg-yellow-500/20"
                  : "border-white/10 bg-white/[0.03] text-slate-600 hover:text-slate-300"
              }`}
            >
              {soundEnabled ? "🔔" : "🔕"}
            </button>
            <span
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                connected
                  ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5"
                  : "text-red-400 border-red-500/20 bg-red-500/5"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`}
              />
              {connected ? "API ONLINE" : "DESCONECTADO"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 space-y-5">
        {/* ─── STATUS + CONTROLS ───────────────────────────────────────── */}
        <div className="rounded-xl border border-white/[0.07] bg-[#0d1017] p-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div
              className={`h-3 w-3 rounded-full flex-shrink-0 ${
                running ? "bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" : "bg-slate-600"
              }`}
            />
            <div>
              <p
                className={`text-base font-semibold ${running ? "text-emerald-300" : "text-slate-400"}`}
              >
                {running ? "● MOTOR EM EXECUÇÃO" : "○ MOTOR PARADO"}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                {running
                  ? `Processando em tempo real · ${fmt(status?.total)} endereços`
                  : "Aguardando comando de início"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="mr-1 text-[10px] uppercase tracking-widest text-slate-600">Rede</span>
            {(["BTC", "ETH", "BSC", "SOL"] as const).map((coin) => (
              <button
                key={coin}
                type="button"
                onClick={() => void selectCoin(coin)}
                disabled={networkAction !== null || action !== null}
                aria-pressed={selectedCoin === coin}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all disabled:opacity-40 ${
                  selectedCoin === coin
                    ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
                    : "border-white/10 bg-white/[0.02] text-slate-500 hover:border-white/20 hover:text-slate-300"
                }`}
              >
                {networkAction === coin ? <Spinner /> : <CoinIcon coin={coin} />}
                {coin}
              </button>
            ))}
            <button
              onClick={() => void run("start")}
              disabled={action !== null || running}
              className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-30 transition-all"
            >
              {action === "start" ? <Spinner /> : <span>▶</span>}
              INICIAR
            </button>
            <button
              onClick={() => void run("stop")}
              disabled={action !== null || !running}
              className="flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/8 px-4 py-2 text-sm text-red-300 hover:bg-red-500/15 disabled:opacity-30 transition-all"
            >
              {action === "stop" ? <Spinner /> : <span>■</span>}
              PARAR
            </button>
            <button
              onClick={() => void run("reset")}
              disabled={action !== null}
              className="flex items-center gap-2 rounded-lg border border-yellow-500/25 bg-yellow-500/8 px-4 py-2 text-sm text-yellow-300 hover:bg-yellow-500/15 disabled:opacity-30 transition-all"
            >
              {action === "reset" ? <Spinner /> : <span>↺</span>}
              RESET
            </button>
          </div>
        </div>

        {/* ─── METRICS ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            label="Endereços gerados"
            value={fmt(status?.total)}
            color="text-sky-300"
            icon="🔍"
          />
          <MetricCard
            label="Bloom filter hits"
            value={fmt(status?.bloom_hits)}
            color="text-violet-300"
            icon="🎯"
          />
          <MetricCard
            label="Checagens API"
            value={fmt(status?.api_checks)}
            color="text-blue-300"
            icon="🌐"
          />
          <MetricCard
            label="Confirmados"
            value={fmt(status?.confirmed)}
            color="text-emerald-300"
            icon="✅"
          />
        </div>

        {/* ─── TWO COLUMN LAYOUT ───────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* TERMINAL LOG */}
          <div className="lg:col-span-3 rounded-xl border border-white/[0.07] bg-[#080a0e] overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
              <span className="ml-2 text-xs text-slate-600 tracking-widest uppercase">
                terminal · logs em tempo real
              </span>
            </div>
            <div
              ref={logsContainerRef}
              className="min-h-0 max-h-72 flex-1 overflow-y-auto p-4 space-y-1 text-xs leading-relaxed lg:max-h-96"
            >
              {logs.map((l) => (
                <div key={l.id} className="flex gap-3">
                  <span className="text-slate-700 flex-shrink-0">[{l.ts}]</span>
                  <span className={logColor[l.kind]}>{l.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* SIDE STATS */}
          <div className="lg:col-span-2 space-y-3">
            <div className="rounded-xl border border-white/[0.07] bg-[#0d1017] p-4">
              <p className="text-xs text-slate-600 uppercase tracking-widest mb-3">
                Estado do motor
              </p>
              <div className="space-y-2.5">
                <StatRow
                  label="Status"
                  value={running ? "Rodando" : "Parado"}
                  valueClass={running ? "text-emerald-400" : "text-slate-500"}
                />
                <StatRow label="Rede" value={status?.network ?? "—"} valueClass="text-orange-300" />
                <StatRow label="Total processado" value={fmt(status?.total)} />
                <StatRow label="Alvos no filtro" value={fmt(status?.targets_loaded)} />
                <StatRow
                  label="Bloom hits"
                  value={fmt(status?.bloom_hits)}
                  valueClass="text-violet-400"
                />
                <StatRow
                  label="API checks"
                  value={fmt(status?.api_checks)}
                  valueClass="text-blue-400"
                />
                <StatRow
                  label="Não verificados"
                  value={fmt(status?.unverified)}
                  valueClass="text-yellow-400"
                />
                <StatRow
                  label="Confirmados"
                  value={fmt(status?.confirmed)}
                  valueClass="text-emerald-400"
                />
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.07] bg-[#0d1017] p-4">
              <p className="text-xs text-slate-600 uppercase tracking-widest mb-3">Conexão</p>
              <div className="space-y-2.5">
                <StatRow
                  label="API"
                  value={connected ? "Online" : "Offline"}
                  valueClass={connected ? "text-emerald-400" : "text-red-400"}
                />
                <StatRow
                  label="Stream"
                  value={connected ? "SSE ativo" : "Reconectando"}
                  valueClass={connected ? "text-cyan-400" : "text-orange-400"}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ─── FOUND WALLETS ───────────────────────────────────────────── */}
        <div className="rounded-xl border border-white/[0.07] bg-[#0d1017] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white tracking-wide">
                Carteiras Encontradas
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                {walletsTotal > 0
                  ? homeWalletsVisible
                    ? `${fmt(walletsTotal)} total · somente com saldo real confirmado`
                    : `${fmt(walletsTotal)} armazenada(s) no menu Carteiras`
                  : "Aguardando descobertas..."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {walletsTotal > 0 && homeWalletsVisible && (
                <span className="text-xs text-slate-600">
                  Pág {walletsPage}/{totalPages}
                </span>
              )}
              <button
                type="button"
                onClick={() => setHomeWalletsVisible(false)}
                disabled={!homeWalletsVisible || walletsTotal === 0}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-500 transition-colors hover:border-red-400/30 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Limpar da Home
              </button>
            </div>
          </div>

          {!homeWalletsVisible ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
              <span className="text-3xl opacity-20">▣</span>
              <p className="text-sm text-slate-500">Carteiras removidas da Home</p>
              <p className="text-xs text-slate-700">
                Elas continuam armazenadas no menu Carteiras. Novos achados aparecerão aqui
                automaticamente.
              </p>
            </div>
          ) : loadingWallets ? (
            <div className="flex items-center justify-center py-12 text-slate-700 text-xs">
              carregando...
            </div>
          ) : wallets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-2 text-center px-6">
              <span className="text-3xl opacity-20">₿</span>
              <p className="text-sm text-slate-600">Nenhuma carteira confirmada ainda</p>
              <p className="text-xs text-slate-700">
                Aparece aqui quando um endereço com saldo for descoberto
              </p>
            </div>
          ) : (
            <>
              <div className="max-h-96 overflow-auto">
                <table className="w-full min-w-[900px] text-xs">
                  <thead>
                    <tr className="text-slate-700 border-b border-white/[0.05]">
                      <th className="px-4 py-3 text-left font-normal">Rede</th>
                      <th className="px-4 py-3 text-left font-normal">Encontrada em</th>
                      <th className="px-4 py-3 text-left font-normal">Tipo</th>
                      <th className="px-4 py-3 text-left font-normal">Mnemonic / frase</th>
                      <th className="px-4 py-3 text-left font-normal">Chave privada</th>
                      <th className="px-4 py-3 text-left font-normal">Endereço</th>
                      <th className="px-4 py-3 text-left font-normal">Saldo</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {wallets.map((w, i) => (
                      <tr
                        key={`${w.address}-${w.mnemonic}-${i}`}
                        className="hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="px-4 py-3">
                          <span className="rounded border border-orange-400/20 bg-orange-400/8 px-2 py-0.5 text-orange-300">
                            {w.network}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                          {formatWalletDate(w)}
                        </td>
                        <td className="px-4 py-3 text-[10px] uppercase tracking-wide text-slate-500">
                          {isBrainwallet(w) ? "Brainwallet" : "BIP39"}
                        </td>
                        <td
                          className="max-w-[210px] truncate whitespace-nowrap px-4 py-3 text-slate-400"
                          title={w.mnemonic}
                        >
                          {displayMnemonic(w)}
                        </td>
                        <td
                          className="max-w-[180px] truncate whitespace-nowrap px-4 py-3 text-violet-300"
                          title={w.private_key ?? undefined}
                        >
                          {w.private_key || "—"}
                        </td>
                        <td
                          className="px-4 py-3 text-slate-500 max-w-[180px] truncate"
                          title={w.address}
                        >
                          {w.address}
                        </td>
                        <td className="px-4 py-3 text-emerald-400 font-semibold">
                          {formatBalance(w.balance, w.network || selectedCoin)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => void copy(walletCopyValue(w))}
                            className="rounded border border-white/10 bg-white/[0.03] px-3 py-1 text-slate-500 hover:text-cyan-400 hover:border-cyan-400/25 transition-colors"
                          >
                            {copied === walletCopyValue(w) ? "✓ Copiado" : "Copiar segredo"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between text-xs">
                  <button
                    onClick={() => {
                      const p = walletsPage - 1;
                      setWalletsPage(p);
                      void fetchWallets(p);
                    }}
                    disabled={walletsPage <= 1}
                    className="text-slate-600 hover:text-white disabled:opacity-30 transition-colors"
                  >
                    ← Anterior
                  </button>
                  <span className="text-slate-700">{fmt(walletsTotal)} registros</span>
                  <button
                    onClick={() => {
                      const p = walletsPage + 1;
                      setWalletsPage(p);
                      void fetchWallets(p);
                    }}
                    disabled={walletsPage >= totalPages}
                    className="text-slate-600 hover:text-white disabled:opacity-30 transition-colors"
                  >
                    Próxima →
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ─── FOOTER ──────────────────────────────────────────────────── */}
        <p className="text-center text-xs text-slate-800 pb-2">
          Stream SSE em tempo real · {connected ? "conectado" : "reconectando..."} ·
          178.95.25.53:3000
        </p>
      </main>

      {walletsOpen && (
        <div
          className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/75 px-0 py-0 backdrop-blur-sm sm:px-4 sm:py-8"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setWalletsOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallets-dialog-title"
            className="min-h-screen w-full max-w-5xl overflow-hidden border border-cyan-400/15 bg-[#0d1017] shadow-2xl shadow-black/50 sm:min-h-0 sm:rounded-2xl sm:shadow-black/50"
          >
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
              <div>
                <p
                  id="wallets-dialog-title"
                  className="text-sm font-semibold tracking-wide text-white"
                >
                  Carteiras já encontradas
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Registros recebidos da API em <code className="text-cyan-400/70">GET /found</code>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void fetchWallets(1)}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-cyan-400/30 hover:text-cyan-300"
                >
                  Atualizar
                </button>
                <button
                  type="button"
                  aria-label="Fechar carteiras encontradas"
                  onClick={() => setWalletsOpen(false)}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-lg leading-none text-slate-500 transition-colors hover:border-white/20 hover:text-white"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="grid gap-4 p-5 lg:grid-cols-[1fr_280px]">
              <div className="overflow-hidden rounded-xl border border-white/[0.07]">
                <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                  <span className="text-xs uppercase tracking-widest text-slate-500">
                    Resultados confirmados
                  </span>
                  <span className="text-xs text-emerald-400">{fmt(walletsTotal)} registro(s)</span>
                </div>
                {loadingWallets ? (
                  <div className="py-12 text-center text-xs text-slate-600">carregando...</div>
                ) : wallets.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-600">
                    Nenhuma carteira retornada pela API.
                  </div>
                ) : (
                  <div className="max-h-[58vh] space-y-2 overflow-y-auto p-3 sm:p-4">
                    {wallets.map((wallet, index) => (
                      <article
                        key={`${wallet.address}-${wallet.mnemonic}-${index}`}
                        className="rounded-xl border border-white/[0.07] bg-[#111620] p-3 transition-colors hover:border-cyan-400/20"
                      >
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="rounded-md border border-orange-400/20 bg-orange-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-orange-300">
                            {wallet.network || "—"}
                          </span>
                          <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500">
                            {isBrainwallet(wallet) ? "Brainwallet" : "BIP39"}
                          </span>
                          <span className="ml-auto text-[11px] text-slate-600">
                            {formatWalletDate(wallet)}
                          </span>
                          <strong className="text-sm font-semibold text-emerald-400">
                            {formatBalance(wallet.balance, wallet.network || selectedCoin)}
                          </strong>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="min-w-0">
                            <p className="mb-1 text-[10px] uppercase tracking-widest text-slate-600">
                              {isBrainwallet(wallet) ? "Frase brainwallet" : "Mnemonic BIP39"}
                            </p>
                            <code
                              className="block max-h-16 overflow-y-auto whitespace-normal break-words rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs leading-5 text-slate-300"
                              title={wallet.mnemonic}
                            >
                              {displayMnemonic(wallet) || "—"}
                            </code>
                          </div>
                          <div className="min-w-0">
                            <p className="mb-1 text-[10px] uppercase tracking-widest text-slate-600">
                              Chave privada
                            </p>
                            <code
                              className="block overflow-x-auto whitespace-nowrap rounded-lg border border-violet-400/10 bg-violet-400/[0.04] px-3 py-2 text-xs text-violet-300"
                              title={wallet.private_key ?? undefined}
                            >
                              {wallet.private_key || "Não informada para este achado"}
                            </code>
                          </div>
                          <div className="min-w-0 sm:col-span-2">
                            <p className="mb-1 text-[10px] uppercase tracking-widest text-slate-600">
                              Endereço
                            </p>
                            <code
                              className="block overflow-x-auto whitespace-nowrap rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-[11px] text-slate-500"
                              title={wallet.address}
                            >
                              {wallet.address || "—"}
                            </code>
                          </div>
                        </div>

                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            onClick={() => void copy(walletCopyValue(wallet))}
                            className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-1.5 text-xs text-cyan-300 transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10"
                          >
                            {copied === walletCopyValue(wallet) ? "✓ Copiado" : "Copiar segredo"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <aside className="space-y-3">
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                  <p className="mb-3 text-[10px] uppercase tracking-widest text-slate-600">
                    Estratégia observada
                  </p>
                  <p className="text-xs leading-5 text-slate-400">
                    O motor gera e verifica candidatos, aplica o filtro Bloom e consulta APIs de
                    blockchain. Este menu apenas exibe os achados persistidos pelo backend; não cria
                    nem altera carteiras.
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                  <p className="mb-3 text-[10px] uppercase tracking-widest text-slate-600">
                    Estado do motor
                  </p>
                  <div className="space-y-2 text-xs">
                    <StatRow
                      label="Status"
                      value={status?.running ? "Executando" : "Parado"}
                      valueClass={status?.running ? "text-emerald-400" : "text-slate-400"}
                    />
                    <StatRow
                      label="Rede"
                      value={status?.network ?? "—"}
                      valueClass="text-orange-300"
                    />
                    <StatRow label="Processados" value={fmt(status?.total)} />
                    <StatRow label="Bloom hits" value={fmt(status?.bloom_hits)} />
                    <StatRow
                      label="Confirmadas"
                      value={fmt(status?.confirmed)}
                      valueClass="text-emerald-400"
                    />
                  </div>
                </div>
                <p className="px-1 text-[10px] leading-4 text-slate-700">
                  Os detalhes refletem somente as respostas reais da API. Mnemonics são dados
                  sensíveis: copie apenas quando necessário.
                </p>
              </aside>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// ─── small components ─────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"
      />
    </svg>
  );
}

function CoinIcon({ coin }: { coin: Coin }) {
  if (coin === "BTC") {
    return (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="#F7931A" />
        <path
          fill="#fff"
          d="M15.6 10.1c.2-1.4-.9-2.2-2.5-2.7l.5-2-1.2-.3-.5 1.9-1-.2.5-1.9-1.2-.3-.5 2-2.4-.6-.3 1.3s.9.2.9.2c.5.1.6.4.6.7l-1.4 5.6c-.1.2-.3.5-.7.4l-.9-.2-.4 1.4 2.4.6-.5 2 1.2.3.5-2 1 .3-.5 2 1.2.3.5-2c2 .4 3.5.2 4.1-1.6.5-1.5 0-2.4-1-3 .7-.2 1.2-.8 1.3-1.8Zm-2.2 3.1c-.3 1.4-2.6.7-3.4.5l.6-2.5c.8.2 3.1.6 2.8 2Zm.4-3.2c-.3 1.3-2.2.7-2.9.5l.5-2.2c.7.2 2.7.4 2.4 1.7Z"
        />
      </svg>
    );
  }
  if (coin === "ETH") {
    return (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="#627EEA" />
        <path fill="#fff" d="m12 4.5-4.2 7.1L12 14l4.2-2.4L12 4.5Z" />
        <path fill="#fff" fillOpacity=".7" d="M7.8 12.4 12 19.5l4.2-7.1-4.2 2.4-4.2-2.4Z" />
      </svg>
    );
  }
  if (coin === "SOL") {
    return (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="#9945FF" />
        <path
          fill="#fff"
          d="M7 8.1c.2-.4.6-.6 1-.6h9c.5 0 .7.6.4.9l-1.4 1.4c-.2.2-.5.3-.8.3H6.2c-.5 0-.7-.6-.4-.9L7 8.1Zm0 4.3c.2-.4.6-.6 1-.6h9c.5 0 .7.6.4.9L16 14.1c-.2.2-.5.3-.8.3H6.2c-.5 0-.7-.6-.4-.9l1.2-1.1Zm0 4.3c.2-.4.6-.6 1-.6h9c.5 0 .7.6.4.9L16 18.4c-.2.2-.5.3-.8.3H6.2c-.5 0-.7-.6-.4-.9L7 16.7Z"
        />
      </svg>
    );
  }
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#F0B90B" d="m12 2.2 8.5 4.9v9.8L12 21.8l-8.5-4.9V7.1L12 2.2Z" />
      <path
        fill="#fff"
        d="M12 6.1 9.8 8.3l2.2 2.2 2.2-2.2L12 6.1Zm-3.2 3.2L6.6 11.5l2.2 2.2 2.2-2.2-2.2-2.2Zm6.4 0L13 11.5l2.2 2.2 2.2-2.2-2.2-2.2ZM12 13.8l-2.2 2.2 2.2 2.2 2.2-2.2-2.2-2.2Z"
      />
    </svg>
  );
}

function MetricCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: string;
  color: string;
  icon: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#0d1017] px-4 py-4">
      <div className="flex items-start justify-between">
        <p className="text-xs text-slate-600 leading-tight">{label}</p>
        <span className="text-base opacity-50">{icon}</span>
      </div>
      <p className={`text-2xl font-semibold mt-2 tracking-tight ${color}`}>{value}</p>
    </div>
  );
}

function StatRow({
  label,
  value,
  valueClass = "text-slate-300",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate-700">{label}</span>
      <span className={`text-xs font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}
