import React, { useState, useEffect } from 'react';
import type { Project } from '../types/tour';
import { api, type Publication } from '../api';
import { generateOfflineTourZip } from '../utils/exportGenerator';
import confetti from 'canvas-confetti';
import {
  Globe, ExternalLink, Download, Copy, Check, Sparkles, X,
  Loader2, AlertCircle, Play, ShieldCheck, CheckCircle2
} from 'lucide-react';

interface PublishModalProps {
  project: Project;
  onClose: () => void;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'tour';
}

export const PublishModal: React.FC<PublishModalProps> = ({ project, onClose }) => {
  const [slug, setSlug] = useState<string>(() => slugify(project.name));
  const [publishing, setPublishing] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [publication, setPublication] = useState<Publication | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Which address to hand the user. `root` (example.com/my-tour) works
   * everywhere with no DNS setup, so it is the safe default; `subdomain`
   * (my-tour.example.com) looks better but needs a wildcard DNS record.
   */
  const [linkStyle, setLinkStyle] = useState<'root' | 'subdomain'>('root');

  // Check if project is already published
  useEffect(() => {
    let active = true;
    api.getPublication(project.id)
      .then(pub => {
        if (active && pub) {
          setPublication(pub);
          setSlug(pub.slug);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [project.id]);

  // Publish & Open Subdomain
  const handlePublishAndOpen = async () => {
    setPublishing(true);
    setError(null);
    const cleanSlug = slugify(slug);

    try {
      // The editor holds projects in memory, so the server may never have seen
      // this one. Push it up first or the publish call 404s.
      await api.upsertProject(project);

      const pub = await api.publish(project.id, cleanSlug);
      setPublication(pub);
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });

      const targetUrl =
        (linkStyle === 'root' ? pub.urls?.root : pub.urls?.subdomain) ||
        pub.urls?.root ||
        pub.urls?.path ||
        `/${pub.slug}/`;
      window.open(targetUrl, '_blank');
    } catch (err: any) {
      // Report the failure rather than opening a URL that was never published —
      // a dead tab looks like a broken tour instead of a clear error.
      setError(err?.message || 'Could not publish this tour. Is the server running?');
    } finally {
      setPublishing(false);
    }
  };

  // Download ZIP
  const handleDownloadZip = async () => {
    setDownloading(true);
    setError(null);
    try {
      // Build server-side so the download is byte-identical to the hosted tour
      // and ships the same verified player.
      await api.upsertProject(project);
      await api.downloadTour(project);
      confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
    } catch (err: any) {
      setError(err?.message || 'Failed to generate tour ZIP package.');
    } finally {
      setDownloading(false);
    }
  };

  // Copy Link
  const handleCopyLink = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Derive the host from the page rather than hardcoding a port, so the
  // preview address is correct on any deployment (and on any dev port).
  const subdomainUrl =
    publication?.urls?.subdomain ||
    `${window.location.protocol}//${slugify(slug)}.${window.location.host}/`;
  const rootUrl = publication?.urls?.root || `${window.location.origin}/${slugify(slug)}/`;
  const pathUrl = publication?.urls?.path || `${window.location.origin}/t/${slugify(slug)}/`;
  const shareUrl = linkStyle === 'root' ? rootUrl : subdomainUrl;

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative text-slate-800 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-bold">
              <Globe size={20} />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Publish & Launch Virtual Tour</h3>
              <p className="text-xs text-slate-500 font-medium">Go live on your own link, or download the tour</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Subdomain Input */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-[11px] uppercase font-black text-slate-400 tracking-wider mb-1.5">
              Tour Address
            </label>

            {/* Address style: short path (no DNS needed) vs subdomain. */}
            <div className="flex gap-1.5 mb-2">
              <button
                type="button"
                onClick={() => setLinkStyle('root')}
                className={`flex-1 px-3 py-2 rounded-xl text-[11px] font-bold border transition-all ${
                  linkStyle === 'root'
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                {window.location.host}/{slugify(slug) || 'name'}
                <span className="block font-medium text-[9px] opacity-70 mt-0.5">
                  Works everywhere · no setup
                </span>
              </button>
              <button
                type="button"
                onClick={() => setLinkStyle('subdomain')}
                className={`flex-1 px-3 py-2 rounded-xl text-[11px] font-bold border transition-all ${
                  linkStyle === 'subdomain'
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                {slugify(slug) || 'name'}.{window.location.host}
                <span className="block font-medium text-[9px] opacity-70 mt-0.5">
                  Prettier · needs wildcard DNS
                </span>
              </button>
            </div>
            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-2xl p-1.5 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
              <span className="pl-3 text-xs font-mono text-slate-400 font-semibold select-none">https://</span>
              <input
                type="text"
                value={slug}
                onChange={e => setSlug(e.target.value)}
                placeholder="my-tour-name"
                className="flex-1 bg-transparent px-1 py-1 text-xs text-slate-900 font-bold font-mono focus:outline-none"
              />
              <span className="pr-3 text-xs font-mono text-indigo-600 font-bold select-none">
                {linkStyle === 'root' ? `${window.location.host}/…` : `.${window.location.host}`}
              </span>
            </div>
          </div>

          {/* Primary Action Button: Open Online Subdomain */}
          <button
            onClick={handlePublishAndOpen}
            disabled={publishing || !slug.trim()}
            className="w-full py-3.5 px-5 bg-gradient-to-r from-indigo-600 via-indigo-500 to-rose-500 hover:from-indigo-700 hover:to-rose-600 active:scale-98 text-white rounded-2xl text-xs font-extrabold flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25 transition-all disabled:opacity-50"
          >
            {publishing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <ExternalLink size={16} />
            )}
            <span>
              {publishing
                ? 'Publishing Online…'
                : linkStyle === 'root'
                  ? '🌐 Publish & Open Live Tour'
                  : '🌐 Publish & Open (Subdomain)'}
            </span>
          </button>

          {/* Published Status Card */}
          {publication && (
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-emerald-800 font-bold">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-emerald-600" /> Tour Live Online
                </span>
                <span className="text-[10px] text-emerald-600 font-semibold">{publication.sceneCount} Scenes</span>
              </div>
              <div className="flex items-center justify-between bg-white border border-emerald-200/80 rounded-xl p-2 text-xs">
                <span className="font-mono text-emerald-900 font-bold truncate mr-2">{shareUrl}</span>
                <button
                  onClick={() => handleCopyLink(shareUrl)}
                  className="px-2.5 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-lg text-[10px] font-extrabold flex items-center gap-1 shrink-0 transition-colors"
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
              </div>
              {/* Every published tour answers on all three addresses; show the
                  others so a failing wildcard DNS is never a dead end. */}
              <div className="text-[10px] text-emerald-700/80 font-medium leading-relaxed">
                Also live at{' '}
                <a href={linkStyle === 'root' ? subdomainUrl : rootUrl} target="_blank" rel="noreferrer" className="underline font-mono">
                  {linkStyle === 'root' ? subdomainUrl : rootUrl}
                </a>{' '}
                and{' '}
                <a href={pathUrl} target="_blank" rel="noreferrer" className="underline font-mono">
                  {pathUrl}
                </a>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 flex items-center gap-2 text-xs text-rose-700 font-medium">
              <AlertCircle size={14} className="text-rose-500 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Secondary Divider & Offline Option */}
        <div className="relative border-t border-slate-100 pt-4 flex flex-col gap-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            Alternative Offline Package
          </div>
          <button
            onClick={handleDownloadZip}
            disabled={downloading}
            className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            <span>{downloading ? 'Preparing ZIP…' : '📦 Download Offline ZIP Package'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};
