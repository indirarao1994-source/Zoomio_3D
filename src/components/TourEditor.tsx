import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTourStore } from '../store/useTourStore';
import type { Hotspot, Scene, TextLabel, SceneLighting, SceneTransition } from '../types/tour';
import { DEFAULT_LIGHTING, DEFAULT_TRANSITION } from '../types/tour';
import { ThreeViewer } from './ThreeViewer';
import type { ViewerHandle } from './ThreeViewer';
import { Tutorial, QuickHelp, isTutorialSeen } from './Tutorial';
import { HOTSPOT_ICONS as ICON_CATALOG, DEFAULT_ICON_FOR_TYPE, iconToSvg } from '../viewer/icons';
import { FloorPlanPanel } from './FloorPlanPanel';
import { VideoExportModal } from './VideoExportModal';
import { BrandingModal } from './BrandingModal';
import { api } from '../api';
import { AIPanel } from './AIPanel';
import { PublishModal } from './PublishModal';
import { generateOfflineTourZip } from '../utils/exportGenerator';
import { generateMockPanorama } from '../utils/imageProcessor';
import confetti from 'canvas-confetti';
import {
  ArrowLeft, Undo, Redo, Eye, EyeOff, Share2,
  Plus, Trash2, Check, ChevronDown, ChevronRight,
  Navigation, Info, Image, Link, Type, Play,
  Sun, Film, Settings, Volume2, Download,
  MousePointer2, ZoomIn, UploadCloud, Sparkles,
  HelpCircle, BookOpen, RotateCcw, Radio, Map, Palette
} from 'lucide-react';

interface TourEditorProps { onBackToDashboard: () => void; }

/* ── Tool definitions ──────────────────────────────────────── */
const TOOLS = [
  { id: 'select',     icon: MousePointer2, label: 'Select / Move',        color: 'text-slate-300' },
  { id: 'navigation', icon: Navigation,    label: 'Navigation Hotspot',    color: 'text-cyan-400' },
  { id: 'info',       icon: Info,          label: 'Info Popup Hotspot',    color: 'text-yellow-400' },
  { id: 'image',      icon: Image,         label: 'Image/Media Hotspot',   color: 'text-purple-400' },
  { id: 'video',      icon: Play,          label: 'Video Hotspot',         color: 'text-pink-400' },
  { id: 'audio',      icon: Volume2,       label: 'Audio Hotspot',         color: 'text-emerald-400' },
  { id: 'link',       icon: Link,          label: 'URL / Link Hotspot',    color: 'text-blue-400' },
  { id: 'label',      icon: Type,          label: 'Text Label (3D)',       color: 'text-orange-400' },
  { id: 'lighting',   icon: Sun,           label: 'Lighting Controls',     color: 'text-amber-400' },
  { id: 'transition', icon: Film,          label: 'Scene Transition',      color: 'text-indigo-400' },
  { id: 'settings',   icon: Settings,      label: 'Scene Settings',        color: 'text-slate-400' },
  { id: 'floorplan',  icon: Map,           label: 'Floor Plan & Map',      color: 'text-teal-400' },
] as const;

type ToolId = typeof TOOLS[number]['id'];

const HOTSPOT_ICONS: Record<string, string> = {
  navigation: '🚪', info: 'ℹ️', image: '🖼️', video: '▶️',
  audio: '🔊', link: '🔗', pdf: '📄', phone: '📞',
};

const HOTSPOT_COLORS: Record<string, string> = {
  navigation: '#00d4ff', info: '#fbbf24', image: '#a78bfa',
  video: '#f472b6', audio: '#34d399', link: '#60a5fa',
  pdf: '#fb923c', phone: '#4ade80',
};

