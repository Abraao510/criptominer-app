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
};

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

function satsToBtc(sats: unknown) {
  const n = Number(sats);
  if (!Number.isFinite(n)) return "—";
  return n === 0 ? "0 BTC" : `${(n / 1e8).toFixed(8)} BTC`;
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

  const prevStatusRef = useRef<Status | null>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(true);

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
    setLoadingWallets(true);
    try {
      const res = await fetch(`/api/found?page=${page}&limit=${PAGE_SIZE}`);
      if (res.ok) {
        const data = (await res.json()) as
          { total?: number; items?: FoundWallet[] } | FoundWallet[];
        const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
        const total = Array.isArray(data) ? data.length : Number(data.total ?? items.length);
        setWalletsTotal(Number.isFinite(total) ? total : items.length);
        setWallets(items);
        setLoadingWallets(false);
        return items;
      }
    } catch {
      // A API pode estar temporariamente indisponível; novas ações tentarão novamente.
    }
    setLoadingWallets(false);
    return [];
  }, []);

  useEffect(() => {
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

          <div className="flex gap-2 flex-wrap">
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
                  ? `${fmt(walletsTotal)} total · somente com saldo real confirmado`
                  : "Aguardando descobertas..."}
              </p>
            </div>
            {walletsTotal > 0 && (
              <span className="text-xs text-slate-600">
                Pág {walletsPage}/{totalPages}
              </span>
            )}
          </div>

          {loadingWallets ? (
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
                <table className="w-full min-w-[600px] text-xs">
                  <thead>
                    <tr className="text-slate-700 border-b border-white/[0.05]">
                      <th className="px-4 py-3 text-left font-normal">Rede</th>
                      <th className="px-4 py-3 text-left font-normal">Mnemonic</th>
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
                        <td
                          className="px-4 py-3 text-slate-400 max-w-[200px] truncate"
                          title={w.mnemonic}
                        >
                          {w.mnemonic}
                        </td>
                        <td
                          className="px-4 py-3 text-slate-500 max-w-[180px] truncate"
                          title={w.address}
                        >
                          {w.address}
                        </td>
                        <td className="px-4 py-3 text-emerald-400 font-semibold">
                          {satsToBtc(w.balance)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => void copy(w.mnemonic)}
                            className="rounded border border-white/10 bg-white/[0.03] px-3 py-1 text-slate-500 hover:text-cyan-400 hover:border-cyan-400/25 transition-colors"
                          >
                            {copied === w.mnemonic ? "✓ Copiado" : "Copiar"}
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
