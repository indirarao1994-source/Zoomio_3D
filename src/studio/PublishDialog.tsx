import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Publication } from '../api';
import type { Project } from '../types/tour';

type Mode = 'choose' | 'host' | 'done' | 'downloading';

interface PublishDialogProps {
  project: Project;
  onClose: () => void;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The publish flow. Two routes from one dialog: take the tour away as a static
 * folder, or have it hosted here on its own address immediately.
 */
export const PublishDialog: React.FC<PublishDialogProps> = ({ project, onClose }) => {
  const [mode, setMode] = useState<Mode>('choose');
  const [slug, setSlug] = useState(() => slugify(project.name || 'tour'));
  const [availability, setAvailability] = useState<'idle' | 'checking' | 'free' | 'taken'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<Publication | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const checkTimer = useRef<number>(0);

  // If this project is already live, open straight into its live state.
  useEffect(() => {
    let cancelled = false;
    void api.getPublication(project.id).then((existing) => {
      if (cancelled || !existing) return;
      setPublished(existing);
      setSlug(existing.slug);
      setMode('done');
    });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  // Debounced availability check so every keystroke doesn't hit the server.
  useEffect(() => {
    if (mode !== 'host') return;
    const candidate = slugify(slug);
    if (candidate.length < 3) {
      setAvailability('idle');
      return;
    }
    setAvailability('checking');
    window.clearTimeout(checkTimer.current);
    checkTimer.current = window.setTimeout(async () => {
      try {
        const result = await api.checkSlug(candidate, project.id);
        setAvailability(result.available ? 'free' : 'taken');
      } catch {
        setAvailability('idle');
      }
    }, 350);
    return () => window.clearTimeout(checkTimer.current);
  }, [slug, mode, project.id]);

  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setError('Could not copy — select the text and copy manually.');
    }
  }, []);

  const handleDownload = async () => {
    setMode('downloading');
    setError(null);
    try {
      await api.downloadTour(project);
      setMode('choose');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
      setMode('choose');
    }
  };

  const handlePublish = async () => {
    setBusy(true);
    setError(null);
    try {
      const record = await api.publish(project.id, slugify(slug));
      setPublished(record);
      setMode('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publishing failed');
    } finally {
      setBusy(false);
    }
  };

  const handleUnpublish = async () => {
    if (!published) return;
    setBusy(true);
    try {
      await api.unpublish(published.slug);
      setPublished(null);
      setMode('choose');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not take the tour offline');
    } finally {
      setBusy(false);
    }
  };