/* ════════════════════════════════════════════════════════════ */
export const TourEditor: React.FC<TourEditorProps> = ({ onBackToDashboard }) => {
  const store = useTourStore();
  const {
    activeProject, updateActiveProject, updateSceneInActive,
    addHotspotToActiveScene, updateHotspotInActiveScene, deleteHotspotFromActiveScene,
    deleteSceneFromActive, addSceneToActiveProject, undo, redo, history,
  } = store;

  const viewerRef = useRef<ViewerHandle>(null);

  /* ── Autosave ───────────────────────────────────────────────
   * Edits previously lived only in browser memory until the user opened the
   * Share dialog, so anything done before navigating away — or before a
   * refresh — was silently lost. Persisting on a debounce means the server is
   * always the source of truth and "I edited it but it published the old
   * version" cannot happen.
   */
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimer = useRef<number>(0);
  const lastSaved = useRef<string>('');

  useEffect(() => {
    if (!activeProject) return;
    const snapshot = JSON.stringify(activeProject);
    // Skip the initial render and no-op re-renders.
    if (snapshot === lastSaved.current) return;
    if (!lastSaved.current) { lastSaved.current = snapshot; return; }

    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setSaveState('saving');
      try {
        await api.upsertProject(activeProject);
        lastSaved.current = snapshot;
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 800);
    return () => window.clearTimeout(saveTimer.current);
  }, [activeProject]);

  /* ── Selection state ── */
  const [activeSceneId,   setActiveSceneId  ] = useState<string>(activeProject?.scenes[0]?.id || '');
  const [activeHotspotId, setActiveHotspotId] = useState<string | null>(null);
  const [activeLabelId,   setActiveLabelId  ] = useState<string | null>(null);
  const [activeTool,      setActiveTool     ] = useState<ToolId>('select');

  /* ── Viewer controls ── */
  const [autoRotate,      setAutoRotate     ] = useState(false);
  const [autoRotateSpeed, setAutoRotateSpeed] = useState(1);
  const [followMode,      setFollowMode     ] = useState(false);
  const [previewMode,     setPreviewMode    ] = useState(false);

  /* ── UI state ── */
  const [scenesPanelOpen,  setScenesPanelOpen ] = useState(true);
  const [isPublishing,     setIsPublishing    ] = useState(false);
  const [tooltipTool,      setTooltipTool     ] = useState<string | null>(null);
  const [showPublishModal, setShowPublishModal ] = useState(false);
  const [showVideoModal,   setShowVideoModal   ] = useState(false);
  const [showBrandModal,   setShowBrandModal   ] = useState(false);
  const [showTutorial,     setShowTutorial    ] = useState(!isTutorialSeen());
  const [showAIPanel,      setShowAIPanel     ] = useState(false);
  const [showQuickHelp,    setShowQuickHelp   ] = useState(false);

  if (!activeProject) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-950">
        <p className="text-slate-400 mb-4">No project active.</p>
        <button onClick={onBackToDashboard} className="px-4 py-2 bg-brand-500 text-white rounded-xl text-sm">
          Back to Dashboard
        </button>
      </div>
    );
  }

  const scenes      = activeProject.scenes;
  const activeScene = scenes.find(s => s.id === activeSceneId) || scenes[0];
  const sceneIndex  = scenes.findIndex(s => s.id === activeSceneId);

  const selectedHotspot = activeScene?.hotspots.find(h => h.id === activeHotspotId) || null;
  const selectedLabel   = (activeScene?.textLabels || []).find(l => l.id === activeLabelId) || null;

  /* ── Scene select ─────────────────────────────────────────── */
  const selectScene = (id: string) => {
    setActiveSceneId(id);
    setActiveHotspotId(null);
    setActiveLabelId(null);
  };

  /* ── Add scene ────────────────────────────────────────────── */
  const handleAddScene = () => {
    const n    = scenes.length + 1;
    const name = `Room ${n}`;
    const img  = generateMockPanorama(name, activeProject.primaryColor);
    const newScene: Scene = {
      id: `sc_${Math.random().toString(36).substr(2,9)}`,
      name, imageUrl: img, order: n, isEntrance: false,
      metadata: { fileSize: '1 MB', resolution: '1024x512', aspectRatio: '2:1', isEquirectangular: true },
      validation: { qualityScore: 90, brightness: 'optimal', blur: 'sharp', noise: 'low', errors: [], warnings: [], status: 'pass' },
      hotspots: [], textLabels: [],
    };
    addSceneToActiveProject(newScene);
    setActiveSceneId(newScene.id);
  };

  /* ── Upload image for scene ──────────────────────────────── */
  const handleUploadImage = (sceneId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        updateSceneInActive(sceneId, { imageUrl: ev.target?.result as string });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  /* ── Viewer click → add hotspot/label ───────────────────── */
  const handleViewerClick = useCallback((yaw: number, pitch: number) => {
    if (!activeScene) return;
    if (activeTool === 'select') return;

    if (activeTool === 'label') {
      const newLabel: TextLabel = {
        id: `lbl_${Math.random().toString(36).substr(2,9)}`,
        text: 'Location Name',
        yaw, pitch,
        fontSize: 16,
        color: '#ffffff',
        bgColor: 'rgba(0,0,0,0.65)',
        opacity: 1,
        bold: false,
        visible: true,
        padding: 8,
        borderRadius: 8,
      };
      const updated = { textLabels: [...(activeScene.textLabels || []), newLabel] };
      updateSceneInActive(activeScene.id, updated);
      setActiveLabelId(newLabel.id);
      setActiveHotspotId(null);
      return;
    }

    /* Hotspot tools */
    if (['navigation','info','image','video','audio','link'].includes(activeTool)) {
      const newHotspot: Hotspot = {
        id: `hs_${Math.random().toString(36).substr(2,9)}`,
        type: activeTool as Hotspot['type'],
        yaw, pitch,
        label: activeTool === 'navigation' ? 'Go to Room' :
               activeTool === 'info' ? 'Information' :
               activeTool === 'image' ? 'View Image' :
               activeTool === 'video' ? 'Watch Video' :
               activeTool === 'audio' ? 'Play Audio' : 'Visit Link',
        icon: DEFAULT_ICON_FOR_TYPE[activeTool] ?? 'pin',
        actionValue: activeTool === 'navigation' ? (scenes.find(s => s.id !== activeScene.id)?.id || '') : '',
        animation: 'pulse',
        color: HOTSPOT_COLORS[activeTool] || '#00d4ff',
        size: 'md',
      };
      addHotspotToActiveScene(activeScene.id, newHotspot);
      setActiveHotspotId(newHotspot.id);
      setActiveLabelId(null);
      setActiveTool('select'); // switch back after placing
    }
  }, [activeTool, activeScene, scenes, addHotspotToActiveScene, updateSceneInActive]);

  /* ── Delete hotspot ──────────────────────────────────────── */
  const deleteHotspot = (id: string) => {
    deleteHotspotFromActiveScene(activeScene.id, id);
    if (activeHotspotId === id) setActiveHotspotId(null);
  };

  /* ── Delete label ────────────────────────────────────────── */
  const deleteLabel = (id: string) => {
    const labels = (activeScene.textLabels || []).filter(l => l.id !== id);
    updateSceneInActive(activeScene.id, { textLabels: labels });
    if (activeLabelId === id) setActiveLabelId(null);
  };

  const updateLabel = (id: string, patch: Partial<TextLabel>) => {
    const labels = (activeScene.textLabels || []).map(l => l.id === id ? { ...l, ...patch } : l);
    updateSceneInActive(activeScene.id, { textLabels: labels });
  };

  /* ── Lighting ────────────────────────────────────────────── */
  const lighting = activeScene?.lighting || DEFAULT_LIGHTING;
  const setLighting = (patch: Partial<SceneLighting>) =>
    updateSceneInActive(activeScene.id, { lighting: { ...lighting, ...patch } });

  /* ── Transition ──────────────────────────────────────────── */
  const transition = activeScene?.transition || DEFAULT_TRANSITION;
  const setTransition = (patch: Partial<SceneTransition>) =>
    updateSceneInActive(activeScene.id, { transition: { ...transition, ...patch } });

  /* ── Export ZIP ──────────────────────────────────────────── */
  const handleExport = async () => {
    setIsPublishing(true);
    try {
      const blob = await generateOfflineTourZip(activeProject);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `${activeProject.name.replace(/\s+/g,'_')}_tour.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      confetti({ particleCount: 100, spread: 60, origin: { y: 0.6 } });
    } catch { alert('Export failed.'); }
    setIsPublishing(false);
    setShowPublishModal(false);
  };

  /* ── Capture initial view ─────────────────────────────────── */
  const captureView = () => {
    const v = viewerRef.current?.captureInitialView();
    if (v) updateSceneInActive(activeScene.id, { initialView: v });
  };

  /* ── AI handlers ─────────────────────────────────────────── */
  const handleApplySceneAnalysis = (name: string, description: string) => {
    updateSceneInActive(activeScene.id, { name, description });
  };

  const handleApplyNarration = (text: string) => {
    updateSceneInActive(activeScene.id, { narrationText: text });
  };

  const handleApplyHotspots = (suggestions: any[]) => {
    suggestions.forEach((s: any) => {
      if (s.fromSceneId !== activeScene.id) return;
      const newHotspot: Hotspot = {
        id: `hs_${Math.random().toString(36).substr(2,9)}`,
        type: 'navigation',
        yaw: s.yaw || 0,
        pitch: s.pitch || -15,
        label: s.label || 'Go to Room',
        icon: 'arrow',
        actionValue: s.toSceneId || '',
        animation: 'pulse',
        color: '#00d4ff',
        size: 'md',
      };
      addHotspotToActiveScene(s.fromSceneId, newHotspot);
    });
  };

  /* ══════════════════ RENDER ════════════════════════════════ */
  return (
    <div className="flex flex-col h-screen bg-[#0d1117] text-slate-100 overflow-hidden select-none">

      {/* ── HEADER ──────────────────────────────────────────── */}
      <header className="h-12 border-b border-slate-800/70 flex items-center justify-between px-3 shrink-0
        bg-[#161b22]/90 backdrop-blur z-50">
        {/* Left */}
        <div className="flex items-center gap-2">
          <button onClick={onBackToDashboard}
            className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white">
            <ArrowLeft size={16} />
          </button>
          <div className="w-px h-5 bg-slate-700" />
          <span className="text-xs font-bold text-slate-300 max-w-[180px] truncate">{activeProject.name}</span>
        </div>

        {/* Center: Undo/Redo + zoom hint */}
        <div className="flex items-center gap-1">
          <button onClick={undo} disabled={!history.undoStack.length}
            className="p-1.5 hover:bg-slate-800 rounded-lg disabled:opacity-30 text-slate-400 hover:text-white transition-colors">
            <Undo size={14} />
          </button>
          <button onClick={redo} disabled={!history.redoStack.length}
            className="p-1.5 hover:bg-slate-800 rounded-lg disabled:opacity-30 text-slate-400 hover:text-white transition-colors">
            <Redo size={14} />
          </button>
          <div className="w-px h-5 bg-slate-700 mx-1" />
          {/* Auto-rotate */}
          <button
            onClick={() => setAutoRotate(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
              autoRotate ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
            }`}
          >
            <RotateCcw size={11} />
            {autoRotate ? 'AUTO ON' : 'AUTO'}
          </button>
          {autoRotate && (
            <input type="range" min={0.3} max={5} step={0.1} value={autoRotateSpeed}
              onChange={e => setAutoRotateSpeed(+e.target.value)}
              className="w-20 accent-cyan-500 h-1 cursor-pointer" title="Rotation speed" />
          )}
          {/* Follow mode */}
          <button
            onClick={() => setFollowMode(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
              followMode ? 'bg-green-500/20 text-green-400 border border-green-500/40' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Radio size={11} />
            FOLLOW
          </button>
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          {/* Tutorial */}
          <button onClick={() => setShowTutorial(true)}
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-500 hover:text-yellow-400 transition-colors"
            title="Open Tutorial">
            <BookOpen size={14} />
          </button>
          {/* Help */}
          <button onClick={() => setShowQuickHelp(v => !v)}
            className={`p-1.5 rounded-lg transition-colors ${
              showQuickHelp ? 'bg-slate-700 text-white' : 'hover:bg-slate-800 text-slate-500 hover:text-white'
            }`} title="Quick Reference">
            <HelpCircle size={14} />
          </button>
          {/* AI */}
          <button onClick={() => setShowAIPanel(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              showAIPanel
                ? 'text-purple-300 border border-purple-500/40'
                : 'text-slate-400 hover:text-purple-300 hover:bg-slate-800'
            }`}
            style={showAIPanel ? { background: 'rgba(168,85,247,0.15)' } : {}}
            title="AI Assistant">
            <Sparkles size={12} />
            AI
          </button>
          <div className="w-px h-5 bg-slate-700" />
          <button
            onClick={() => setPreviewMode(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              previewMode ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
          >
            {previewMode ? <EyeOff size={12} /> : <Eye size={12} />}
            {previewMode ? 'Exit Preview' : 'Preview'}
          </button>
          <span
            className={`text-[10px] font-bold px-2 ${
              saveState === 'error' ? 'text-rose-400'
              : saveState === 'saving' ? 'text-slate-400'
              : saveState === 'saved' ? 'text-emerald-400' : 'text-transparent'
            }`}
            title="Changes save automatically"
          >
            {saveState === 'saving' ? 'Saving…'
              : saveState === 'saved' ? 'Saved'
              : saveState === 'error' ? 'Not saved' : ''}
          </span>
          <button
            onClick={() => setShowBrandModal(true)}
            title="Logo, accent colour and credit line"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700
              text-slate-200 text-xs font-bold rounded-lg transition-colors"
          >
            <Palette size={12} />
            Brand
          </button>
          <button
            onClick={() => setShowVideoModal(true)}
            title="Export an MP4 walkthrough for WhatsApp, Reels or YouTube"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700
              text-slate-200 text-xs font-bold rounded-lg transition-colors"
          >
            <Film size={12} />
            Video
          </button>
          <button
            onClick={() => setShowPublishModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-cyan-500 to-blue-600
              text-white text-xs font-bold rounded-lg hover:opacity-90 transition-opacity"
          >
            <Share2 size={12} />
            Share
          </button>
        </div>
      </header>

      {/* ── BODY ────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: SCENES PANEL ──────────────────────────── */}
        <aside className={`${scenesPanelOpen ? 'w-[175px]' : 'w-10'} border-r border-slate-800/60
          bg-[#161b22] flex flex-col shrink-0 transition-all duration-200`}>

          {/* Collapse toggle */}
          <button
            onClick={() => setScenesPanelOpen(v => !v)}
            className="flex items-center justify-between px-2.5 py-2 border-b border-slate-800/60
              text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-300 hover:bg-slate-800/40 transition-colors"
          >
            {scenesPanelOpen && <span>Scenes ({scenes.length})</span>}
            {scenesPanelOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>

          {scenesPanelOpen && (
            <>
              <div className="flex-1 overflow-y-auto py-1.5 space-y-1 px-1.5">
                {scenes.map((s, i) => (
                  <div
                    key={s.id}
                    onClick={() => selectScene(s.id)}
                    className={`group relative rounded-lg overflow-hidden cursor-pointer transition-all border ${
                      s.id === activeSceneId
                        ? 'border-cyan-500/60 ring-1 ring-cyan-500/30 shadow-md'
                        : 'border-slate-700/40 hover:border-slate-600'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="relative h-[72px] bg-slate-900">
                      <img
                        src={s.imageUrl}
                        alt={s.name}
                        className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      {/* Overlay with scene number */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                      <div className="absolute bottom-1 left-1.5 right-1.5 flex items-center justify-between">
                        <span className="text-[10px] font-bold text-white truncate">{s.name}</span>
                        {s.isEntrance && (
                          <span className="text-[7px] bg-emerald-500 text-white px-1 rounded font-bold shrink-0">START</span>
                        )}
                      </div>
                      <span className="absolute top-1 left-1 text-[9px] font-mono text-white/50">{i+1}</span>
                      {/* Hotspot count badge */}
                      {s.hotspots.length > 0 && (
                        <span className="absolute top-1 right-1 text-[8px] bg-cyan-500/80 text-white px-1 rounded">
                          {s.hotspots.length}🎯
                        </span>
                      )}
                    </div>

                    {/* Action buttons on hover */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100
                      transition-opacity flex items-center justify-center gap-2">
                      <button
                        onClick={e => { e.stopPropagation(); handleUploadImage(s.id); }}
                        className="p-1.5 bg-slate-700/80 rounded-lg hover:bg-cyan-600/80"
                        title="Replace image"
                      >
                        <UploadCloud size={12} />
                      </button>
                      {scenes.length > 1 && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            if (s.id === activeSceneId) selectScene(scenes.find(x => x.id !== s.id)!.id);
                            deleteSceneFromActive(s.id);
                          }}
                          className="p-1.5 bg-slate-700/80 rounded-lg hover:bg-red-600/80"
                          title="Delete scene"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Add scene button */}
              <button
                onClick={handleAddScene}
                className="flex items-center justify-center gap-1.5 m-2 py-2 border border-dashed
                  border-slate-700 rounded-lg text-[10px] text-slate-500 hover:text-slate-300
                  hover:border-slate-500 hover:bg-slate-800/40 transition-all"
              >
                <Plus size={12} /> Add Scene
              </button>
            </>
          )}
        </aside>

        {/* ── CENTER: VIEWER ───────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden relative bg-black">
          {activeScene ? (
            <div className="flex-1 relative">
              <ThreeViewer
                ref={viewerRef}
                scene={activeScene}
                allScenes={scenes}
                currentIndex={sceneIndex}
                activeTool={activeTool}
                activeHotspotId={activeHotspotId}
                activeLabelId={activeLabelId}
                editMode={!previewMode}
                autoRotate={autoRotate}
                autoRotateSpeed={autoRotateSpeed}
                followMode={followMode}
                onViewerClick={!previewMode ? handleViewerClick : undefined}
                onHotspotClick={(hs) => {
                  setActiveHotspotId(hs.id);
                  setActiveLabelId(null);
                  setActiveTool('select');
                }}
                onLabelClick={(lb) => {
                  setActiveLabelId(lb.id);
                  setActiveHotspotId(null);
                  setActiveTool('select');
                }}
                onNavigate={(idx) => selectScene(scenes[idx]?.id || activeSceneId)}
              />

              {/* Scene strip (bottom of viewer) */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent
                px-4 pb-2 pt-8 flex items-center gap-2 overflow-x-auto z-20">
                {scenes.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => selectScene(s.id)}
                    className={`shrink-0 h-12 w-[72px] rounded-lg overflow-hidden border-2 transition-all ${
                      s.id === activeSceneId ? 'border-cyan-400 scale-105' : 'border-slate-700/60 opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img src={s.imageUrl} alt={s.name} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              No scenes — add one from the left panel.
            </div>
          )}
        </main>

        {/* ── RIGHT: TOOL ICONS ────────────────────────────── */}
        <div className="w-11 border-l border-slate-800/60 bg-[#161b22] flex flex-col items-center
          py-2 gap-0.5 shrink-0 relative">
          {TOOLS.map(tool => {
            const Icon = tool.icon;
            const isActive = activeTool === tool.id;
            return (
              <div key={tool.id} className="relative w-full flex justify-center">
                <button
                  onClick={() => {
                    setActiveTool(tool.id as ToolId);
                    setActiveHotspotId(null);
                    setActiveLabelId(null);
                  }}
                  onMouseEnter={() => setTooltipTool(tool.id)}
                  onMouseLeave={() => setTooltipTool(null)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                    isActive
                      ? 'bg-cyan-500/25 text-cyan-400 ring-1 ring-cyan-500/50'
                      : `hover:bg-slate-700/60 ${tool.color}`
                  }`}
                  title={tool.label}
                >
                  <Icon size={15} />
                </button>
                {/* Tooltip */}
                {tooltipTool === tool.id && (
                  <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 z-50
                    bg-slate-900 border border-slate-700 text-white text-[10px] font-semibold
                    px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-xl pointer-events-none">
                    {tool.label}
                    <div className="absolute right-[-4px] top-1/2 -translate-y-1/2 w-2 h-2
                      bg-slate-900 border-r border-t border-slate-700 rotate-45" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Separator */}
          <div className="w-6 h-px bg-slate-700/60 my-1" />

          {/* Zoom hint */}
          <button className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:text-slate-400 hover:bg-slate-700/40 transition-colors" title="Scroll to zoom">
            <ZoomIn size={13} />
          </button>
          <button className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:text-slate-400 hover:bg-slate-700/40 transition-colors" title="Minimap">
            <Map size={13} />
          </button>
        </div>

        {/* ── RIGHT: PROPERTIES PANEL ──────────────────────── */}
        <aside className="w-[280px] border-l border-slate-800/60 bg-[#161b22] flex flex-col shrink-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {renderPropertiesPanel()}
          </div>
        </aside>

      </div>

      {/* ── PUBLISH MODAL ──────────────────────────────────── */}
      {showPublishModal && (
        <PublishModal
          project={activeProject}
          onClose={() => setShowPublishModal(false)}
        />
      )}

      {/* ── BRANDING MODAL ─────────────────────────────────── */}
      {showBrandModal && (
        <BrandingModal
          project={activeProject}
          onChange={patch => updateActiveProject(patch)}
          onClose={() => setShowBrandModal(false)}
        />
      )}

      {/* ── VIDEO EXPORT MODAL ─────────────────────────────── */}
      {showVideoModal && (
        <VideoExportModal
          project={activeProject}
          onClose={() => setShowVideoModal(false)}
        />
      )}

      {/* ── TUTORIAL OVERLAY ── */}
      {showTutorial && (
        <Tutorial onClose={() => setShowTutorial(false)} />
      )}

      {/* ── AI PANEL (slide-in from right) ── */}
      {showAIPanel && activeScene && (
        <AIPanel
          onClose={() => setShowAIPanel(false)}
          activeScene={activeScene}
          allScenes={scenes}
          projectName={activeProject.name}
          projectCategory={activeProject.category}
          projectLocation={activeProject.location}
          onApplySceneAnalysis={handleApplySceneAnalysis}
          onApplyNarration={handleApplyNarration}
          onApplyHotspots={handleApplyHotspots}
        />
      )}

      {/* ── QUICK HELP ── */}
      {showQuickHelp && (
        <QuickHelp onClose={() => setShowQuickHelp(false)} />
      )}
    </div>
  );

  /* ════════════════════════════════════════════════════════════
     PROPERTIES PANEL RENDERER
  ════════════════════════════════════════════════════════════ */
  function renderPropertiesPanel() {
    /* ── Selected Hotspot ── */
    if (selectedHotspot && activeTool === 'select') {
      return <HotspotPanel
        hotspot={selectedHotspot}
        scenes={scenes}
        activeSceneId={activeSceneId}
        onChange={p => updateHotspotInActiveScene(activeScene.id, selectedHotspot.id, p)}
        onDelete={() => deleteHotspot(selectedHotspot.id)}
      />;
    }

    /* ── Selected Label ── */
    if (selectedLabel && activeTool === 'select') {
      return <LabelPanel
        label={selectedLabel}
        onChange={p => updateLabel(selectedLabel.id, p)}
        onDelete={() => deleteLabel(selectedLabel.id)}
      />;
    }

    /* ── Tool-specific panels ── */
    switch (activeTool) {
      case 'lighting':
        return <LightingPanel lighting={lighting} onChange={setLighting} onReset={() => setLighting(DEFAULT_LIGHTING)} />;
      case 'transition':
        return <TransitionPanel transition={transition} onChange={setTransition} />;
      case 'floorplan':
        return <FloorPlanPanel
          floorPlans={activeProject.floorPlans || []}
          scenes={scenes}
          activeSceneId={activeScene.id}
          accentColor={activeProject.primaryColor || '#00d4ff'}
          onChange={plans => updateActiveProject({ floorPlans: plans })}
          onSelectScene={selectScene}
          onApplyConnections={next => updateActiveProject({ scenes: next })}
        />;
      case 'settings':
        return <SceneSettingsPanel
          scene={activeScene}
          scenes={scenes}
          onChange={p => updateSceneInActive(activeScene.id, p)}
          onCaptureView={captureView}
          autoRotate={autoRotate}
          setAutoRotate={setAutoRotate}
          autoRotateSpeed={autoRotateSpeed}
          setAutoRotateSpeed={setAutoRotateSpeed}
          followMode={followMode}
          setFollowMode={setFollowMode}
        />;
      default:
        return <DefaultPanel
          scene={activeScene}
          activeTool={activeTool}
          onChange={p => updateSceneInActive(activeScene.id, p)}
          onCaptureView={captureView}
        />;
    }
  }
};

/* ════════════════════════════════════════════════════════════════
   SUB-PANELS
════════════════════════════════════════════════════════════════ */

function PanelHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-4 py-3 border-b border-slate-800/60">
      <h3 className="text-xs font-bold text-white">{title}</h3>
      {subtitle && <p className="text-[10px] text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1.5 tracking-wider">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500/60 transition-colors";
const selectCls = "w-full bg-slate-900 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500/60";

/* ── Default panel (select tool, no selection) ── */
function DefaultPanel({ scene, activeTool, onChange, onCaptureView }:
  { scene: Scene; activeTool: string; onChange: (p: Partial<Scene>) => void; onCaptureView: () => void }) {

  const ICONS: Record<string, string> = {
    navigation: '🚪 Click in the panorama to place a navigation hotspot.\nIt will link to another room.',
    info: 'ℹ️ Click in the panorama to place an info popup.\nViewers can click it to read text.',
    image: '🖼️ Click to place an image hotspot.\nPaste an image URL in the properties.',
    video: '▶️ Click to place a video hotspot.\nPaste a video URL.',
    audio: '🔊 Click to place an audio hotspot.\nPaste an audio file URL.',
    link: '🔗 Click to place a URL link hotspot.\nPaste any web address.',
    label: '🏷️ Click in the panorama to place a text label.\nGreat for location names & signs.',
    select: '',
  };

  const hint = ICONS[activeTool] || '';

  return (
    <div>
      <PanelHeader title={scene.name} subtitle={`${scene.hotspots.length} hotspots · ${scene.textLabels?.length||0} labels`} />
      <div className="p-4 space-y-4">
        {hint && (
          <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-3 text-[10px] text-cyan-300 leading-relaxed whitespace-pre-line">
            {hint}
          </div>
        )}

        <Field label="Scene Name">
          <input className={inputCls} value={scene.name} onChange={e => onChange({ name: e.target.value })} />
        </Field>

        <Field label="Description">
          <textarea className={inputCls + ' resize-none'} rows={3}
            value={scene.description || ''} onChange={e => onChange({ description: e.target.value })}
            placeholder="Brief description of this room..." />
        </Field>

        {/* Hotspot list */}
        {scene.hotspots.length > 0 && (
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2 tracking-wider">
              Hotspots ({scene.hotspots.length})
            </label>
            <div className="space-y-1.5 max-h-44 overflow-y-auto">
              {scene.hotspots.map(hs => (
                <div key={hs.id}
                  className="flex items-center gap-2 p-2 bg-slate-900/60 rounded-lg border border-slate-800/60 text-xs">
                  <span>{(HOTSPOT_ICONS as any)[hs.type]}</span>
                  <span className="flex-1 text-white truncate">{hs.label}</span>
                  <span className="text-[9px] text-slate-500">{hs.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Labels list */}
        {(scene.textLabels || []).length > 0 && (
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2 tracking-wider">
              Text Labels ({scene.textLabels!.length})
            </label>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {scene.textLabels!.map(lb => (
                <div key={lb.id}
                  className="flex items-center gap-2 p-2 bg-slate-900/60 rounded-lg border border-slate-800/60 text-xs">
                  <span>🏷️</span>
                  <span className="flex-1 text-white truncate">{lb.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button onClick={onCaptureView}
          className="w-full py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-[10px] font-bold text-slate-300 flex items-center justify-center gap-2 transition-colors">
          📐 Set Current View as Initial View
        </button>
      </div>
    </div>
  );
}

/* ── Hotspot properties panel ── */
function HotspotPanel({ hotspot, scenes, activeSceneId, onChange, onDelete }:
  { hotspot: Hotspot; scenes: Scene[]; activeSceneId: string; onChange: (p: Partial<Hotspot>) => void; onDelete: () => void }) {

  const color = hotspot.color || HOTSPOT_COLORS[hotspot.type] || '#00d4ff';
  return (
    <div>
      <PanelHeader
        title="Hotspot Properties"
        subtitle={`${(HOTSPOT_ICONS as any)[hotspot.type] || ''} ${hotspot.type}`}
      />
      <div className="p-4 space-y-4">
        {/* Color indicator */}
        <div className="flex items-center gap-2 p-2.5 rounded-xl border"
          style={{ borderColor: `${color}40`, background: `${color}10` }}>
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-sm"
            style={{ background: color }}>
            {(HOTSPOT_ICONS as any)[hotspot.type]}
          </div>
          <div>
            <div className="text-xs font-bold text-white">{hotspot.label}</div>
            <div className="text-[9px] text-slate-500 capitalize">{hotspot.type} hotspot</div>
          </div>
        </div>

        <Field label="Label Text">
          <input className={inputCls} value={hotspot.label} onChange={e => onChange({ label: e.target.value })} />
        </Field>

        <Field label="Description / Subtitle">
          <textarea className={inputCls + ' resize-none'} rows={2}
            value={hotspot.description || ''} onChange={e => onChange({ description: e.target.value })}
            placeholder="Optional hover description..." />
        </Field>

        <Field label="Marker Icon">
          <div className="grid grid-cols-8 gap-1">
            {ICON_CATALOG.map(def => {
              const selected = (hotspot.icon || DEFAULT_ICON_FOR_TYPE[hotspot.type]) === def.id;
              return (
                <button
                  key={def.id}
                  type="button"
                  title={def.label}
                  onClick={() => onChange({ icon: def.id })}
                  className={`aspect-square rounded-lg flex items-center justify-center border transition-all ${
                    selected
                      ? 'bg-slate-700 border-cyan-400 scale-105'
                      : 'bg-slate-800/60 border-slate-700 hover:border-slate-500'
                  }`}
                  dangerouslySetInnerHTML={{
                    __html: iconToSvg(def, selected ? color : '#cbd5e1', '#0f172a', 16),
                  }}
                />
              );
            })}
          </div>
          <p className="mt-1.5 text-[9px] text-slate-500 leading-relaxed">
            The location pin marks its spot with the tip; other icons are centred on it.
          </p>
        </Field>

        <Field label="Hotspot Type">
          <select className={selectCls} value={hotspot.type} onChange={e => onChange({ type: e.target.value as Hotspot['type'] })}>
            <option value="navigation">🚪 Navigate to Room</option>
            <option value="info">ℹ️ Info Popup</option>
            <option value="image">🖼️ Image Gallery</option>
            <option value="video">▶️ Video Player</option>
            <option value="audio">🔊 Audio Narration</option>
            <option value="link">🔗 External URL</option>
            <option value="pdf">📄 PDF Document</option>
            <option value="phone">📞 Phone Call</option>
          </select>
        </Field>

        {hotspot.type === 'navigation' ? (
          <Field label="Destination Room">
            <select className={selectCls} value={hotspot.actionValue} onChange={e => onChange({ actionValue: e.target.value })}>
              <option value="">— Select room —</option>
              {scenes.filter(s => s.id !== activeSceneId).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label={hotspot.type === 'info' ? 'Info Text' : hotspot.type === 'phone' ? 'Phone Number' : 'URL / Value'}>
            <textarea className={inputCls + ' resize-none'} rows={3}
              value={hotspot.actionValue}
              onChange={e => onChange({ actionValue: e.target.value })}
              placeholder={
                hotspot.type === 'info' ? 'Enter info popup text...' :
                hotspot.type === 'phone' ? '+1 555 000 0000' :
                'https://example.com/file.pdf'
              } />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Size">
            <select className={selectCls} value={hotspot.size || 'md'} onChange={e => onChange({ size: e.target.value as any })}>
              <option value="sm">Small</option>
              <option value="md">Medium</option>
              <option value="lg">Large</option>
            </select>
          </Field>
          <Field label="Animation">
            <select className={selectCls} value={hotspot.animation} onChange={e => onChange({ animation: e.target.value as any })}>
              <option value="pulse">Pulse</option>
              <option value="float">Float</option>
              <option value="bounce">Bounce</option>
              <option value="none">None</option>
            </select>
          </Field>
        </div>

        <Field label="Accent Color">
          <div className="flex items-center gap-2">
            <input type="color" value={hotspot.color || HOTSPOT_COLORS[hotspot.type] || '#00d4ff'}
              onChange={e => onChange({ color: e.target.value })}
              className="w-8 h-8 rounded cursor-pointer border border-slate-700" />
            <input className={inputCls + ' flex-1'} value={hotspot.color || HOTSPOT_COLORS[hotspot.type] || '#00d4ff'}
              onChange={e => onChange({ color: e.target.value })} />
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="bg-slate-900/60 rounded-lg p-2 border border-slate-800/60">
            <div className="text-slate-500 mb-1">Yaw</div>
            <div className="font-mono text-cyan-400">{hotspot.yaw.toFixed(1)}°</div>
          </div>
          <div className="bg-slate-900/60 rounded-lg p-2 border border-slate-800/60">
            <div className="text-slate-500 mb-1">Pitch</div>
            <div className="font-mono text-cyan-400">{hotspot.pitch.toFixed(1)}°</div>
          </div>
        </div>

        <button onClick={onDelete}
          className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30
            text-red-400 rounded-lg text-[10px] font-bold transition-colors flex items-center justify-center gap-2">
          <Trash2 size={11} /> Delete Hotspot
        </button>
      </div>
    </div>
  );
}

/* ── Text label panel ── */
function LabelPanel({ label, onChange, onDelete }:
  { label: TextLabel; onChange: (p: Partial<TextLabel>) => void; onDelete: () => void }) {
  return (
    <div>
      <PanelHeader title="Text Label" subtitle="Floating label in 360° scene" />
      <div className="p-4 space-y-4">
        {/* Preview */}
        <div className="flex items-center justify-center py-3">
          <div style={{
            fontSize: Math.min(label.fontSize, 20),
            color: label.color,
            background: label.bgColor,
            opacity: label.opacity,
            fontWeight: label.bold ? 700 : 400,
            padding: '6px 14px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.15)',
          }}>
            {label.text || 'Preview'}
          </div>
        </div>

        <Field label="Text">
          <input className={inputCls} value={label.text} onChange={e => onChange({ text: e.target.value })} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Font Size">
            <input type="number" className={inputCls} value={label.fontSize} min={10} max={40}
              onChange={e => onChange({ fontSize: +e.target.value })} />
          </Field>
          <Field label="Opacity">
            <input type="range" min={0.1} max={1} step={0.05} value={label.opacity}
              onChange={e => onChange({ opacity: +e.target.value })}
              className="w-full mt-1 accent-cyan-500 h-1" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Text Color">
            <div className="flex items-center gap-2">
              <input type="color" value={label.color} onChange={e => onChange({ color: e.target.value })}
                className="w-7 h-7 rounded cursor-pointer border border-slate-700" />
              <input className={inputCls + ' flex-1'} value={label.color} onChange={e => onChange({ color: e.target.value })} />
            </div>
          </Field>
          <Field label="Background">
            <div className="flex items-center gap-2">
              <input type="color" value={label.bgColor.replace(/[^#\w]/g, '#000000').slice(0,7)}
                onChange={e => onChange({ bgColor: e.target.value })}
                className="w-7 h-7 rounded cursor-pointer border border-slate-700" />
              <input className={inputCls + ' flex-1'} value={label.bgColor}
                onChange={e => onChange({ bgColor: e.target.value })} />
            </div>
          </Field>
        </div>

        <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800/60 rounded-lg p-3">
          <span className="text-xs text-slate-400 font-semibold">Bold text</span>
          <button onClick={() => onChange({ bold: !label.bold })}
            className={`w-10 h-5 rounded-full transition-all ${label.bold ? 'bg-cyan-500' : 'bg-slate-700'}`}>
            <div className={`w-4 h-4 rounded-full bg-white transition-all mx-0.5 ${label.bold ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800/60 rounded-lg p-3">
          <span className="text-xs text-slate-400 font-semibold">Visible</span>
          <button onClick={() => onChange({ visible: !label.visible })}
            className={`w-10 h-5 rounded-full transition-all ${label.visible ? 'bg-cyan-500' : 'bg-slate-700'}`}>
            <div className={`w-4 h-4 rounded-full bg-white transition-all mx-0.5 ${label.visible ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        <button onClick={onDelete}
          className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400
            rounded-lg text-[10px] font-bold transition-colors flex items-center justify-center gap-2">
          <Trash2 size={11} /> Delete Label
        </button>
      </div>
    </div>
  );
}

/* ── Lighting panel ── */
function LightingPanel({ lighting, onChange, onReset }:
  { lighting: SceneLighting; onChange: (p: Partial<SceneLighting>) => void; onReset: () => void }) {

  const sliders: Array<{ key: keyof SceneLighting; label: string; min: number; max: number; unit: string }> = [
    { key: 'brightness', label: 'Brightness', min: 50,  max: 200, unit: '%' },
    { key: 'contrast',   label: 'Contrast',   min: 50,  max: 200, unit: '%' },
    { key: 'saturation', label: 'Saturation', min: 0,   max: 200, unit: '%' },
    { key: 'hue',        label: 'Hue Rotate', min: -180,max: 180, unit: '°' },
    { key: 'exposure',   label: 'Exposure',   min: 50,  max: 200, unit: '%' },
  ];

  return (
    <div>
      <PanelHeader title="Lighting Controls" subtitle="Adjust panorama appearance" />
      <div className="p-4 space-y-5">
        <div className="flex items-center justify-center py-2">
          <div className="text-5xl">💡</div>
        </div>
        {sliders.map(({ key, label, min, max, unit }) => (
          <div key={key}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">{label}</label>
              <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">
                {lighting[key]}{unit}
              </span>
            </div>
            <input
              type="range" min={min} max={max} step={1}
              value={lighting[key]}
              onChange={e => onChange({ [key]: +e.target.value })}
              className="w-full h-1.5 accent-cyan-500 cursor-pointer rounded-full"
            />
            <div className="flex justify-between text-[8px] text-slate-600 mt-0.5">
              <span>{min}{unit}</span>
              <span>{max}{unit}</span>
            </div>
          </div>
        ))}
        <button onClick={onReset}
          className="w-full py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-[10px] font-bold text-slate-400 flex items-center justify-center gap-2">
          <RotateCcw size={11} /> Reset to Default
        </button>
      </div>
    </div>
  );
}

/* ── Transition panel ── */
function TransitionPanel({ transition, onChange }:
  { transition: SceneTransition; onChange: (p: Partial<SceneTransition>) => void }) {
  return (
    <div>
      <PanelHeader title="Scene Transition" subtitle="Animation when entering this scene" />
      <div className="p-4 space-y-4">
        <div className="text-5xl text-center py-2">🎬</div>

        <Field label="Transition Style">
          <select className={selectCls} value={transition.type} onChange={e => onChange({ type: e.target.value as any })}>
            <option value="fade">⬛ Fade to Black</option>
            <option value="zoom">🔍 Zoom In</option>
            <option value="rotate">🌀 Rotate Sweep</option>
            <option value="blur">💫 Blur Dissolve</option>
            <option value="none">⚡ Instant (No transition)</option>
          </select>
        </Field>

        <Field label={`Duration: ${transition.duration}ms`}>
          <input type="range" min={200} max={2000} step={100} value={transition.duration}
            onChange={e => onChange({ duration: +e.target.value })}
            className="w-full h-1.5 accent-cyan-500 cursor-pointer" />
          <div className="flex justify-between text-[8px] text-slate-600 mt-0.5">
            <span>200ms (fast)</span>
            <span>2000ms (slow)</span>
          </div>
        </Field>

        <Field label="Easing">
          <select className={selectCls} value={transition.easing} onChange={e => onChange({ easing: e.target.value as any })}>
            <option value="ease">Ease (default)</option>
            <option value="ease-in">Ease In</option>
            <option value="ease-out">Ease Out</option>
            <option value="linear">Linear</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

/* ── Scene settings panel ── */
function SceneSettingsPanel({ scene, scenes, onChange, onCaptureView,
  autoRotate, setAutoRotate, autoRotateSpeed, setAutoRotateSpeed, followMode, setFollowMode }:
  {
    scene: Scene; scenes: Scene[];
    onChange: (p: Partial<Scene>) => void; onCaptureView: () => void;
    autoRotate: boolean; setAutoRotate: (v: boolean) => void;
    autoRotateSpeed: number; setAutoRotateSpeed: (v: number) => void;
    followMode: boolean; setFollowMode: (v: boolean) => void;
  }) {

  return (
    <div>
      <PanelHeader title="Scene Settings" subtitle="Configure this scene's behavior" />
      <div className="p-4 space-y-4">
        <Field label="Scene Name">
          <input className={inputCls} value={scene.name} onChange={e => onChange({ name: e.target.value })} />
        </Field>

        <Field label="Description">
          <textarea className={inputCls + ' resize-none'} rows={3}
            value={scene.description || ''} onChange={e => onChange({ description: e.target.value })}
            placeholder="Describe this room..." />
        </Field>

        {/* Entrance toggle */}
        <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800/60 rounded-lg p-3">
          <div>
            <div className="text-xs font-bold text-white">Tour Entrance</div>
            <div className="text-[9px] text-slate-500">Viewers start here</div>
          </div>
          <button onClick={() => onChange({ isEntrance: !scene.isEntrance })}
            className={`w-10 h-5 rounded-full transition-all ${scene.isEntrance ? 'bg-emerald-500' : 'bg-slate-700'}`}>
            <div className={`w-4 h-4 rounded-full bg-white transition-all mx-0.5 ${scene.isEntrance ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* Auto-rotate */}
        <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-white">Auto-Rotate</div>
              <div className="text-[9px] text-slate-500">Slowly spin the panorama</div>
            </div>
            <button onClick={() => setAutoRotate(!autoRotate)}
              className={`w-10 h-5 rounded-full transition-all ${autoRotate ? 'bg-cyan-500' : 'bg-slate-700'}`}>
              <div className={`w-4 h-4 rounded-full bg-white transition-all mx-0.5 ${autoRotate ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          {autoRotate && (
            <div>
              <div className="flex justify-between text-[9px] text-slate-400 mb-1">
                <span>Speed</span><span className="text-cyan-400">{autoRotateSpeed}x</span>
              </div>
              <input type="range" min={0.2} max={5} step={0.1} value={autoRotateSpeed}
                onChange={e => setAutoRotateSpeed(+e.target.value)}
                className="w-full h-1 accent-cyan-500 cursor-pointer" />
            </div>
          )}
        </div>

        {/* Follow mode */}
        <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800/60 rounded-lg p-3">
          <div>
            <div className="text-xs font-bold text-white">Follow Mode</div>
            <div className="text-[9px] text-slate-500">Camera follows mouse / gyroscope</div>
          </div>
          <button onClick={() => setFollowMode(!followMode)}
            className={`w-10 h-5 rounded-full transition-all ${followMode ? 'bg-green-500' : 'bg-slate-700'}`}>
            <div className={`w-4 h-4 rounded-full bg-white transition-all mx-0.5 ${followMode ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* Initial view */}
        <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-3 space-y-2">
          <div className="text-xs font-bold text-white">Initial Camera View</div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="bg-slate-800/60 rounded-lg p-2">
              <div className="text-slate-500">Yaw</div>
              <div className="font-mono text-cyan-400">{(scene.initialView?.yaw ?? 0).toFixed(1)}°</div>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-2">
              <div className="text-slate-500">Pitch</div>
              <div className="font-mono text-cyan-400">{(scene.initialView?.pitch ?? 0).toFixed(1)}°</div>
            </div>
          </div>
          <button onClick={onCaptureView}
            className="w-full py-2 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30
              text-cyan-400 rounded-lg text-[10px] font-bold transition-colors">
            📐 Capture Current View
          </button>
        </div>

        {/* Quality info */}
        {scene.metadata && (
          <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-3 space-y-2">
            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Image Info</div>
            {[
              ['Resolution', scene.metadata.resolution],
              ['File Size', scene.metadata.fileSize],
              ['Quality', `${scene.validation.qualityScore}%`],
              ['Type', scene.metadata.isEquirectangular ? 'Equirectangular 360°' : 'Standard'],
            ].map(([k,v]) => (
              <div key={k} className="flex justify-between text-[10px]">
                <span className="text-slate-500">{k}</span>
                <span className="text-white">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Re-export for App usage
export type { TourEditorProps };
