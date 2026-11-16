import React, { useEffect, useState } from 'react';
import { api, type LinkSuggestion, type SceneAnalysis } from '../api';
import { makeAiPreview } from '../lib/images';
import type { Project } from '../types/tour';

interface AiPanelProps {
  project: Project;
  onApplyScenes: (updates: SceneAnalysis[]) => void;
  onApplyLinks: (links: LinkSuggestion[]) => void;
}

/**
 * Real model calls (Claude, or OpenRouter when that's the configured
 * provider) — not the scripted "agent" log this app used to show.
 * Every action is explicit and reports what it actually did, so nothing runs —
 * or spends — without the user asking for it.
 */
export const AiPanel: React.FC<AiPanelProps> = ({ project, onApplyScenes, onApplyLinks }) => {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [provider, setProvider] = useState<'anthropic' | 'openrouter' | null>(null);
  const [busy, setBusy] = useState<'scenes' | 'links' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SceneAnalysis[] | null>(null);
  const [links, setLinks] = useState<LinkSuggestion[] | null>(null);

  useEffect(() => {
    void api
      .aiStatus()
      .then((s) => {
        setEnabled(s.enabled);
        setProvider(s.provider);
      })
      .catch(() => setEnabled(false));
  }, []);

  const describeScenes = async () => {
    setBusy('scenes');
    setError(null);
    setAnalysis(null);
    try {
      setStatus(`Preparing ${project.scenes.length} panoramas…`);
      // Downscaled here rather than server-side: a 1024x512 copy is ~700 image
      // tokens instead of ~4800, and the full file never leaves the browser.
      const scenes = [];
      for (const scene of project.scenes) {
        const preview = await makeAiPreview(scene.imageUrl);
        scenes.push({
          id: scene.id,
          fileName: scene.name,
          imageBase64: preview.base64,
          mediaType: preview.mediaType,
        });
      }

      // Named per provider — saying "Claude" while OpenRouter is answering
      // would misattribute the work.
      setStatus(
        `${provider === 'openrouter' ? 'The model' : 'Claude'} is looking at each panorama…`,
      );
      const result = await api.analyzeScenes({
        projectContext: {
          name: project.name,
          category: project.category,
          description: project.description,
          location: project.location,
        },
        scenes,
      });
      setAnalysis(result.scenes);
      setStatus(
        result.warning
          ? `Described ${result.scenes.length} scenes — ${result.warning}`
          : `Described ${result.scenes.length} scenes`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
      setStatus(null);
    } finally {
      setBusy(null);
    }
  };

  const suggestLinks = async () => {
    setBusy('links');
    setError(null);
    setLinks(null);
    try {
      setStatus('Working out which spaces connect…');
      const result = await api.suggestLinks({
        category: project.category,
        scenes: project.scenes.map((s) => ({
          id: s.id,
          name: s.name,
          shortDescription: s.narrationText?.slice(0, 140),
        })),
      });
      setLinks(result.links);
      setStatus(
        result.warning
          ? `Suggested ${result.links.length} connections — ${result.warning}`
          : `Suggested ${result.links.length} connections`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suggestion failed');
      setStatus(null);
    } finally {
      setBusy(null);
    }
  };

  if (enabled === false) {
    return (
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
          AI assistance
        </h3>
        <p className="text-xs leading-relaxed text-slate-400">
          Not configured. Add <code className="text-slate-300">ANTHROPIC_API_KEY</code>{' '}
          (recommended) or a free{' '}
          <code className="text-slate-300">OPENROUTER_API_KEY</code> to your{' '}
          <code className="text-slate-300">.env</code> and restart the server to have AI
          name your scenes, write narration, and propose the navigation graph.
        </p>
        <p className="mt-2 text-[11px] text-slate-600">
          Everything here works without it — you just write the copy yourself.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
          AI assistance
        </h3>
        {provider === 'openrouter' && (
          <span
            className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400"
            title="Free tier — weaker at reading panoramas than the recommended Anthropic path, and JSON replies aren't guaranteed to parse."
          >
            OpenRouter (free, testing)
          </span>
        )}
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={describeScenes}
          disabled={busy !== null || project.scenes.length === 0}
          className="w-full rounded-lg border border-white/12 px-3 py-2 text-left text-xs transition hover:bg-white/5 disabled:opacity-40"
        >
          <span className="font-medium text-slate-200">Name & describe scenes</span>
          <span className="mt-0.5 block text-[11px] text-slate-500">
            Looks at each panorama, writes a title and narration
          </span>
        </button>

        <button
          type="button"
          onClick={suggestLinks}
          disabled={busy !== null || project.scenes.length < 2}
          className="w-full rounded-lg border border-white/12 px-3 py-2 text-left text-xs transition hover:bg-white/5 disabled:opacity-40"
        >
          <span className="font-medium text-slate-200">Suggest connections</span>
          <span className="mt-0.5 block text-[11px] text-slate-500">
            Proposes which scenes should link to each other
          </span>
        </button>
      </div>

      {busy && (
        <p className="mt-2.5 flex items-center gap-2 text-[11px] text-slate-400">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          {status}
        </p>
      )}
      {!busy && status && <p className="mt-2.5 text-[11px] text-emerald-400">{status}</p>}
      {error && <p className="mt-2.5 text-[11px] leading-relaxed text-red-400">{error}</p>}

      {analysis && (
        <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/40 p-2.5">
          <ul className="max-h-40 space-y-1.5 overflow-y-auto text-[11px]">
            {analysis.map((a) => (
              <li key={a.id}>
                <span className="font-medium text-slate-200">{a.name}</span>
                <span className="block text-slate-500">{a.shortDescription}</span>
                {a.qualityNotes.length > 0 && (
                  <span className="block text-amber-500/80">⚠ {a.qualityNotes[0]}</span>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              onApplyScenes(analysis);
              setAnalysis(null);
              setStatus('Applied to scenes');
            }}
            className="mt-2.5 w-full rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-900"
          >
            Apply names & narration
          </button>
        </div>
      )}

      {links && (
        <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/40 p-2.5">
          <ul className="max-h-40 space-y-1 overflow-y-auto text-[11px] text-slate-400">
            {links.slice(0, 20).map((l, i) => (
              <li key={i} className="truncate">
                {project.scenes.find((s) => s.id === l.fromSceneId)?.name} →{' '}
                {project.scenes.find((s) => s.id === l.toSceneId)?.name}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              onApplyLinks(links);
              setLinks(null);
              setStatus('Added navigation hotspots');
            }}
            className="mt-2.5 w-full rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-900"
          >
            Add {links.length} navigation hotspots
          </button>
        </div>
      )}
    </section>
  );
};
