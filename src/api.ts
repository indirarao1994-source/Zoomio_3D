import type { Project, Scene } from './types/tour';

/** Thin typed wrapper over the studio's REST API. */

export interface Publication {
  slug: string;
  projectId: string;
  title: string;
  description: string;
  sceneCount: number;
  coverImage?: string;
  publishedAt: string;
  updatedAt: string;
  sizeBytes: number;
  views: number;
  urls?: {
    subdomain: string;
    /** Bare path form, e.g. https://example.com/my-hotel/ — needs no DNS. */
    root: string;
    path: string;
  };
}

export interface SceneAnalysis {
  id: string;
  name: string;
  shortDescription: string;
  narrationText: string;
  altText: string;
  qualityNotes: string[];
}

export interface LinkSuggestion {
  fromSceneId: string;
  toSceneId: string;
  label: string;
  yaw: number;
  pitch: number;
  reason: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'member';
  createdAt: string;
}

/** Raised on 401 so the app can show the sign-in screen instead of an error. */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('Sign in to continue');
    this.name = 'NotAuthenticatedError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    // Without this the session cookie is not sent and every call 401s.
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (response.status === 401) throw new NotAuthenticatedError();

  if (!response.ok) {
    // Surface the server's own message — the AI routes in particular return
    // actionable text (missing key, refusal reason) worth showing verbatim.
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
      if (body?.hint) message += ` — ${body.hint}`;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  /* ── auth ── */

  authStatus: () =>
    request<{ needsSetup: boolean; signedIn: boolean; user: SessionUser | null }>(
      '/api/auth/status',
    ),

  signup: (email: string, password: string, name?: string) =>
    request<{ user: SessionUser }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),

  login: (email: string, password: string) =>
    request<{ user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ message: string }>('/api/auth/logout', { method: 'POST' }),

  listProjects: () => request<Project[]>('/api/projects'),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),

  createProject: (project: Project) =>
    request<Project>('/api/projects', { method: 'POST', body: JSON.stringify(project) }),

  updateProject: (id: string, patch: Partial<Project>) =>
    request<Project>(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),

  deleteProject: (id: string) =>
    request<{ message: string; unpublished: boolean }>(`/api/projects/${id}`, {
      method: 'DELETE',
    }),

  /**
   * Makes sure the server has this project, creating it if it has only ever
   * existed in the browser's store. The editor keeps projects in memory, so
   * without this any publish or export would ask the server for an id it has
   * never seen and fail with "Project not found".
   */
  async upsertProject(project: Project): Promise<Project> {
    try {
      return await api.updateProject(project.id, project);
    } catch {
      // Not on the server yet (or the update raced a delete) — create it.
      return api.createProject(project);
    }
  },

  async uploadPanorama(file: File): Promise<{ url: string; fileSize: number }> {
    const form = new FormData();
    form.append('image', file);
    const response = await fetch('/api/upload', { method: 'POST', body: form });
    if (!response.ok) throw new Error('Upload failed');
    return response.json();
  },

  /* ── publishing ── */

  listPublications: () => request<Publication[]>('/api/publish'),

  getPublication: (projectId: string) =>
    request<Publication>(`/api/publish/project/${projectId}`).catch(() => null),

  checkSlug: (slug: string, projectId?: string) =>
    request<{ slug: string; available: boolean }>(
      `/api/publish/slug-available/${encodeURIComponent(slug)}` +
        (projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''),
    ),

  publish: (projectId: string, slug?: string) =>
    request<Publication>(`/api/publish/${projectId}`, {
      method: 'POST',
      body: JSON.stringify({ slug }),
    }),

  unpublish: (slug: string) =>
    request<{ message: string }>(`/api/publish/${slug}`, { method: 'DELETE' }),

  /** Streams the ZIP straight to a download without buffering it in state. */
  async downloadTour(project: Project): Promise<void> {
    const response = await fetch(`/api/export/${project.id}`, { method: 'POST' });
    if (!response.ok) {
      let message = 'Could not build the tour package';
      try {
        message = (await response.json()).error ?? message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-tour.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  /* ── AI ── */

  aiStatus: () =>
    request<{ enabled: boolean; provider: 'anthropic' | 'openrouter' | null; model: string | null }>(
      '/api/ai/status',
    ),

  analyzeScenes: (payload: {
    projectContext: { name: string; category: string; description: string; location: string };
    scenes: Array<{ id: string; fileName?: string; imageBase64: string; mediaType: string }>;
  }) =>
    request<{ scenes: SceneAnalysis[]; warning?: string }>('/api/ai/analyze-scenes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  suggestLinks: (payload: {
    category: string;
    scenes: Array<{ id: string; name: string; shortDescription?: string }>;
  }) =>
    request<{ links: LinkSuggestion[]; warning?: string }>('/api/ai/suggest-links', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

/** Scene shape the engine consumes, derived from the studio's richer model. */
export function toEngineScenes(scenes: Scene[]) {
  return scenes.map((s) => ({
    id: s.id,
    name: s.name,
    imageUrl: s.imageUrl,
    hotspots: s.hotspots,
    narrationText: s.narrationText,
    audioNarration: s.audioNarration,
  }));
}
