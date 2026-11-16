import React, { useState } from 'react';
import { Loader2, AlertCircle, Globe } from 'lucide-react';
import { api, type SessionUser } from '../api';

interface AuthScreenProps {
  /** True when no account exists yet — the very first run of an instance. */
  needsSetup: boolean;
  onSignedIn: (user: SessionUser) => void;
}

/**
 * Sign-in / first-run setup.
 *
 * Only the first account can self-register: that is the operator claiming their
 * own instance. After that, open signup would let anyone on the internet create
 * an account on someone else's studio, so further users are added by the owner.
 */
export const AuthScreen: React.FC<AuthScreenProps> = ({ needsSetup, onSignedIn }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = needsSetup
        ? await api.signup(email, password, name)
        : await api.login(email, password);
      onSignedIn(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-[#f8fafc] p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 shadow-xl"
      >
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Globe size={24} />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
            {needsSetup ? 'Set up Zoomio' : 'Sign in to Zoomio'}
          </h1>
          <p className="mt-1 text-xs font-medium text-slate-500">
            {needsSetup
              ? 'Create the owner account for this studio'
              : 'Manage and publish your 360° virtual tours'}
          </p>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        {needsSetup && (
          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] font-black uppercase tracking-wider text-slate-400">
              Your name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:bg-white"
            />
          </label>
        )}

        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] font-black uppercase tracking-wider text-slate-400">
            Email
          </span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:bg-white"
          />
        </label>

        <label className="mb-5 block">
          <span className="mb-1 block text-[11px] font-black uppercase tracking-wider text-slate-400">
            Password
          </span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={needsSetup ? 'new-password' : 'current-password'}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:bg-white"
          />
          {needsSetup && (
            <span className="mt-1 block text-[10px] text-slate-400">
              At least 8 characters. There is no password reset email yet — keep it safe.
            </span>
          )}
        </label>

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-rose-500 px-5 py-3 text-xs font-extrabold text-white shadow-lg shadow-indigo-500/25 transition-all hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {needsSetup ? 'Create owner account' : 'Sign in'}
        </button>

        {!needsSetup && (
          <p className="mt-4 text-center text-[10px] leading-relaxed text-slate-400">
            Accounts are created by the studio owner. Ask them for an invitation.
          </p>
        )}
      </form>
    </div>
  );
};
