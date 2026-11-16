import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Real AI-backed tour authoring. This replaces the previous simulated
 * "AI agent" logs, which only ran setTimeout and printed fabricated findings.
 *
 * Two providers are supported:
 * - Anthropic (ANTHROPIC_API_KEY) — the intended path. JSON-schema constrained
 *   output, adaptive thinking, server-side refusal fallback.
 * - OpenRouter (OPENROUTER_API_KEY) — a free-tier fallback for testing the
 *   wiring without spending anything. Weaker vision quality, no schema
 *   enforcement (the model is asked nicely and the reply is parsed leniently),
 *   and free model availability rotates — see OPENROUTER_MODEL below.
 *
 * Anthropic is used whenever its key is present; OpenRouter only kicks in if
 * ANTHROPIC_API_KEY is absent.
 *
 * Cost control for the Anthropic path is deliberate and lives on both sides of
 * the wire: the client downscales each panorama to 1024x512 before upload
 * (~700 image tokens instead of ~4800), and every scene is analysed in a
 * single batched request. A full pass over a 10-scene tour lands around $0.19
 * (roughly Rs.17).
 */

const ANTHROPIC_MODEL = 'claude-opus-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
/**
 * Free vision-capable model as of this writing. OpenRouter's free catalog
 * rotates — if this 404s or disappears, check
 * https://openrouter.ai/models?max_price=0&fmt=cards for a current one and
 * set OPENROUTER_MODEL to override.
 */
const OPENROUTER_DEFAULT_MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free';

let anthropicClient: Anthropic | null = null;
/** Set once a request proves this account/SDK rejects the fallback beta. */
let fallbackUnsupported = false;

type Provider = 'anthropic' | 'openrouter';

function activeProvider(): Provider | null {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  return null;
}

export function aiEnabled(): boolean {
  return activeProvider() !== null;
}

function activeModel(): string | null {
  const provider = activeProvider();
  if (provider === 'anthropic') return ANTHROPIC_MODEL;
  if (provider === 'openrouter') return process.env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL;
  return null;
}

/** Provider-agnostic content so the routes below don't know which is active. */
export type AiBlock = { type: 'text'; text: string } | { type: 'image'; base64: string; mediaType: string };

interface CallOptions {
  system: string;
  content: AiBlock[];
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

class RefusalError extends Error {
  category: string | null;

  constructor(category: string | null) {
    super(
      `The model declined this request${category ? ` (${category})` : ''}. ` +
        'Try different imagery or write the copy manually.',
    );
    this.name = 'RefusalError';
    this.category = category;
  }
}

/* ─────────────────────────── Anthropic backend ─────────────────────────── */

function toAnthropicContent(blocks: AiBlock[]): Anthropic.ContentBlockParam[] {
  return blocks.map((b) =>
    b.type === 'text'
      ? { type: 'text', text: b.text }
      : {
          type: 'image',
          source: { type: 'base64', media_type: b.mediaType as 'image/jpeg', data: b.base64 },
        },
  );
}

/**
 * One request, JSON-schema constrained. Server-side refusal fallback is
 * requested by default; if this account can't use that beta we remember it and
 * retry unguarded rather than failing the user's action.
 */
async function callAnthropic<T>(opts: CallOptions): Promise<T> {
  if (!anthropicClient) anthropicClient = new Anthropic();

  const base = {
    model: ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    thinking: { type: 'adaptive' as const },
    output_config: {
      effort: opts.effort ?? 'medium',
      format: { type: 'json_schema' as const, schema: opts.schema },
    },
    system: opts.system,
    messages: [{ role: 'user' as const, content: toAnthropicContent(opts.content) }],
  };

  let response: Anthropic.Message;
  if (fallbackUnsupported) {
    response = await anthropicClient.messages.create(base);
  } else {
    try {
      response = (await anthropicClient.beta.messages.create({
        ...base,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      } as never)) as unknown as Anthropic.Message;
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError) {
        // Beta not enabled for this org — degrade to a plain request once and
        // stop paying the failed round trip on every subsequent call.
        fallbackUnsupported = true;
        response = await anthropicClient.messages.create(base);
      } else {
        throw err;
      }
    }
  }

