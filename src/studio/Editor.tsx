import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, type CanvasHandle } from './Canvas';
import { PublishDialog } from './PublishDialog';
import { AiPanel } from './AiPanel';
import { api } from '../api';
import { fileToDataUrl, inspectImage, makeThumbnail } from '../lib/images';
import type { Hotspot, Project, Scene } from '../types/tour';
import type { PanoHotspot } from '../viewer/types';

interface EditorProps {
  project: Project;
  onBack: () => void;
  onProjectChange: (project: Project) => void;
}

const HOTSPOT_TYPES: Array<{ value: Hotspot['type']; label: string; hint: string }> = [
  { value: 'navigation', label: 'Go to scene', hint: 'Moves the visitor to another scene' },
  { value: 'info', label: 'Information', hint: 'Opens a panel of text' },
  { value: 'image', label: 'Image', hint: 'Opens a photo in a lightbox' },
  { value: 'video', label: 'Video', hint: 'YouTube, Vimeo, or a direct video URL' },
  { value: 'audio', label: 'Audio', hint: 'Plays an audio file' },
  { value: 'link', label: 'Web link', hint: 'Opens a URL in a new tab' },
  { value: 'pdf', label: 'Document', hint: 'Opens a PDF' },
  { value: 'phone', label: 'Phone', hint: 'Starts a call on mobile' },
];

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export const Editor: React.FC<EditorProps> = ({ project, onBack, onProjectChange }) => {
  const [draft, setDraft] = useState<Project>(project);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(
    project.scenes[0]?.id ?? null,
  );
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const [importing, setImporting] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const canvasRef = useRef<CanvasHandle>(null);
  const saveTimer = useRef<number>(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const activeScene = useMemo(
    () => draft.scenes.find((s) => s.id === activeSceneId) ?? null,
    [draft.scenes, activeSceneId],
  );
  const selectedHotspot = useMemo(
    () => activeScene?.hotspots.find((h) => h.id === selectedHotspotId) ?? null,
    [activeScene, selectedHotspotId],
  );

  /* ── persistence: debounced autosave ── */

  const mutate = useCallback((updater: (prev: Project) => Project) => {
    setDraft((prev) => {
      const next = updater(prev);
      setSaveState('dirty');
      return next;
    });
  }, []);

  useEffect(() => {
    if (saveState !== 'dirty') return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setSaveState('saving');
      try {
        const saved = await api.updateProject(draft.id, draft);
        onProjectChange(saved);
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 900);
    return () => window.clearTimeout(saveTimer.current);
  }, [draft, saveState, onProjectChange]);

  /* ── scenes ── */

  const addScenes = async (files: FileList | null) => {
    if (!files?.length) return;
    setImporting(files.length);
    const added: Scene[] = [];

    for (const file of Array.from(files)) {
      try {
        const dataUrl = await fileToDataUrl(file);
        const facts = await inspectImage(dataUrl, file.size);
        // Upload so the panorama lives on disk rather than bloating the JSON
        // record; fall back to the inline data URL if the upload fails.
        let imageUrl = dataUrl;
        try {
          imageUrl = (await api.uploadPanorama(file)).url;
        } catch {
          /* keep the data URL */
        }
        const thumbnail = await makeThumbnail(dataUrl);

        added.push({
          id: newId('sc'),
          name: file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' '),
          imageUrl,
          thumbnail,
          order: draft.scenes.length + added.length + 1,
          isEntrance: draft.scenes.length + added.length === 0,
          hotspots: [],
          metadata: {
            fileSize: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
            resolution: `${facts.width} x ${facts.height}`,
            aspectRatio: `${facts.aspectRatio.toFixed(2)}:1`,
            isEquirectangular: facts.isEquirectangular,
          },
          validation: {
            qualityScore: facts.warnings.length === 0 ? 100 : facts.isEquirectangular ? 75 : 40,
            brightness: 'optimal',
            blur: 'sharp',
            noise: 'low',
            errors: facts.isEquirectangular ? [] : facts.warnings.slice(0, 1),
            warnings: facts.isEquirectangular ? facts.warnings : facts.warnings.slice(1),
            status: facts.isEquirectangular ? (facts.warnings.length ? 'warning' : 'pass') : 'fail',
          },
        } as Scene);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : `Could not add ${file.name}`);
      }
    }

    setImporting(0);
    if (added.length === 0) return;
    mutate((prev) => ({ ...prev, scenes: [...prev.scenes, ...added] }));
    setActiveSceneId((current) => current ?? added[0].id);
  };

  const deleteScene = (sceneId: string) => {
    mutate((prev) => {
      const scenes = prev.scenes.filter((s) => s.id !== sceneId);
      // Drop navigation hotspots that pointed at the removed scene, otherwise
      // visitors would click a marker that silently goes nowhere.
      const cleaned = scenes.map((s) => ({
        ...s,
        hotspots: s.hotspots.filter(
          (h) => !(h.type === 'navigation' && h.actionValue === sceneId),
        ),
      }));
      return { ...prev, scenes: cleaned };
    });
    if (activeSceneId === sceneId) {
      const remaining = draft.scenes.filter((s) => s.id !== sceneId);
      setActiveSceneId(remaining[0]?.id ?? null);
    }
  };

  const moveScene = (sceneId: string, direction: -1 | 1) => {
    mutate((prev) => {
      const index = prev.scenes.findIndex((s) => s.id === sceneId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.scenes.length) return prev;
      const scenes = [...prev.scenes];
      [scenes[index], scenes[target]] = [scenes[target], scenes[index]];
      return { ...prev, scenes: scenes.map((s, i) => ({ ...s, order: i + 1 })) };
    });
  };

  const updateScene = (sceneId: string, patch: Partial<Scene>) => {
    mutate((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)),
    }));
  };

  /* ── hotspots ── */

  const placeHotspot = (yaw: number, pitch: number) => {
    if (!activeScene || !placing) return;
    const otherScene = draft.scenes.find((s) => s.id !== activeScene.id);
    const hotspot: Hotspot = {
      id: newId('hs'),
      type: otherScene ? 'navigation' : 'info',
      yaw,
      pitch,
      label: otherScene ? `To ${otherScene.name}` : 'New hotspot',
      icon: otherScene ? 'arrow' : 'circle',
      actionValue: otherScene?.id ?? 'Describe what the visitor is looking at.',
      animation: 'pulse',
    };
    updateScene(activeScene.id, { hotspots: [...activeScene.hotspots, hotspot] });
    setSelectedHotspotId(hotspot.id);
    setPlacing(false);
  };

  const updateHotspot = (patch: Partial<Hotspot>) => {
    if (!activeScene || !selectedHotspot) return;
    updateScene(activeScene.id, {
      hotspots: activeScene.hotspots.map((h) =>
        h.id === selectedHotspot.id ? { ...h, ...patch } : h,
      ),
    });
  };

  const deleteHotspot = (hotspotId: string) => {
    if (!activeScene) return;
    updateScene(activeScene.id, {
      hotspots: activeScene.hotspots.filter((h) => h.id !== hotspotId),
    });
    setSelectedHotspotId(null);
  };

  const onCanvasHotspotClick = (hotspot: PanoHotspot) => {
    setSelectedHotspotId(hotspot.id);
  };

  /* ── render ── */

  const saveLabel = {
    saved: 'All changes saved',
    saving: 'Saving…',
    dirty: 'Unsaved changes',
    error: 'Could not save',
  }[saveState];

  return (
    <div className="flex h-screen flex-col bg-[#0b0e14] text-slate-100">
      {/* Toolbar */}
      <header className="flex shrink-0 items-center gap-3 border-b border-white/8 px-4 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg px-2.5 py-1.5 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"
        >
          ← Projects
        </button>
        <div className="h-5 w-px bg-white/10" />
        <input
          value={draft.name}
          onChange={(e) => mutate((prev) => ({ ...prev, name: e.target.value }))}
          className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm font-medium text-white outline-none transition hover:bg-white/5 focus:bg-white/5"
        />
        <span
          className={`shrink-0 text-xs ${
            saveState === 'error' ? 'text-red-400' : 'text-slate-500'
          }`}
        >
          {saveLabel}
        </span>
        <button
          type="button"
          onClick={() => setShowPublish(true)}
          disabled={draft.scenes.length === 0}
          className="shrink-0 rounded-lg px-4 py-1.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: draft.primaryColor }}
        >
          Share
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Scene rail */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-white/8">
          <div className="flex items-center justify-between px-3 py-2.5">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Scenes ({draft.scenes.length})
            </span>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="rounded px-1.5 text-lg leading-none text-slate-400 transition hover:bg-white/5 hover:text-white"
              title="Add panoramas"
            >
              +
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void addScenes(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
            {importing > 0 && (
              <div className="rounded-lg border border-dashed border-white/15 px-3 py-4 text-center text-xs text-slate-400">
                Importing {importing} panorama{importing === 1 ? '' : 's'}…
              </div>
            )}

            {draft.scenes.map((scene, index) => (
              <div
                key={scene.id}
                className={`group relative overflow-hidden rounded-lg border transition ${
                  scene.id === activeSceneId
                    ? 'border-white/30 bg-white/[0.07]'
                    : 'border-transparent hover:bg-white/[0.04]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveSceneId(scene.id);
                    setSelectedHotspotId(null);
                  }}
                  className="flex w-full items-center gap-2.5 p-2 text-left"
                >
                  <div className="h-9 w-14 shrink-0 overflow-hidden rounded bg-slate-800">
                    {scene.thumbnail && (
                      <img src={scene.thumbnail} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{scene.name}</div>
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      {scene.hotspots.length} hotspot{scene.hotspots.length === 1 ? '' : 's'}
                      {scene.validation?.status === 'fail' && (
                        <span className="ml-1 text-amber-500">· check size</span>
                      )}
                    </div>
                  </div>
                </button>

                <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
                  <button
                    type="button"
                    onClick={() => moveScene(scene.id, -1)}
                    disabled={index === 0}
                    className="rounded bg-black/70 px-1 text-[10px] text-white disabled:opacity-30"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveScene(scene.id, 1)}
                    disabled={index === draft.scenes.length - 1}
                    className="rounded bg-black/70 px-1 text-[10px] text-white disabled:opacity-30"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteScene(scene.id)}
                    className="rounded bg-black/70 px-1 text-[10px] text-red-300"
                    title="Delete scene"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}

            {draft.scenes.length === 0 && importing === 0 && (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="w-full rounded-lg border border-dashed border-white/15 px-3 py-8 text-center text-xs text-slate-400 transition hover:border-white/30 hover:text-white"
              >
                Add 360° panoramas
                <span className="mt-1 block text-[10px] text-slate-600">
                  2:1 equirectangular JPEGs
                </span>
              </button>
            )}
          </div>
        </aside>

        {/* Canvas */}
        <main className="relative min-w-0 flex-1">
          <Canvas
            ref={canvasRef}
            scenes={draft.scenes}
            activeSceneId={activeSceneId}
            accentColor={draft.primaryColor}
            editMode={placing}
            onSceneChange={setActiveSceneId}
            onPlace={placeHotspot}
            onHotspotClick={onCanvasHotspotClick}
          />
          {notice && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-white/10 bg-black/80 px-4 py-2 text-xs text-white backdrop-blur">
              {notice}
              <button
                type="button"
                className="ml-3 underline opacity-70"
                onClick={() => setNotice(null)}
              >
                dismiss
              </button>
            </div>
          )}
        </main>

        {/* Inspector */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-white/8">
          {activeScene ? (
            <div className="space-y-6 p-4">
              <section>
                <h3 className="mb-2.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Scene
                </h3>
                <label className="mb-1 block text-xs text-slate-400">Name</label>
                <input
                  value={activeScene.name}
                  onChange={(e) => updateScene(activeScene.id, { name: e.target.value })}
                  className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm outline-none focus:border-white/30"
                />

                <label className="mb-1 mt-3 block text-xs text-slate-400">
                  Narration
                  <span className="ml-1 text-slate-600">
                    (read aloud by the player)
                  </span>
                </label>
                <textarea
                  value={activeScene.narrationText ?? ''}
                  onChange={(e) =>
                    updateScene(activeScene.id, { narrationText: e.target.value })
                  }
                  rows={4}
                  placeholder="Describe this space for visitors…"
                  className="w-full resize-y rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm leading-relaxed outline-none focus:border-white/30"
                />

                {activeScene.metadata?.resolution && (
                  <p className="mt-2 text-[11px] text-slate-600">
                    {activeScene.metadata.resolution} · {activeScene.metadata.aspectRatio}
                    {!activeScene.metadata.isEquirectangular && (
                      <span className="text-amber-500"> · not 2:1, will look stretched</span>
                    )}
                  </p>
                )}
              </section>

              <section>
                <div className="mb-2.5 flex items-center justify-between">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Hotspots ({activeScene.hotspots.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => setPlacing((p) => !p)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      placing
                        ? 'bg-white text-slate-900'
                        : 'border border-white/12 text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    {placing ? 'Click the panorama…' : '+ Add'}
                  </button>
                </div>

                <div className="space-y-1">
                  {activeScene.hotspots.map((hotspot) => (
                    <button
                      key={hotspot.id}
                      type="button"
                      onClick={() => {
                        setSelectedHotspotId(hotspot.id);
                        canvasRef.current?.lookAt(hotspot as PanoHotspot);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition ${
                        hotspot.id === selectedHotspotId
                          ? 'bg-white/10'
                          : 'hover:bg-white/[0.05]'
                      }`}
                    >
                      <span className="truncate">{hotspot.label || '(no label)'}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-slate-500">
                        {hotspot.type}
                      </span>
                    </button>
                  ))}
                  {activeScene.hotspots.length === 0 && (
                    <p className="px-1 py-2 text-xs leading-relaxed text-slate-600">
                      No hotspots yet. Add one to let visitors move between scenes or
                      reveal extra detail.
                    </p>
                  )}
                </div>
              </section>

              {selectedHotspot && (
                <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="mb-2.5 flex items-center justify-between">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Selected hotspot
                    </h3>
                    <button
                      type="button"
                      onClick={() => deleteHotspot(selectedHotspot.id)}
                      className="text-xs text-red-400 transition hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>

                  <label className="mb-1 block text-xs text-slate-400">Type</label>
                  <select
                    value={selectedHotspot.type}
                    onChange={(e) =>
                      updateHotspot({ type: e.target.value as Hotspot['type'], actionValue: '' })
                    }
                    className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-white/30"
                  >
                    {HOTSPOT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-600">
                    {HOTSPOT_TYPES.find((t) => t.value === selectedHotspot.type)?.hint}
                  </p>

                  <label className="mb-1 mt-3 block text-xs text-slate-400">Label</label>
                  <input
                    value={selectedHotspot.label}
                    onChange={(e) => updateHotspot({ label: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm outline-none focus:border-white/30"
                  />

                  <label className="mb-1 mt-3 block text-xs text-slate-400">
                    {selectedHotspot.type === 'navigation' ? 'Destination' : 'Content'}
                  </label>
                  {selectedHotspot.type === 'navigation' ? (
                    <select
                      value={selectedHotspot.actionValue}
                      onChange={(e) => updateHotspot({ actionValue: e.target.value })}
                      className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-white/30"
                    >
                      <option value="">Choose a scene…</option>
                      {draft.scenes
                        .filter((s) => s.id !== activeScene.id)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  ) : selectedHotspot.type === 'info' ? (
                    <textarea
                      value={selectedHotspot.actionValue}
                      onChange={(e) => updateHotspot({ actionValue: e.target.value })}
                      rows={3}
                      className="w-full resize-y rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm outline-none focus:border-white/30"
                    />
                  ) : (
                    <input
                      value={selectedHotspot.actionValue}
                      onChange={(e) => updateHotspot({ actionValue: e.target.value })}
                      placeholder="https://…"
                      className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm outline-none focus:border-white/30"
                    />
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-slate-400">Yaw</label>
                      <input
                        type="number"
                        value={Math.round(selectedHotspot.yaw)}
                        onChange={(e) => updateHotspot({ yaw: Number(e.target.value) })}
                        className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-2.5 py-1.5 text-sm outline-none focus:border-white/30"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-400">Pitch</label>
                      <input
                        type="number"
                        value={Math.round(selectedHotspot.pitch)}
                        onChange={(e) => updateHotspot({ pitch: Number(e.target.value) })}
                        className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-2.5 py-1.5 text-sm outline-none focus:border-white/30"
                      />
                    </div>
                  </div>
                </section>
              )}

              <AiPanel
                project={draft}
                onApplyScenes={(updates) =>
                  mutate((prev) => ({
                    ...prev,
                    scenes: prev.scenes.map((s) => {
                      const update = updates.find((u) => u.id === s.id);
                      return update
                        ? { ...s, name: update.name, narrationText: update.narrationText }
                        : s;
                    }),
                  }))
                }
                onApplyLinks={(links) =>
                  mutate((prev) => ({
                    ...prev,
                    scenes: prev.scenes.map((scene) => {
                      const forScene = links.filter((l) => l.fromSceneId === scene.id);
                      if (forScene.length === 0) return scene;
                      const existing = new Set(
                        scene.hotspots
                          .filter((h) => h.type === 'navigation')
                          .map((h) => h.actionValue),
                      );
                      const added = forScene
                        .filter((l) => !existing.has(l.toSceneId))
                        .map<Hotspot>((l) => ({
                          id: newId('hs'),
                          type: 'navigation',
                          yaw: l.yaw,
                          pitch: l.pitch,
                          label: l.label,
                          icon: 'arrow',
                          actionValue: l.toSceneId,
                          animation: 'pulse',
                        }));
                      return { ...scene, hotspots: [...scene.hotspots, ...added] };
                    }),
                  }))
                }
              />
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-slate-500">
              Add a scene to start editing
            </div>
          )}
        </aside>
      </div>

      {showPublish && (
        <PublishDialog project={draft} onClose={() => setShowPublish(false)} />
      )}
    </div>
  );
};
