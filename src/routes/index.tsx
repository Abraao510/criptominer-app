import React, { useState, useEffect } from 'react';
import { Play, Square, Database, Activity, ShieldCheck, Wallet, Terminal, Cpu } from 'lucide-react';

export default function Index() {
  const [status, setStatus] = useState('offline');
  const [logs, setLogs] = useState(['[SISTEMA] Aguardando conexão com a VPS...']);
  const [hits, setHits] = useState([]);
  const [metrics, setMetrics] = useState({ speed: 0, total: 0 });
  const [activeNetwork, setActiveNetwork] = useState('BTC');

  const networks = [
    { id: 'BTC', name: 'Bitcoin', color: 'text-orange-500', bg: 'bg-orange-500/10' },
    { id: 'ETH', name: 'Ethereum', color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { id: 'BSC', name: 'Binance Smart Chain', color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
    { id: 'SOL', name: 'Solana', color: 'text-purple-500', bg: 'bg-purple-500/10' },
  ];

  const addLog = (msg) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  };

  const handleStart = async (net) => {
    setActiveNetwork(net);
    setStatus('running');
    addLog(`Iniciando motor de brute force para ${net}...`);
    try {
      await fetch(`https://sua-vps-ip:3000/start?network=${net}`);
      addLog(`Comando enviado: ${net} ATIVADO.`);
    } catch (e) {
      addLog(`Erro ao conectar na VPS: ${e.message}`);
    }
  };

  const handleStop = async () => {
    setStatus('offline');
    addLog(`Parando todos os processos...`);
    try {
      await fetch(`https://sua-vps-ip:3000/stop`);
      addLog(`Motor desligado com sucesso.`);
    } catch (e) {
      addLog(`Erro ao parar: ${e.message}`);
    }
  };

  // Simulação de métricas para a UI não ficar vazia
  useEffect(() => {
    if (status === 'running') {
      const interval = setInterval(() => {
        setMetrics({
          speed: Math.floor(Math.random() * 5000) + 10000,
          total: prev => prev + 15000
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [status]);

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-slate-200 p-4 font-sans">
      {/* Header */}
      <div className="max-w-7xl mx-auto flex items-center justify-between mb-8 bg-[#121214] p-6 rounded-2xl border border-white/5 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-500/20">
            <ShieldCheck size={32} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">QUANTUM-BRUTE <span className="text-indigo-500">v4.5</span></h1>
            <p className="text-slate-400 text-sm flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${status === 'running' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
              Status do Motor: {status === 'running' ? 'OPERACIONAL' : 'OFFLINE'}
            </p>
          </div>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={handleStop}
            className="flex items-center gap-2 px-6 py-3 bg-red-500/10 text-red-500 rounded-xl border border-red-500/20 hover:bg-red-500 hover:text-white transition-all font-medium"
          >
            <Square size={18} /> STOP ALL
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-12 gap-6">
        
        {/* Coluna Esquerda: Controles */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          <div className="bg-[#121214] p-6 rounded-2xl border border-white/5 shadow-xl">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-white">
              <Cpu size={20} className="text-indigo-500" /> Seleção de Rede
            </h2>
            <div className="grid grid-cols-1 gap-3">
              {networks.map((net) => (
                <button
                  key={net.id}
                  onClick={() => handleStart(net.id)}
                  className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                    activeNetwork === net.id && status === 'running' 
                    ? `border-indigo-500 ${net.bg} ring-1 ring-indigo-500` 
                    : 'border-white/5 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${net.color.replace('text', 'bg')}`}></div>
                    <span className="font-medium">{net.name}</span>
                  </div>
                  <Play size={16} className={net.color} />
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#121214] p-6 rounded-2xl border border-white/5 shadow-xl">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-white">
              <Activity size={20} className="text-indigo-500" /> Performance
            </h2>
            <div className="space-y-4">
              <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                <p className="text-slate-400 text-xs uppercase font-bold mb-1">Velocidade de Geração</p>
                <p className="text-3xl font-mono font-bold text-indigo-400">{metrics.speed.toLocaleString()} <span className="text-sm text-slate-500">keys/s</span></p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                <p className="text-slate-400 text-xs uppercase font-bold mb-1">Total Processado</p>
                <p className="text-3xl font-mono font-bold text-white">{metrics.total.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Coluna Direita: Resultados e Logs */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          
          {/* Tabela de Hits */}
          <div className="bg-[#121214] rounded-2xl border border-white/5 shadow-xl overflow-hidden">
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
                <Wallet size={20} className="text-green-500" /> Carteiras Encontradas (Hits)
              </h2>
              <span className="px-3 py-1 bg-green-500/10 text-green-500 text-xs font-bold rounded-full border border-green-500/20">
                {hits.length} ENCONTRADAS
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/5 text-slate-400 text-xs uppercase">
                    <th className="p-4 font-semibold">Rede</th>
                    <th className="p-4 font-semibold">Endereço / Chave</th>
                    <th className="p-4 font-semibold text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody className="text-sm font-mono">
                  {hits.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-8 text-center text-slate-500 italic">Nenhum hit detectado no arquivo hits.txt...</td>
                    </tr>
                  ) : (
                    hits.map((hit, i) => (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="p-4"><span className="px-2 py-1 bg-white/10 rounded text-xs">{hit.net}</span></td>
                        <td className="p-4 text-slate-300 truncate max-w-xs">{hit.address}</td>
                        <td className="p-4 text-right text-green-400 font-bold">{hit.balance}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Terminal de Logs */}
          <div className="bg-black rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
            <div className="p-3 bg-[#1a1a1c] border-b border-white/10 flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500/50"></div>
                <div className="w-3 h-3 rounded-full bg-green-500/50"></div>
              </div>
              <span className="text-xs text-slate-500 font-mono ml-2 flex items-center gap-2">
                <Terminal size={12} /> system_logs.sh
              </span>
            </div>
            <div className="p-4 h-64 overflow-y-auto font-mono text-xs space-y-1 scrollbar-hide">
              {logs.map((log, i) => (
                <div key={i} className="text-green-500/80 leading-relaxed">
                  <span className="text-slate-600 mr-2">{'>'}</span> {log}
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
