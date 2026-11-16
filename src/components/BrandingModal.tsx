import React, { useRef, useState } from 'react';
import { X, Upload, Loader2, AlertCircle, Trash2, Palette } from 'lucide-react';
import type { Project } from '../types/tour';
import { api } from '../api';

interface BrandingModalProps {
  project: Project;
  onChange: (patch: Partial<Project>) => void;
  onClose: () => void;
}

const PRESET_COLORS = [
  '#0d9488', '#2563eb', '#4f46e5', '#7c3aed',
  '#db2777', '#dc2626', '#ea580c', '#ca8a04',
  '#16a34a', '#0891b2', '#475569', '#111827',
];

/**
 * Project-level branding: the logo, accent colour and credit line that appear
 * in every published tour and downloaded ZIP.
 *
 * Kept out of the scene tool rail deliberately — those tools act on one scene,
 * whereas everything here applies to the whole tour.
 */
export const BrandingModal: React.FC<BrandingModalProps> = ({ project, onChange, onClose }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const theme = project.theme ?? ({} as Project['theme']);
  const accent = project.primaryColor || theme?.primaryColor || '#2563eb';
  const watermarkText = theme?.watermarkText ?? 'Created with Zoomio';
  const showWatermark = theme?.showWatermark !== false;

  const patchTheme = (patch: Partial<NonNullable<Project['theme']>>) =>
    onChange({ theme: { ...(theme as object), ...patch } as Project['theme'] });

  const setAccent = (color: string) => {
    // Written to both places: the publisher reads project.primaryColor, while
    // the studio's own UI reads theme.primaryColor.
    onChange({ primaryColor: color });
    patchTheme({ primaryColor: color });
  };

  const uploadLogo = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      setError('Logos should be under 2 MB — it only renders about 30px tall.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let url: string;
      try {
        url = (await api.uploadPanorama(file)).url;
      } catch {
        // Inline fallback so branding still works without a reachable server.
        url = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => reject(new Error('Could not read that image'));
          r.readAsDataURL(file);
        });
      }
      // `project.logo` is what the publisher actually embeds; `theme.logoUrl`
      // is mirrored so the two never disagree.
      onChange({ logo: url });
      patchTheme({ logoUrl: url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logo upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-md"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 text-slate-800 shadow-2xl">
        <div className="mb-5 flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-indigo-100 bg-indigo-50 text-indigo-600">
              <Palette size={20} />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Branding</h3>
              <p className="text-xs font-medium text-slate-500">
                Applies to every published tour and download
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
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

        {/* Live preview of the player's header + credit line. */}
        <div
          className="mb-5 overflow-hidden rounded-2xl border border-slate-200"
          style={{ background: 'linear-gradient(135deg,#1e293b,#0f172a)' }}
        >
          <div className="flex items-center justify-between p-3">
            <div className="flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2 backdrop-blur">
              {project.logo && (
                <img src={project.logo} alt="" className="h-6 w-auto rounded" />
              )}
              <div className="leading-tight">
                <div className="text-[11px] font-semibold text-white">
                  {project.scenes[0]?.name || 'First room'}
                </div>
                <div className="text-[9px] text-white/50">{project.name}</div>
              </div>
            </div>
            <div className="h-7 w-7 rounded-lg" style={{ background: accent }} />
          </div>
          <div className="px-3 pb-2 text-right">
            {showWatermark && (
              <span className="text-[8px] uppercase tracking-widest text-white/40">
                {watermarkText}
              </span>
            )}
          </div>
        </div>

        {/* ── logo ── */}
        <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">
          Logo
        </label>
        <div className="mb-5 flex items-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {project.logo ? 'Replace logo' : 'Upload logo'}
          </button>
          {project.logo && (
            <button
              onClick={() => { onChange({ logo: undefined }); patchTheme({ logoUrl: undefined }); }}
              title="Remove logo"
              className="rounded-xl border border-rose-200 px-3 py-2.5 text-rose-500 transition-colors hover:bg-rose-50"
            >
              <Trash2 size={14} />
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadLogo(f);
              e.target.value = '';
            }}
          />
        </div>

        {/* ── accent ── */}
        <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">
          Accent colour
        </label>
        <div className="mb-2 grid grid-cols-12 gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setAccent(c)}
              aria-label={`Use ${c}`}
              className={`aspect-square rounded-lg transition-transform ${
                accent.toLowerCase() === c.toLowerCase()
                  ? 'ring-2 ring-slate-900 ring-offset-2'
                  : 'hover:scale-110'
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="mb-5 flex items-center gap-2">
          <input
            type="color"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
          />
          <input
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500 focus:bg-white"
          />
        </div>

        {/* ── credit line ── */}
        <label className="mb-1.5 block text-[11px] font-black uppercase tracking-wider text-slate-400">
          Credit line
        </label>
        <input
          value={watermarkText}
          onChange={(e) => patchTheme({ watermarkText: e.target.value })}
          placeholder="Created with Zoomio"
          className="mb-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:bg-white"
        />
        <label className="mb-5 flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={showWatermark}
            onChange={(e) => patchTheme({ showWatermark: e.target.checked })}
            className="accent-indigo-600"
          />
          Show the credit line in published tours
        </label>

        <button
          onClick={onClose}
          className="w-full rounded-2xl bg-gradient-to-r from-indigo-600 to-rose-500 px-5 py-3 text-xs font-extrabold text-white shadow-lg shadow-indigo-500/25 transition-all hover:opacity-90"
        >
          Done
        </button>
        <p className="mt-2.5 text-center text-[10px] text-slate-400">
          Re-publish the tour for changes to reach visitors.
        </p>
      </div>
    </div>
  );
};
