import React, { useState, useRef, useEffect } from 'react';
import {
  X, Sparkles, Send, Settings, Loader2, Check, RefreshCw,
  Wand2, Link2, MessageCircle, FileText, AlertCircle, Key, ChevronDown
} from 'lucide-react';
import {
  analyzeScene, suggestHotspots, generateNarration,
  generateWelcomeMessage, askAI, saveAIConfig, loadAIConfig,
  type AIProvider
} from '../utils/aiService';
import type { Scene } from '../types/tour';

interface AIPanelProps {
  onClose: () => void;
  activeScene: Scene;
  allScenes: Scene[];
  projectName: string;
  projectCategory: string;
  projectLocation: string;
  onApplySceneAnalysis: (name: string, description: string) => void;
  onApplyNarration: (text: string) => void;
  onApplyHotspots: (suggestions: any[]) => void;
}

type AIChatMessage = { role: 'user' | 'ai'; text: string; ts: number };

export const AIPanel: React.FC<AIPanelProps> = ({
  onClose,
  activeScene,
  allScenes,
  projectName,
  projectCategory,
  projectLocation,
  onApplySceneAnalysis,
  onApplyNarration,
  onApplyHotspots,
}) => {
  const [tab, setTab] = useState<'features' | 'chat' | 'settings'>('features');
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error,  setError  ] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<AIChatMessage[]>([
    { role: 'ai', text: '👋 Hi! I\'m your AI tour assistant. Ask me anything about creating your virtual tour — hotspot placement, lighting tips, navigation design, and more!', ts: Date.now() },
  ]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  /* ── AI Config ── */
  const [provider, setProvider]   = useState<AIProvider>(loadAIConfig()?.provider || 'gemini');
  const [apiKey,   setApiKey  ]   = useState(loadAIConfig()?.apiKey   || '');
  const [model,    setModel   ]   = useState(loadAIConfig()?.model    || '');
  const [keySaved, setKeySaved]   = useState(!!loadAIConfig()?.apiKey);

  const hasKey = !!loadAIConfig()?.apiKey;

  const saveKey = () => {
    saveAIConfig({ provider, apiKey: apiKey.trim(), model: model.trim() || undefined });
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const run = async (name: string, fn: () => Promise<string | any[]>) => {
    setLoading(name);
    setError(null);
    setResult(null);
    try {
      const res = await fn();
      if (Array.isArray(res)) setSuggestions(res as any[]);
      else setResult(res as string);
    } catch (e: any) {
      setError(e.message || 'AI request failed.');
    } finally {
      setLoading(null);
    }
  };

  const handleAnalyzeScene = () =>
    run('analyze', () => analyzeScene(activeScene.imageUrl).then(r => {
      onApplySceneAnalysis(r.name, r.description);
      return `✅ Scene renamed to "${r.name}"\n\nDescription: ${r.description}\n\nAlt text: ${r.altText}`;
    }));

  const handleSuggestHotspots = () =>
    run('suggest', () => suggestHotspots(allScenes.map(s => ({ id: s.id, name: s.name, description: s.description }))));

  const handleGenerateNarration = () =>
    run('narration', () => generateNarration(activeScene.name, activeScene.description || '', projectName));

  const handleWelcomeMessage = () =>
    run('welcome', () => generateWelcomeMessage(projectName, projectCategory, projectLocation));

  const handleChat = async () => {
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatMessages(m => [...m, { role: 'user', text: msg, ts: Date.now() }]);
    try {
      const res = await askAI(msg, `${projectName} (${projectCategory}, ${projectLocation})`);
      setChatMessages(m => [...m, { role: 'ai', text: res, ts: Date.now() }]);
    } catch (e: any) {
      setChatMessages(m => [...m, { role: 'ai', text: `❌ ${e.message}`, ts: Date.now() }]);
    }
  };

  /* ── UI ── */
  return (
    <div className="fixed inset-0 z-[9000] flex items-stretch justify-end pointer-events-none">
      <div className="pointer-events-auto w-[380px] h-full flex flex-col shadow-2xl"
        style={{ background: '#0d1117', borderLeft: '1px solid rgba(0,212,255,0.18)' }}>

        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-slate-800/80"
          style={{ background: 'linear-gradient(135deg, rgba(0,212,255,0.08), rgba(99,102,241,0.08))' }}>
          <Sparkles size={16} className="text-cyan-400" />
          <span className="font-bold text-white text-sm flex-1">AI Assistant</span>
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full text-cyan-300"
            style={{ background: 'rgba(0,212,255,0.15)', border: '1px solid rgba(0,212,255,0.3)' }}>
            {loadAIConfig()?.provider?.toUpperCase() || 'NO KEY'}
          </span>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800/80">
          {[
            { id: 'features', icon: Wand2,         label: 'AI Tools' },
            { id: 'chat',     icon: MessageCircle,  label: 'Chat' },
            { id: 'settings', icon: Settings,       label: 'Settings' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-bold transition-all ${
                tab === t.id ? 'text-cyan-400 border-b-2 border-cyan-500' : 'text-slate-500 hover:text-slate-300'
              }`}>
              <t.icon size={11} />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── FEATURES TAB ── */}
        {tab === 'features' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {!hasKey && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl"
                style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
                <AlertCircle size={14} className="text-yellow-400 shrink-0 mt-0.5" />
                <div className="text-xs text-yellow-200/80">
                  Add your <strong>Gemini API key</strong> in the Settings tab to enable AI features.
                  <button onClick={() => setTab('settings')} className="ml-1 text-yellow-400 underline">Open Settings →</button>
                </div>
              </div>
            )}

            {/* Analyze Scene */}
            <AIFeatureCard
              icon="🔍" title="Analyze Scene" color="#00d4ff"
              description="AI reads your panorama image and automatically sets the scene name, description, and accessibility alt text."
              onRun={handleAnalyzeScene}
              loading={loading === 'analyze'}
              disabled={!hasKey}
            />

            {/* Suggest Hotspots */}
            <AIFeatureCard
              icon="🔗" title="Auto-Connect Rooms" color="#a78bfa"
              description={`AI suggests navigation hotspot connections between all ${allScenes.length} rooms based on their names and layout.`}
              onRun={handleSuggestHotspots}
              loading={loading === 'suggest'}
              disabled={!hasKey || allScenes.length < 2}
            />

            {/* Narration */}
            <AIFeatureCard
              icon="🗣️" title="Generate Narration" color="#34d399"
              description={`Write engaging tour guide narration for "${activeScene.name}" that visitors will hear when they enter.`}
              onRun={handleGenerateNarration}
              loading={loading === 'narration'}
              disabled={!hasKey}
            />

            {/* Welcome message */}
            <AIFeatureCard
              icon="👋" title="Write Welcome Message" color="#f472b6"
              description={`Create a professional welcome/intro message for the "${projectName}" tour.`}
              onRun={handleWelcomeMessage}
              loading={loading === 'welcome'}
              disabled={!hasKey}
            />

            {/* Result box */}
            {result && (
              <div className="rounded-xl p-4" style={{ background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.2)' }}>
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-2">AI Result</div>
                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{result}</p>
                {(loading === 'narration' || loading === null) && result.length > 20 && (
                  <button onClick={() => onApplyNarration(result)}
                    className="mt-2 text-[10px] font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                    <Check size={10} /> Apply as Narration Text
                  </button>
                )}
              </div>
            )}

            {/* Hotspot suggestions */}
            {suggestions.length > 0 && (
              <div className="rounded-xl p-4" style={{ background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)' }}>
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-2">
                  {suggestions.length} Hotspot Suggestions
                </div>
                {suggestions.map((s, i) => {
                  const from = allScenes.find(sc => sc.id === s.fromSceneId);
                  const to   = allScenes.find(sc => sc.id === s.toSceneId);
                  return (
                    <div key={i} className="py-2 border-b border-slate-800/50 last:border-0 text-xs">
                      <div className="text-white font-medium">{from?.name} → {to?.name}</div>
                      <div className="text-slate-500 text-[10px]">{s.label} · {s.reason}</div>
                    </div>
                  );
                })}
                <button onClick={() => { onApplyHotspots(suggestions); setSuggestions([]); }}
                  className="mt-3 w-full py-2 rounded-lg text-[10px] font-bold text-purple-300 flex items-center justify-center gap-1.5"
                  style={{ background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.3)' }}>
                  <Check size={10} /> Apply All Connections
                </button>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <AlertCircle size={13} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300/80">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* ── CHAT TAB ── */}
        {tab === 'chat' && (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[80%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed"
                    style={m.role === 'ai'
                      ? { background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', borderRadius: '4px 16px 16px 16px' }
                      : { background: 'linear-gradient(135deg,#00d4ff,#0099cc)', color: '#000', borderRadius: '16px 4px 16px 16px' }}>
                    {m.text}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="p-3 border-t border-slate-800/80">
              <div className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleChat()}
                  placeholder={hasKey ? 'Ask anything about your tour...' : 'Set API key in Settings first'}
                  disabled={!hasKey}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 disabled:opacity-40"
                />
                <button onClick={handleChat} disabled={!hasKey || !chatInput.trim()}
                  className="p-2 rounded-xl disabled:opacity-40 transition-colors"
                  style={{ background: 'linear-gradient(135deg,#00d4ff,#0099cc)' }}>
                  <Send size={13} className="text-black" />
                </button>
              </div>
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {['Best hotspot placement?', 'How many scenes ideal?', 'Fix dark panorama?'].map(q => (
                  <button key={q} onClick={() => { setChatInput(q); }}
                    className="text-[9px] px-2 py-1 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── SETTINGS TAB ── */}
        {tab === 'settings' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">AI Provider</div>

            {/* Provider toggle */}
            <div className="grid grid-cols-2 gap-2">
              {(['gemini', 'openrouter'] as AIProvider[]).map(p => (
                <button key={p} onClick={() => setProvider(p)}
                  className={`py-3 rounded-xl text-xs font-bold transition-all ${
                    provider === p ? 'text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}
                  style={provider === p
                    ? { background: 'rgba(0,212,255,0.15)', border: '1px solid rgba(0,212,255,0.4)' }
                    : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  {p === 'gemini' ? '🔵 Google Gemini' : '🟣 OpenRouter'}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1.5 tracking-wider">
                {provider === 'gemini' ? 'Gemini API Key' : 'OpenRouter API Key'}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={provider === 'gemini' ? 'AIza...' : 'sk-or-...'}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            {provider === 'openrouter' && (
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1.5 tracking-wider">Model (optional)</label>
                <input
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  placeholder="anthropic/claude-3.5-sonnet"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
            )}

            <button onClick={saveKey}
              className="w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
              style={{ background: 'linear-gradient(135deg,#00d4ff,#0099cc)', color: '#000' }}>
              {keySaved ? <><Check size={13} /> Saved!</> : <><Key size={13} /> Save API Key</>}
            </button>

            {/* Help links */}
            <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">Get your API key</div>
              {[
                { name: 'Google AI Studio (Gemini)', url: 'https://aistudio.google.com/apikey', note: 'Free tier available' },
                { name: 'OpenRouter', url: 'https://openrouter.ai/keys', note: 'Access Claude, GPT-4, etc.' },
              ].map(l => (
                <a key={l.name} href={l.url} target="_blank" rel="noreferrer"
                  className="flex items-center justify-between py-1.5 text-xs hover:text-cyan-400 transition-colors">
                  <span className="text-slate-300">{l.name}</span>
                  <span className="text-slate-500 text-[9px]">{l.note}</span>
                </a>
              ))}
            </div>

            <div className="rounded-xl p-3 text-[10px] text-slate-500 leading-relaxed"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
              🔒 Your API key is stored only in your browser's localStorage and never sent to our servers. All AI requests go directly to Google/OpenRouter.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ── AI Feature Card ─────────────────────────────────────────── */
function AIFeatureCard({ icon, title, description, onRun, loading, disabled, color }:
  { icon: string; title: string; description: string; onRun: () => void; loading: boolean; disabled?: boolean; color: string }) {
  return (
    <div className="rounded-xl p-4 transition-all hover:scale-[1.01]"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0"
          style={{ background: `${color}15`, border: `1px solid ${color}25` }}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-white mb-1">{title}</div>
          <div className="text-[10px] text-slate-400 leading-relaxed">{description}</div>
        </div>
      </div>
      <button onClick={onRun} disabled={disabled || loading}
        className="mt-3 w-full py-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-40"
        style={{ background: disabled ? 'rgba(255,255,255,0.04)' : `${color}18`, border: `1px solid ${color}30`, color: disabled ? '#6b7280' : color }}>
        {loading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
        {loading ? 'Working...' : `Run ${title}`}
      </button>
    </div>
  );
}
