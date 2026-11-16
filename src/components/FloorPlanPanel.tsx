import React, { useMemo, useRef, useState } from 'react';
import { Upload, Trash2, MapPin, Check, Wand2, Compass } from 'lucide-react';
import type { FloorPlan, Scene } from '../types/tour';
import { api } from '../api';
import { applyPlanConnections, planConnections } from '../lib/autoConnect';

interface FloorPlanPanelProps {
  floorPlans: FloorPlan[];
  scenes: Scene[];
  activeSceneId: string;
  accentColor: string;
  onChange: (plans: FloorPlan[]) => void;
  onSelectScene: (sceneId: string) => void;
  /** Replaces navigation hotspots across every scene at once. */
  onApplyConnections?: (scenes: Scene[]) => void;
}

/**
 * Floor plan authoring: upload a plan image, then click it to pin each scene
 * to its real position. Marker coordinates are stored as percentages rather
 * than pixels so the same plan stays correct at any display size — the player
 * renders the minimap much smaller than this editor does.
 */
export const FloorPlanPanel: React.FC<FloorPlanPanelProps> = ({
  floorPlans,
  scenes,
  activeSceneId,
  accentColor,
  onChange,
  onSelectScene,
  onApplyConnections,
}) => {
  const plan = floorPlans[0] ?? null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which scene the next click on the plan will pin.
  const [arming, setArming] = useState<string | null>(activeSceneId);
  /** Rotates every derived bearing so plan-north lines up with the panoramas. */
  const [northOffset, setNorthOffset] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  // Preview of the routes that would be created, drawn over the plan.
  const routes = useMemo(
    () => (plan ? planConnections(plan, scenes) : []),
    [plan, scenes],
  );

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      let url: string;
      try {
        url = (await api.uploadPanorama(file)).url;
      } catch {
        // Fall back to an inline copy so the plan still works without a server.
        url = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => reject(new Error('Could not read that image'));
          r.readAsDataURL(file);
        });
      }
      onChange([
        {
          id: plan?.id ?? `fp_${Math.random().toString(36).slice(2, 10)}`,
          name: file.name.replace(/\.[^/.]+$/, ''),
          imageUrl: url,
          markers: plan?.markers ?? [],
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const placeMarker = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!plan || !arming) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const markers = plan.markers.filter((m) => m.sceneId !== arming);
    markers.push({ sceneId: arming, x, y });
    onChange([{ ...plan, markers }]);

    // Advance to the next unplaced scene so a whole plan can be pinned in one pass.
    const placed = new Set(markers.map((m) => m.sceneId));
    setArming(scenes.find((s) => !placed.has(s.id))?.id ?? null);
  };

  const removeMarker = (sceneId: string) => {
    if (!plan) return;
    onChange([{ ...plan, markers: plan.markers.filter((m) => m.sceneId !== sceneId) }]);
  };

  const placedIds = new Set(plan?.markers.map((m) => m.sceneId) ?? []);

  return (
    <div>
      <div className="px-4 py-3 border-b border-slate-800/60">
        <h3 className="text-xs font-bold text-white">Floor Plan &amp; Map</h3>
        <p className="text-[10px] text-slate-500 mt-0.5">
          Pin each scene to its spot so visitors can navigate by map
        </p>
      </div>

      <div className="p-4 space-y-4">
        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-200">
            {error}
          </div>
        )}

        {!plan ? (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="w-full rounded-xl border border-dashed border-slate-600 px-4 py-10 text-center
              transition hover:border-slate-400 disabled:opacity-50"
          >
            <Upload size={20} className="mx-auto mb-2 text-slate-400" />
            <div className="text-xs font-bold text-slate-200">
              {busy ? 'Uploading…' : 'Upload floor plan'}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              A site map, blueprint, or hand-drawn layout
            </div>
          </button>
        ) : (
          <>
            {/* Plan with markers. Clicking pins the armed scene. */}
            <div
              className="relative overflow-hidden rounded-xl border border-slate-700 bg-slate-900"
              style={{ cursor: arming ? 'crosshair' : 'default' }}
              onClick={placeMarker}
            >
              <img src={plan.imageUrl} alt={plan.name} className="block w-full" />

              {/* Route preview: shows exactly which rooms will be linked. */}
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {routes
                  // Each pair appears twice (both directions) — draw one line.
                  .filter((r) => r.fromSceneId < r.toSceneId)
                  .map((r, i) => {
                    const a = plan.markers.find((m) => m.sceneId === r.fromSceneId);
                    const b = plan.markers.find((m) => m.sceneId === r.toSceneId);
                    if (!a || !b) return null;
                    return (
                      <line
                        key={i}
                        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke={accentColor}
                        strokeWidth="0.6"
                        strokeDasharray="2 1.5"
                        vectorEffect="non-scaling-stroke"
                        opacity="0.75"
                      />
                    );
                  })}
              </svg>

              {plan.markers.map((m) => {
                const scene = scenes.find((s) => s.id === m.sceneId);
                const isCurrent = m.sceneId === activeSceneId;
                return (
                  <button
                    key={m.sceneId}
                    title={scene?.name ?? 'Removed scene'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectScene(m.sceneId);
                    }}
                    className="absolute -translate-x-1/2 -translate-y-full transition-transform hover:scale-110"
                    style={{ left: `${m.x}%`, top: `${m.y}%` }}
                  >
                    <MapPin
                      size={isCurrent ? 22 : 16}
                      fill={isCurrent ? accentColor : '#94a3b8'}
                      color="#fff"
                      strokeWidth={1.5}
                      style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.6))' }}
                    />
                  </button>
                );
              })}
            </div>

            {arming && (
              <div
                className="rounded-lg px-3 py-2 text-[11px] font-bold"
                style={{ background: `${accentColor}20`, color: accentColor }}
              >
                Click the plan to pin “{scenes.find((s) => s.id === arming)?.name}”
              </div>
            )}

            {/* Scene checklist */}
            <div className="space-y-1">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                Scenes ({placedIds.size}/{scenes.length} pinned)
              </div>
              {scenes.map((s) => {
                const isPlaced = placedIds.has(s.id);
                const isArmed = arming === s.id;
                return (
                  <div
                    key={s.id}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] transition ${
                      isArmed ? 'bg-slate-700' : 'bg-slate-800/50 hover:bg-slate-800'
                    }`}
                  >
                    <button
                      onClick={() => setArming(isArmed ? null : s.id)}
                      className="flex flex-1 items-center gap-2 text-left"
                    >
                      {isPlaced ? (
                        <Check size={12} className="shrink-0 text-emerald-400" />
                      ) : (
                        <span className="h-3 w-3 shrink-0 rounded-full border border-slate-600" />
                      )}
                      <span className="truncate text-slate-200">{s.name}</span>
                    </button>
                    {isPlaced && (
                      <button
                        onClick={() => removeMarker(s.id)}
                        title="Remove pin"
                        className="text-slate-500 transition hover:text-rose-400"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── auto-connect ── */}
            {onApplyConnections && placedIds.size >= 2 && (
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-slate-200">
                  <Wand2 size={12} style={{ color: accentColor }} />
                  Connect rooms automatically
                </div>
                <p className="mb-2.5 text-[10px] leading-relaxed text-slate-500">
                  Works out which rooms adjoin from their pin positions, and points each
                  doorway hotspot the right way. Replaces existing navigation hotspots;
                  info and media hotspots are kept.
                </p>

                <div className="mb-2">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Compass size={10} /> Plan rotation
                    </span>
                    <span className="font-bold text-slate-300">{northOffset}°</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={359}
                    value={northOffset}
                    onChange={(e) => setNorthOffset(Number(e.target.value))}
                    className="w-full"
                    style={{ accentColor }}
                  />
                  <p className="mt-1 text-[9px] leading-relaxed text-slate-600">
                    If the arrows point at walls instead of doors, the plan and the photos
                    disagree about north — turn this until they line up.
                  </p>
                </div>

                <button
                  onClick={() => {
                    const result = applyPlanConnections(scenes, plan, northOffset);
                    onApplyConnections(result.scenes);
                    setNotice(
                      `Linked ${routes.length / 2} doorway${routes.length === 2 ? '' : 's'} · ` +
                        `${result.created} hotspots created`,
                    );
                    window.setTimeout(() => setNotice(null), 4000);
                  }}
                  className="w-full rounded-lg px-3 py-2 text-[11px] font-bold text-white transition hover:opacity-90"
                  style={{ background: accentColor }}
                >
                  Connect {placedIds.size} rooms
                </button>

                {notice && (
                  <p className="mt-2 text-[10px] font-bold text-emerald-400">{notice}</p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex-1 rounded-lg border border-slate-700 px-3 py-2 text-[11px] font-bold text-slate-300 transition hover:bg-slate-800"
              >
                Replace image
              </button>
              <button
                onClick={() => onChange([])}
                className="rounded-lg border border-rose-500/30 px-3 py-2 text-[11px] font-bold text-rose-400 transition hover:bg-rose-950/40"
              >
                Remove
              </button>
            </div>
          </>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
};
