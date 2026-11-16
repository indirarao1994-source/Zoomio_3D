import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { PanoEngine } from '../viewer/PanoEngine';
import type { PanoHotspot } from '../viewer/types';
import { toEngineScenes } from '../api';
import type { Scene } from '../types/tour';

export interface CanvasHandle {
  goToScene: (sceneId: string) => void;
  lookAt: (hotspot: PanoHotspot) => void;
  capture: () => string | null;
  camera: () => { yaw: number; pitch: number; fov: number } | null;
}

interface CanvasProps {
  scenes: Scene[];
  activeSceneId: string | null;
  accentColor: string;
  editMode?: boolean;
  onSceneChange?: (sceneId: string) => void;
  onPlace?: (yaw: number, pitch: number) => void;
  onHotspotClick?: (hotspot: PanoHotspot) => void;
  ref?: React.Ref<CanvasHandle>;
}

/**
 * Wraps PanoEngine for React. The engine owns the WebGL context and is created
 * exactly once; scene edits are pushed into it imperatively rather than
 * remounting, so a texture is never re-decoded because a label changed.
 */
export const Canvas: React.FC<CanvasProps> = ({
  scenes,
  activeSceneId,
  accentColor,
  editMode = false,
  onSceneChange,
  onPlace,
  onHotspotClick,
  ref,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PanoEngine | null>(null);
  const [progress, setProgress] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [xr, setXr] = useState<{ vr: boolean; ar: boolean }>({ vr: false, ar: false });

  // Latest callbacks without forcing the engine to be rebuilt on every render.
  const handlers = useRef({ onSceneChange, onPlace, onHotspotClick });
  handlers.current = { onSceneChange, onPlace, onHotspotClick };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || scenes.length === 0) return;

    const engine = new PanoEngine({
      container: mount,
      scenes: toEngineScenes(scenes),
      initialSceneId: activeSceneId ?? undefined,
      theme: { primaryColor: accentColor, textColor: '#ffffff' },
      editMode,
      xr: true,
      onProgress: (p) => setProgress(p),
      onError: (message) => setError(message),
      onSceneChange: (sceneId) => handlers.current.onSceneChange?.(sceneId),
      onPlace: (yaw, pitch) => handlers.current.onPlace?.(yaw, pitch),
      onHotspotClick: (hotspot) => handlers.current.onHotspotClick?.(hotspot),
    });
    engineRef.current = engine;
    void PanoEngine.xrSupport().then(setXr);

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // Deliberately mount-only: scene and theme updates are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes.length > 0]);

  useEffect(() => {
    engineRef.current?.setScenes(toEngineScenes(scenes));
  }, [scenes]);

  useEffect(() => {
    engineRef.current?.setTheme({ primaryColor: accentColor, textColor: '#ffffff' });
  }, [accentColor]);

  useEffect(() => {
    engineRef.current?.setEditMode(editMode);
  }, [editMode]);

  useEffect(() => {
    if (activeSceneId) void engineRef.current?.goToScene(activeSceneId);
  }, [activeSceneId]);

  useImperativeHandle(ref, () => ({
    goToScene: (sceneId) => void engineRef.current?.goToScene(sceneId),
    lookAt: (hotspot) => engineRef.current?.lookAtHotspot(hotspot),
    capture: () => engineRef.current?.captureThumbnail() ?? null,
    camera: () => engineRef.current?.getCamera() ?? null,
  }));

  const loading = progress > 0 && progress < 1;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#080b12]">
      <div ref={mountRef} className="absolute inset-0" />

      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-white/10">
          <div
            className="h-full transition-[width] duration-200"
            style={{ width: `${progress * 100}%`, background: accentColor }}
          />
        </div>
      )}

      {editMode && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 text-xs text-white/80 backdrop-blur">
          Click anywhere on the panorama to place a hotspot
        </div>
      )}

      {(xr.vr || xr.ar) && (
        <div className="absolute bottom-4 left-4 flex gap-2">
          {xr.vr && (
            <button
              type="button"
              onClick={() => engineRef.current?.enterXR('vr').catch((e) => setError(e.message))}
              className="rounded-lg border border-white/12 bg-black/55 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition hover:bg-black/75"
            >
              Enter VR
            </button>
          )}
          {xr.ar && (
            <button
              type="button"
              onClick={() => engineRef.current?.enterXR('ar').catch((e) => setError(e.message))}
              className="rounded-lg border border-white/12 bg-black/55 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition hover:bg-black/75"
            >
              Enter AR
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="absolute bottom-4 left-1/2 max-w-[80%] -translate-x-1/2 rounded-lg border border-red-500/30 bg-red-950/85 px-4 py-2 text-xs text-red-100 backdrop-blur">
          {error}
          <button
            type="button"
            className="ml-3 underline opacity-70 hover:opacity-100"
            onClick={() => setError(null)}
          >
            dismiss
          </button>
        </div>
      )}

      {scenes.length === 0 && (
        <div className="absolute inset-0 grid place-content-center text-center text-sm text-white/40">
          Add a 360° panorama to get started
        </div>
      )}
    </div>
  );
};