  const shareUrl = published?.urls?.subdomain ?? (published ? `/t/${published.slug}/` : '');
  const fallbackUrl = published?.urls?.path ?? '';
  const embedCode = shareUrl
    ? `<iframe src="${shareUrl}" width="100%" height="600" frameborder="0" allow="fullscreen; xr-spatial-tracking; gyroscope; accelerometer" allowfullscreen></iframe>`
    : '';

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        <header className="flex items-start justify-between border-b border-white/8 px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold text-white">Share this tour</h2>
            <p className="mt-0.5 text-sm text-slate-400">
              {project.name} · {project.scenes.length} scene
              {project.scenes.length === 1 ? '' : 's'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            ✕
          </button>
        </header>

        <div className="px-6 py-6">
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/25 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {/* ── choice ── */}
          {(mode === 'choose' || mode === 'downloading') && (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleDownload}
                disabled={mode === 'downloading'}
                className="group rounded-xl border border-white/10 bg-white/[0.02] p-5 text-left transition hover:border-white/25 hover:bg-white/[0.05] disabled:opacity-60"
              >
                <div className="mb-3 text-2xl">⬇</div>
                <div className="font-medium text-white">
                  {mode === 'downloading' ? 'Packaging…' : 'Download'}
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
                  A ZIP containing the whole tour. Put it on any web host you already
                  have — no server software needed.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setMode('host')}
                className="group rounded-xl border p-5 text-left transition"
                style={{
                  borderColor: `${project.primaryColor}55`,
                  background: `${project.primaryColor}12`,
                }}
              >
                <div className="mb-3 text-2xl">🌐</div>
                <div className="font-medium text-white">Host it with us</div>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
                  Goes live immediately on its own address that you can share with
                  anyone. Update it any time.
                </p>
              </button>
            </div>
          )}

          {/* ── choose an address ── */}
          {mode === 'host' && (
            <div>
              <label
                htmlFor="tour-slug"
                className="mb-2 block text-sm font-medium text-slate-200"
              >
                Choose a web address
              </label>
              <div className="flex items-center overflow-hidden rounded-lg border border-white/12 bg-slate-950/60 focus-within:border-white/30">
                <input
                  id="tour-slug"
                  value={slug}
                  autoFocus
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  onBlur={() => setSlug((s) => slugify(s))}
                  className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-sm text-white outline-none"
                  placeholder="my-hotel"
                />
                <span className="shrink-0 border-l border-white/10 px-3.5 py-2.5 text-sm text-slate-500">
                  .{window.location.host}
                </span>
              </div>

              <div className="mt-2 h-5 text-xs">
                {availability === 'checking' && <span className="text-slate-500">Checking…</span>}
                {availability === 'free' && (
                  <span className="text-emerald-400">✓ {slugify(slug)} is available</span>
                )}
                {availability === 'taken' && (
                  <span className="text-amber-400">
                    That address is taken or reserved — try another
                  </span>
                )}
                {availability === 'idle' && slugify(slug).length < 3 && (
                  <span className="text-slate-500">At least 3 characters</span>
                )}
              </div>

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('choose')}
                  className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-white/5"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={busy || availability === 'taken' || slugify(slug).length < 3}
                  className="flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-45"
                  style={{ background: project.primaryColor }}
                >
                  {busy ? 'Publishing…' : 'Publish now'}
                </button>
              </div>
            </div>
          )}

          {/* ── live ── */}
          {mode === 'done' && published && (
            <div>
              <div className="mb-4 flex items-center gap-2 text-sm text-emerald-400">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                Live · {published.sceneCount} scenes · {formatBytes(published.sizeBytes)}
                {published.views > 0 && ` · ${published.views} views`}
              </div>

              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Share this link
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-white/12 bg-slate-950/60 px-3.5 py-2.5 font-mono text-sm text-white outline-none"
                />
                <button
                  type="button"
                  onClick={() => copy(shareUrl, 'url')}
                  className="shrink-0 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition"
                  style={{ background: project.primaryColor }}
                >
                  {copied === 'url' ? 'Copied' : 'Copy'}
                </button>
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg border border-white/12 px-4 py-2.5 text-sm text-slate-200 transition hover:bg-white/5"
                >
                  Open
                </a>
              </div>

              {fallbackUrl && (
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Also reachable at{' '}
                  <a href={fallbackUrl} target="_blank" rel="noreferrer" className="underline">
                    {fallbackUrl}
                  </a>
                  . Use this one if the subdomain doesn&apos;t resolve — that needs a
                  wildcard DNS record, which isn&apos;t set up on every network.
                </p>
              )}

              <label className="mb-1.5 mt-5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Embed on your website
              </label>
              <div className="flex gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-white/12 bg-slate-950/60 px-3.5 py-2.5 font-mono text-xs text-slate-300">
                  {embedCode}
                </code>
                <button
                  type="button"
                  onClick={() => copy(embedCode, 'embed')}
                  className="shrink-0 rounded-lg border border-white/12 px-4 py-2.5 text-sm text-slate-200 transition hover:bg-white/5"
                >
                  {copied === 'embed' ? 'Copied' : 'Copy'}
                </button>
              </div>

              <div className="mt-6 flex flex-wrap gap-2 border-t border-white/8 pt-5">
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={busy}
                  className="rounded-lg border border-white/12 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/5 disabled:opacity-50"
                >
                  {busy ? 'Updating…' : 'Update live tour'}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="rounded-lg border border-white/12 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/5"
                >
                  Also download ZIP
                </button>
                <button
                  type="button"
                  onClick={handleUnpublish}
                  disabled={busy}
                  className="ml-auto rounded-lg px-4 py-2 text-sm text-red-300 transition hover:bg-red-950/40 disabled:opacity-50"
                >
                  Take offline
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
