import React, { useEffect, useState } from 'react';
import { api, type Publication } from '../api';
import type { Project } from '../types/tour';

interface DashboardProps {
  onOpen: (project: Project) => void;
}

const CATEGORIES: Array<{ value: Project['category']; label: string }> = [
  { value: 'hotel', label: 'Hotel' },
  { value: 'real-estate', label: 'Real estate' },
  { value: 'university', label: 'Campus' },
  { value: 'museum', label: 'Museum' },
  { value: 'mall', label: 'Retail' },
  { value: 'hospital', label: 'Healthcare' },
  { value: 'other', label: 'Other' },
];

const PRESET_COLORS = ['#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed'];

function blankProject(name: string, category: Project['category'], color: string): Project {
  const now = new Date().toISOString();
  return {
    id: `proj_${Date.now().toString(36)}`,
    name,
    category,
    description: '',
    location: '',
    primaryColor: color,
    scenes: [],
    floorPlans: [],
    theme: {
      preset: 'modern',
      primaryColor: color,
      secondaryColor: '#0f172a',
      textColor: '#ffffff',
      fontFamily: 'Inter',
      borderRadius: '14px',
      showWatermark: true,
      watermarkText: '360° Virtual Tour',
    },
    accessibility: {
      keyboardNavigation: true,
      screenReaderDescriptions: {},
      highContrastMode: false,
      audioDescriptions: false,
    },
    analytics: { visits: 0, averageTime: 0, hotspotClicks: {}, sceneViews: {}, heatmapData: [] },
    createdAt: now,
    updatedAt: now,
  };
}

export const Dashboard: React.FC<DashboardProps> = ({ onOpen }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [published, setPublished] = useState<Record<string, Publication>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Project['category']>('hotel');
  const [color, setColor] = useState(PRESET_COLORS[0]);

  const load = async () => {
    setLoading(true);
    try {
      const [list, pubs] = await Promise.all([api.listProjects(), api.listPublications()]);
      setProjects(list);
      setPublished(Object.fromEntries(pubs.map((p) => [p.projectId, p])));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const project = await api.createProject(blankProject(trimmed, category, color));
      setCreating(false);
      setName('');
      onOpen(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the project');
    }
  };

  const remove = async (project: Project) => {
    if (!window.confirm(`Delete "${project.name}"? This also takes it offline if published.`)) {
      return;
    }
    try {
      await api.deleteProject(project.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the project');
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0e14] text-slate-100">
      <header className="border-b border-white/8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Virtual Tour Studio</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Build 360° tours, then download them or host them here
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-200"
          >
            New tour
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {error && (
          <div className="mb-5 rounded-lg border border-red-500/25 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <p className="py-16 text-center text-sm text-slate-500">Loading…</p>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/12 px-6 py-20 text-center">
            <p className="text-sm text-slate-400">No tours yet.</p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-900"
            >
              Create your first tour
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const live = published[project.id];
              const cover = project.scenes[0]?.thumbnail;
              return (
                <div
                  key={project.id}
                  className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] transition hover:border-white/25"
                >
                  <button
                    type="button"
                    onClick={() => onOpen(project)}
                    className="block w-full text-left"
                  >
                    <div className="relative aspect-video bg-slate-800">
                      {cover ? (
                        <img src={cover} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full place-content-center text-xs text-slate-600">
                          {/* A project can have scenes but no thumbnail — e.g. one
                              created through the API rather than the importer. */}
                          {project.scenes.length > 0 ? 'No preview image' : 'No panoramas yet'}
                        </div>
                      )}
                      {live && (
                        <span className="absolute left-2 top-2 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-medium text-white">
                          Live
                        </span>
                      )}
                    </div>
                    <div className="p-3.5">
                      <div className="truncate text-sm font-medium">{project.name}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {project.scenes.length} scene{project.scenes.length === 1 ? '' : 's'} ·{' '}
                        {project.category}
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-3 border-t border-white/8 px-3.5 py-2 text-xs">
                    {live?.urls?.subdomain ? (
                      <a
                        href={live.urls.subdomain}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-slate-400 underline-offset-2 hover:text-white hover:underline"
                      >
                        {live.slug}
                      </a>
                    ) : live ? (
                      <a
                        href={`/t/${live.slug}/`}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-slate-400 underline-offset-2 hover:text-white hover:underline"
                      >
                        /t/{live.slug}
                      </a>
                    ) : (
                      <span className="text-slate-600">Not published</span>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(project)}
                      className="ml-auto shrink-0 text-slate-600 transition hover:text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {creating && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && setCreating(false)}
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-base font-semibold">New tour</h2>

            <label className="mb-1 mt-4 block text-xs text-slate-400">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
              placeholder="Aurora Grand Hotel"
              className="w-full rounded-lg border border-white/12 bg-slate-950/60 px-3 py-2.5 text-sm outline-none focus:border-white/30"
            />

            <label className="mb-1.5 mt-4 block text-xs text-slate-400">Type</label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
                    category === c.value
                      ? 'border-white/40 bg-white/10 text-white'
                      : 'border-white/10 text-slate-400 hover:bg-white/5'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <label className="mb-1.5 mt-4 block text-xs text-slate-400">Accent colour</label>
            <div className="flex gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Use ${c}`}
                  className={`h-7 w-7 rounded-full transition ${
                    color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : ''
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-lg border border-white/12 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={create}
                disabled={!name.trim()}
                className="flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition disabled:opacity-40"
                style={{ background: color }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
