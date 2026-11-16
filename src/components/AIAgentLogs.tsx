import React, { useEffect, useRef } from 'react';
import { useTourStore } from '../store/useTourStore';

export const AIAgentLogs: React.FC = () => {
  const { agentLogs } = useTourStore();
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll terminal log to bottom
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentLogs]);

  // List of agents
  const agents = [
    { name: 'Validator', role: 'Aspect Ratio & Equirectangular Check', color: 'bg-emerald-500' },
    { name: 'Extractor', role: 'EXIF, GPS & Direction Headers', color: 'bg-sky-500' },
    { name: 'Inspector', role: 'Blur, Noise & Lighting Auditor', color: 'bg-indigo-500' },
    { name: 'Detector', role: 'Visual Adjacency Predictor', color: 'bg-violet-500' },
    { name: 'Graph Gen', role: 'Bidirectional Navigation Nodes', color: 'bg-purple-500' },
    { name: 'Recommender', role: 'Hotspot Action Recommendations', color: 'bg-amber-500' },
    { name: 'Accessibility', role: 'Screen Reader & Route Audit', color: 'bg-pink-500' },
    { name: 'Optimizer', role: 'WebP Compression & Lazy Loader', color: 'bg-teal-500' },
    { name: 'SEO Gen', role: 'Meta-tags & Sitemap Generator', color: 'bg-cyan-500' },
    { name: 'Deployer', role: 'Standalone Zip Package Verifier', color: 'bg-blue-500' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[480px]">
      {/* 1. Terminal Console Window (Left 2 cols) */}
      <div className="lg:col-span-2 flex flex-col bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-red-500 block" />
            <span className="w-3 h-3 rounded-full bg-yellow-500 block" />
            <span className="w-3 h-3 rounded-full bg-green-500 block" />
            <span className="ml-2 text-xs font-mono text-slate-400">zoomio-agents-pipeline.log</span>
          </div>
          <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-800 text-brand-400 animate-pulse">
            CONNECTED
          </span>
        </div>

        {/* Console Log Lines */}
        <div className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-2.5 scrollbar-thin">
          {agentLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-2 select-none">
              <span className="text-xl">🤖</span>
              <span>AI Agents pipeline idle. Start processing images to boot.</span>
            </div>
          ) : (
            agentLogs.map((log) => {
              let textClass = 'text-slate-300';
              let badgeBg = 'bg-slate-800 text-slate-400';
              if (log.type === 'success') {
                textClass = 'text-emerald-300';
                badgeBg = 'bg-emerald-950 text-emerald-400 border border-emerald-800/30';
              } else if (log.type === 'warning') {
                textClass = 'text-amber-300';
                badgeBg = 'bg-amber-950 text-amber-400 border border-amber-800/30';
              } else if (log.type === 'error') {
                textClass = 'text-red-300';
                badgeBg = 'bg-red-950 text-red-400 border border-red-800/30';
              }

              return (
                <div key={log.id} className="flex items-start space-x-3 leading-relaxed">
                  <span className="text-[10px] text-slate-500 mt-0.5">{log.timestamp}</span>
                  <span className={`px-2 py-0.5 text-[9px] font-semibold rounded shrink-0 uppercase tracking-wider ${badgeBg}`}>
                    {log.agentName}
                  </span>
                  <span className={textClass}>{log.message}</span>
                </div>
              );
            })
          )}
          <div ref={consoleEndRef} />
        </div>
      </div>

      {/* 2. Visual Agents Network Map (Right Col) */}
      <div className="flex flex-col bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 shadow-xl">
        <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center justify-between">
          <span>AI Agents Network Mesh</span>
          <span className="text-[10px] font-normal text-slate-500">Auto-organizing flow</span>
        </h3>
        
        {/* Dynamic mesh connection representation */}
        <div className="flex-1 flex flex-col space-y-2.5 overflow-y-auto max-h-[380px] pr-1.5 scrollbar-thin">
          {agents.map((a, i) => {
            const isActive = agentLogs.some(
              (log) => log.agentName.toLowerCase().includes(a.name.toLowerCase().split(' ')[0])
            );

            return (
              <div
                key={i}
                className={`p-2.5 rounded-lg border flex items-center space-x-3 transition-all duration-300 ${
                  isActive
                    ? 'bg-slate-800/50 border-brand-500/50 shadow-md translate-x-1'
                    : 'bg-slate-900/20 border-slate-800/40 hover:bg-slate-900/40'
                }`}
              >
                <div className={`w-2.5 h-2.5 rounded-full ${a.color} ${isActive ? 'animate-ping' : ''}`} />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200">{a.name} Agent</span>
                    {isActive && (
                      <span className="text-[9px] font-medium text-brand-400 bg-brand-950 px-1.5 py-0.2 rounded border border-brand-900/50 animate-pulse">
                        RUNNING
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">{a.role}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