  if (response.stop_reason === 'refusal') {
    throw new RefusalError(response.stop_details?.category ?? null);
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  if (!text.trim()) throw new Error('The model returned an empty response');
  return parseJsonLoosely<T>(text);
}

/* ─────────────────────────── OpenRouter backend ─────────────────────────── */

function toOpenRouterContent(blocks: AiBlock[]) {
  return blocks.map((b) =>
    b.type === 'text'
      ? { type: 'text' as const, text: b.text }
      : { type: 'image_url' as const, image_url: { url: `data:${b.mediaType};base64,${b.base64}` } },
  );
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  error?: { message?: string };
}

/**
 * OpenRouter has no equivalent of Anthropic's json_schema output mode for
 * arbitrary (especially free-tier) models, so the schema is spelled out in the
 * system prompt as an instruction and the reply is parsed leniently — free
 * vision models are inconsistent about honouring "JSON only".
 */
async function callOpenRouter<T>(opts: CallOptions): Promise<T> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');
  const model = process.env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL;

  const system =
    `${opts.system}\n\n` +
    'Respond with ONLY a single JSON object holding your answer, shaped like this ' +
    'schema:\n' +
    JSON.stringify(opts.schema) +
    '\n\nImportant: that block describes the SHAPE of the answer, it is not the ' +
    'answer. Your reply must contain only actual data values — real names, ' +
    'descriptions, numbers. Never include the words "schema", "type", ' +
    '"properties", "required", or "additionalProperties" anywhere in your reply, ' +
    'and never repeat any part of the schema definition itself. No markdown code ' +
    'fences, no commentary before or after the JSON.';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // Recommended by OpenRouter for attribution; harmless if inaccurate.
        'HTTP-Referer': process.env.APP_URL || 'http://localhost',
        'X-Title': 'Virtual Tour Studio',
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 4000,
        temperature: 0.4,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: toOpenRouterContent(opts.content) },
        ],
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`OpenRouter model "${model}" timed out — free models can be slow or overloaded. Try again.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  const body = (await response.json().catch(() => null)) as OpenRouterResponse | null;

  if (!response.ok) {
    const message = body?.error?.message || `OpenRouter request failed (${response.status})`;
    throw new Error(
      `${message}. If "${model}" no longer exists, check ` +
        'https://openrouter.ai/models?max_price=0&fmt=cards for a current free ' +
        'vision model and set OPENROUTER_MODEL in your .env.',
    );
  }

  const text = body?.choices?.[0]?.message?.content;
  if (!text?.trim()) throw new Error('OpenRouter returned an empty response');
  return parseJsonLoosely<T>(text);
}

/** Strips markdown fences and grabs the outermost {...} — free models rarely reply with bare JSON. */
function parseJsonLoosely<T>(text: string): T {
  let cleaned = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(cleaned);
  if (fenced) cleaned = fenced[1];

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error('The model returned text that was not valid JSON. Try again, or switch to a stronger model.');
  }
}

async function callModel<T>(opts: CallOptions): Promise<T> {
  const provider = activeProvider();
  if (provider === 'anthropic') return callAnthropic<T>(opts);
  if (provider === 'openrouter') return callOpenRouter<T>(opts);
  throw new Error('AI is not configured');
}

/* ─────────────────────────── schemas ─────────────────────────── */

const sceneAnalysisSchema = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Echo the scene id exactly as given' },
          name: { type: 'string', description: 'Short human title, 2-4 words, Title Case' },
          shortDescription: { type: 'string', description: 'One sentence, max 20 words' },
          narrationText: {
            type: 'string',
            description: 'Spoken tour-guide script, 40-70 words, warm and factual',
          },
          altText: {
            type: 'string',
            description: 'WCAG 2.2 alt text describing the space for a screen reader',
          },
          qualityNotes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Concrete visual issues (blur, blown highlights, stitching seams). Empty if none.',
          },
        },
        required: ['id', 'name', 'shortDescription', 'narrationText', 'altText', 'qualityNotes'],
        additionalProperties: false,
      },
    },
  },
  required: ['scenes'],
  additionalProperties: false,
};

const linkSuggestionSchema = {
  type: 'object',
  properties: {
    links: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fromSceneId: { type: 'string' },
          toSceneId: { type: 'string' },
          label: { type: 'string', description: 'Button text, e.g. "To the Conference Room"' },
          yaw: { type: 'number', description: 'Degrees -180..180 where the doorway appears' },
          pitch: { type: 'number', description: 'Degrees -90..90, usually between -25 and 5' },
          reason: { type: 'string', description: 'Why these two spaces connect' },
        },
        required: ['fromSceneId', 'toSceneId', 'label', 'yaw', 'pitch', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['links'],
  additionalProperties: false,
};

/* ─────────────────────────── result sanitizing ─────────────────────────── */

/**
 * Anthropic's JSON-schema output mode guarantees shape, so this is only load-
 * bearing on the OpenRouter path — but it runs for both, since a cheap safety
 * net costs nothing. Weaker free-tier models can return valid JSON that is
 * still the wrong shape: observed in testing, a 12B model echoed fragments of
 * the schema itself (keys like "required" and "additionalProperties") as if
 * they were data, mixed in alongside genuinely correct entries. Rather than
 * let that reach the studio UI, drop anything that doesn't actually match.
 */
function isSceneAnalysis(v: unknown): v is SceneAnalysis {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.shortDescription === 'string' &&
    typeof o.narrationText === 'string' &&
    typeof o.altText === 'string' &&
    Array.isArray(o.qualityNotes) &&
    o.qualityNotes.every((n) => typeof n === 'string')
  );
}

function isLinkSuggestion(v: unknown): v is LinkSuggestion {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.fromSceneId === 'string' &&
    typeof o.toSceneId === 'string' &&
    typeof o.label === 'string' &&
    typeof o.yaw === 'number' &&
    typeof o.pitch === 'number' &&
    typeof o.reason === 'string'
  );
}

interface SceneAnalysis {
  id: string;
  name: string;
  shortDescription: string;
  narrationText: string;
  altText: string;
  qualityNotes: string[];
}

interface LinkSuggestion {
  fromSceneId: string;
  toSceneId: string;
  label: string;
  yaw: number;
  pitch: number;
  reason: string;
}

/** Filters a possibly-malformed array and reports how many entries were dropped. */
function sanitize<T>(items: unknown[], guard: (v: unknown) => v is T): { kept: T[]; dropped: number } {
  const kept = items.filter(guard);
  return { kept, dropped: items.length - kept.length };
}

/* ─────────────────────────── routes ─────────────────────────── */

export const aiRouter = Router();

aiRouter.get('/status', (_req, res) => {
  res.json({ enabled: aiEnabled(), provider: activeProvider(), model: activeModel() });
});

interface AnalyzeBody {
  projectContext?: { name?: string; category?: string; description?: string; location?: string };
  scenes?: Array<{ id: string; fileName?: string; imageBase64?: string; mediaType?: string }>;
}

aiRouter.post('/analyze-scenes', async (req, res) => {
  if (!aiEnabled()) {
    return res.status(503).json({
      error: 'AI is not configured',
      hint: 'Add ANTHROPIC_API_KEY (recommended) or OPENROUTER_API_KEY to your .env file and restart the server.',
    });
  }

  const { projectContext = {}, scenes = [] } = req.body as AnalyzeBody;
  if (scenes.length === 0) return res.status(400).json({ error: 'No scenes supplied' });
  if (scenes.length > 40) {
    return res.status(400).json({ error: 'Analyse at most 40 scenes per request' });
  }

  const usable = scenes.filter((s) => s.imageBase64);
  if (usable.length === 0) return res.status(400).json({ error: 'No scene images supplied' });

  const analyzeSystem =
    'You write copy for professional 360-degree virtual tours. You are shown ' +
    'equirectangular panoramas, which look distorted at the top and bottom — read ' +
    'them as full spherical views of a room rather than flat photographs.\n\n' +
    'For each panorama: name the space, describe it, write a narration script a ' +
    'human guide would read aloud, and write screen-reader alt text.\n\n' +
    'Describe only what is actually visible. Do not invent amenities, brand names, ' +
    'dimensions, or history. If a space is ambiguous, name it generically. ' +
    'In qualityNotes report only genuine visible defects; return an empty array ' +
    'when the image looks fine rather than padding it.';

  /** Builds and runs one request covering a subset of the scenes. */
  const analyzeChunk = async (batch: typeof usable) => {
    const content: AiBlock[] = [
      {
        type: 'text',
        text:
          `Project: ${projectContext.name || 'Untitled tour'}\n` +
          `Venue type: ${projectContext.category || 'unspecified'}\n` +
          `Location: ${projectContext.location || 'unspecified'}\n` +
          `Brief: ${projectContext.description || 'none provided'}\n\n` +
          `There ${batch.length === 1 ? 'is 1 panorama' : `are ${batch.length} panoramas`} below, ` +
          `each preceded by its scene id. Return one entry per scene, echoing the id exactly.`,
      },
    ];
    for (const scene of batch) {
      content.push({ type: 'text', text: `Scene id: ${scene.id}` });
      content.push({
        type: 'image',
        base64: scene.imageBase64!,
        mediaType: scene.mediaType || 'image/jpeg',
      });
    }
    return callModel<{ scenes: unknown[] }>({
      system: analyzeSystem,
      content,
      schema: sceneAnalysisSchema,
      effort: 'medium',
    });
  };

  /**
   * Claude handles every panorama in one request, which is the whole point of
   * batching — the system prompt is paid for once. Free OpenRouter models
   * cannot: a 12B model given ten images at once returns an empty completion
   * (observed in testing, after ~150s). Since those calls are free, the
   * batching saving is worth nothing there, so scenes go a few at a time and
   * a chunk that fails doesn't take the whole run down with it.
   */
  const chunkSize = activeProvider() === 'openrouter' ? 2 : usable.length;

  try {
    const collected: unknown[] = [];
    const failures: string[] = [];

    for (let i = 0; i < usable.length; i += chunkSize) {
      const batch = usable.slice(i, i + chunkSize);
      try {
        const partial = await analyzeChunk(batch);
        collected.push(...(partial.scenes ?? []));
      } catch (err) {
        // One bad chunk shouldn't discard the scenes that did work.
        if (chunkSize >= usable.length) throw err;
        failures.push(err instanceof Error ? err.message : 'chunk failed');
      }
    }

    const { kept, dropped } = sanitize(collected, isSceneAnalysis);
    if (kept.length === 0 && failures.length > 0) {
      return res.status(502).json({ error: failures[0] });
    }
    if (kept.length === 0) {
      return res.status(502).json({
        error: 'The model\'s reply did not contain any usable scene descriptions. Try again.',
      });
    }
    // Report both kinds of shortfall, so a partial run is never presented as
    // a complete one.
    const notes: string[] = [];
    if (dropped > 0) {
      notes.push(`discarded ${dropped} malformed entr${dropped === 1 ? 'y' : 'ies'}`);
    }
    if (failures.length > 0) {
      notes.push(`${failures.length} batch${failures.length === 1 ? '' : 'es'} failed`);
    }
    const missing = usable.length - kept.length;
    if (missing > 0) notes.push(`${missing} of ${usable.length} scenes not described`);

    res.json({
      scenes: kept,
      ...(notes.length > 0 ? { warning: `${notes.join('; ')}.` } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI request failed';
    const status = err instanceof RefusalError ? 422 : 502;
    res.status(status).json({ error: message });
  }
});

interface LinksBody {
  category?: string;
  scenes?: Array<{ id: string; name: string; shortDescription?: string; narrationText?: string }>;
}

aiRouter.post('/suggest-links', async (req, res) => {
  if (!aiEnabled()) {
    return res.status(503).json({ error: 'AI is not configured' });
  }

  const { scenes = [], category } = req.body as LinksBody;
  if (scenes.length < 2) {
    return res.status(400).json({ error: 'Need at least two scenes to suggest links' });
  }

  const summary = scenes
    .map(
      (s, i) =>
        `${i + 1}. id=${s.id} | name=${s.name}` +
        (s.shortDescription ? ` | ${s.shortDescription}` : ''),
    )
    .join('\n');

  try {
    const result = await callModel<{ links: unknown[] }>({
      system:
        'You design navigation graphs for 360-degree virtual tours. Given a list of ' +
        'spaces in a venue, propose which ones a visitor should be able to walk ' +
        'between, and roughly where on the panorama the doorway would sit.\n\n' +
        'Rules: propose links only between spaces that plausibly adjoin. Every scene ' +
        'must be reachable from the first scene. Prefer a realistic floor plan over a ' +
        'chain — lobbies and corridors are hubs. Suggest both directions for a ' +
        'connection as two separate entries. Keep pitch between -25 and 5 degrees, ' +
        'since doorways sit near eye level or slightly below.',
      content: [
        { type: 'text', text: `Venue type: ${category || 'unspecified'}\n\nSpaces:\n${summary}` },
      ],
      schema: linkSuggestionSchema,
      effort: 'medium',
      maxTokens: 8000,
    });

    const { kept, dropped } = sanitize(result.links ?? [], isLinkSuggestion);
    res.json({ links: kept, ...(dropped > 0 ? { warning: `Discarded ${dropped} malformed entr${dropped === 1 ? 'y' : 'ies'} from the response.` } : {}) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI request failed';
    const status = err instanceof RefusalError ? 422 : 502;
    res.status(status).json({ error: message });
  }
});
