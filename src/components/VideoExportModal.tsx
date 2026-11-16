import React, { useMemo, useRef, useState } from 'react';
import { X, Film, Download, Loader2, AlertCircle, Check } from 'lucide-react';
import type { Project } from '../types/tour';
import { ORIENTATIONS, type OrientationSpec } from '../video/cameraPath';
import { renderTourVideo } from '../video/renderVideo';

interface VideoExportModalProps {
  project: Project;
  onClose: () => void;
}

type Stage = 'choose' | 'rendering' | 'done';

const FPS = 30;

export const VideoExportModal: React.FC<VideoExportModalProps> = ({ project, onClose }) => {
  const [stage, setStage] = useState<Stage>('choose');
  const [orientation, setOrientation] = useState<OrientationSpec>(ORIENTATIONS[1]); // portrait default
  const [secondsPerScene, setSecondsPerScene] = useState(5);
  const [progress, setProgress] = useState({ label: '', ratio: 0 });
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scenes = project.scenes ?? [];
  const duration = useMemo(
    () => Math.round(scenes.length * secondsPerScene),
    [scenes.length, secondsPerScene],
  );
  const frameCount = duration * FPS;

  const start = async () => {
    setStage('rendering');
    setError(null);
    setProgress({ label: 'Starting', ratio: 0 });
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const blob = await renderTourVideo({
        scenes: scenes.map((s) => ({
          id: s.id,
          name: s.name,
          imageUrl: s.imageUrl,
          initialYaw: s.initialView?.yaw ?? 0,
        })),
        orientation,
        secondsPerScene,
        fps: FPS,
        tourName: project.name,
        subtitle: project.location || undefined,
        accentColor: project.primaryColor || '#6366f1',
        signal: controller.signal,
        onProgress: (label, ratio) => setProgress({ label, ratio }),
      });
      setVideoUrl(URL.createObjectURL(blob));
      setStage('done');
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setStage('choose');
        return;
      }
      // Keep the raw failure in the console: ffmpeg.wasm surfaces problems as
      // plain strings or events, which would otherwise be reduced to a useless
      // generic message.
      console.error('[video export]', err);
      const detail =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : JSON.stringify(err)?.slice(0, 200) || String(err);
      setError(`Video export failed: ${detail}`);
      setStage('choose');
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const download = () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${orientation.id}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const close = () => {
    cancel();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 text-slate-800 shadow-2xl">
        <div className="mb-5 flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-indigo-100 bg-indigo-50 text-indigo-600">
              <Film size={20} />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Export as video</h3>
              <p className="text-xs font-medium text-slate-500">
                A shareable MP4 walkthrough of this tour
              </p>
            </div>
          </div>
          <button
            onClick={close}
            className="rounded-xl p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        {/* ── 1. orientation ── */}
        {stage === 'choose' && (
          <>
            <label className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-400">
              1 · Choose orientation
            </label>
            <div className="mb-5 grid grid-cols-3 gap-2">
              {ORIENTATIONS.map((o) => {
                const selected = o.id === orientation.id;
                // Miniature preview of the actual output shape.
                const boxH = 46;
                const boxW = Math.round((o.width / o.height) * boxH);
                return (
                  <button
                    key={o.id}
                    onClick={() => setOrientation(o)}
                    className={`rounded-2xl border p-3 text-center transition-all ${
                      selected
                        ? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="mb-2 flex h-12 items-center justify-center">
                      <div
                        className={`rounded border-2 ${
                          selected ? 'border-indigo-500 bg-indigo-200/50' : 'border-slate-300 bg-slate-100'
                        }`}
                        style={{ width: boxW, height: boxH }}
                      />
                    </div>
                    <div className="text-[11px] font-bold text-slate-800">{o.label}</div>
                    <div className="mt-0.5 text-[9px] leading-tight text-slate-500">{o.hint}</div>
                  </button>
                );
              })}
            </div>

            {/* ── 2. pacing ── */}
            <label className="mb-2 block text-[11px] font-black uppercase tracking-wider text-slate-400">
              2 · Seconds per scene
            </label>
            <div className="mb-2 flex items-center gap-3">
              <input
                type="range"
                min={3}
                max={10}
                step={1}
                value={secondsPerScene}
                onChange={(e) => setSecondsPerScene(Number(e.target.value))}
                className="flex-1 accent-indigo-600"
              />
              <span className="w-10 text-right text-xs font-bold text-slate-700">
                {secondsPerScene}s
              </span>
            </div>

            <div className="mb-5 rounded-2xl bg-slate-50 p-3 text-[11px] font-medium text-slate-600">
              <div className="flex justify-between">
                <span>Scenes</span>
                <b className="text-slate-800">{scenes.length}</b>
              </div>
              <div className="mt-1 flex justify-between">
                <span>Final length</span>
                <b className="text-slate-800">
                  {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}
                </b>
              </div>
              <div className="mt-1 flex justify-between">
                <span>Resolution</span>
                <b className="text-slate-800">
                  {orientation.width}×{orientation.height} · {FPS}fps
                </b>
              </div>
              <p className="mt-2 leading-relaxed text-slate-500">
                {frameCount.toLocaleString()} frames are rendered in your browser, so this
                takes a few minutes and the tab must stay open. Nothing is uploaded.
              </p>
            </div>

            <button
              onClick={start}
              disabled={scenes.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-rose-500 px-5 py-3.5 text-xs font-extrabold text-white shadow-lg shadow-indigo-500/25 transition-all hover:opacity-90 disabled:opacity-50"
            >
              <Film size={16} />
              Generate {orientation.label} video
            </button>
          </>
        )}

        {/* ── rendering ── */}
        {stage === 'rendering' && (
          <div className="py-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-700">
              <Loader2 size={14} className="animate-spin text-indigo-600" />
              {progress.label}…
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-rose-500 transition-[width] duration-150"
                style={{ width: `${Math.round(progress.ratio * 100)}%` }}
              />
            </div>
            <div className="mt-1.5 text-right text-[10px] font-bold text-slate-500">
              {Math.round(progress.ratio * 100)}%
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
              Keep this tab open and in the foreground. Browsers throttle background
              tabs, which would stall the render.
            </p>
            <button
              onClick={cancel}
              className="mt-4 w-full rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        )}

        {/* ── done ── */}
        {stage === 'done' && videoUrl && (
          <div>
            <div className="mb-3 flex items-center gap-1.5 text-xs font-bold text-emerald-600">
              <Check size={14} /> Video ready
            </div>
            <video
              src={videoUrl}
              controls
              playsInline
              className="mb-4 max-h-[46vh] w-full rounded-2xl border border-slate-200 bg-black"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setStage('choose')}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"
              >
                Make another
              </button>
              <button
                onClick={download}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-rose-500 px-5 py-3 text-xs font-extrabold text-white shadow-lg shadow-indigo-500/25"
              >
                <Download size={15} /> Download MP4
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
