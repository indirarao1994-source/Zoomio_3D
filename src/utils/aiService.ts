/**
 * AI Service — supports Google Gemini API and OpenRouter API
 * Keys are stored in localStorage for session persistence.
 */

export type AIProvider = 'gemini' | 'openrouter';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model?: string;
}

/* ── Key management ─────────────────────────────────────────── */
export function saveAIConfig(cfg: AIConfig) {
  localStorage.setItem('ai_config', JSON.stringify(cfg));
}

export function loadAIConfig(): AIConfig | null {
  try {
    const raw = localStorage.getItem('ai_config');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearAIConfig() {
  localStorage.removeItem('ai_config');
}

/* ── Core request ──────────────────────────────────────────── */
async function callGemini(apiKey: string, prompt: string, imageBase64?: string, customModel?: string): Promise<string> {
  const model = customModel?.trim() || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const parts: any[] = [{ text: prompt }];
  if (imageBase64) {
    const mimeType = imageBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    const b64 = imageBase64.split(',')[1] || imageBase64;
    parts.unshift({ inlineData: { mimeType, data: b64 } });
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // If a non-standard model failed, attempt automatic fallback to gemini-1.5-flash
    if (model !== 'gemini-1.5-flash') {
      return callGemini(apiKey, prompt, imageBase64, 'gemini-1.5-flash');
    }
    throw new Error(err?.error?.message || `Gemini error ${res.status}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callOpenRouter(apiKey: string, model: string, prompt: string, imageBase64?: string): Promise<string> {
  const messages: any[] = [];
  if (imageBase64) {
    const mimeType = imageBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    messages.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageBase64.startsWith('data:') ? imageBase64 : `data:${mimeType};base64,${imageBase64}` } },
        { type: 'text', text: prompt },
      ],
    });
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.href,
      'X-Title': 'Zoomio',
    },
    body: JSON.stringify({
      model: model || 'anthropic/claude-3.5-sonnet',
      messages,
      max_tokens: 1500,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenRouter error ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callAI(prompt: string, imageBase64?: string): Promise<string> {
  const cfg = loadAIConfig();
  if (!cfg?.apiKey) throw new Error('No AI API key configured. Please set your API key in Settings.');

  if (cfg.provider === 'gemini') {
    return callGemini(cfg.apiKey, prompt, imageBase64, cfg.model);
  } else {
    return callOpenRouter(cfg.apiKey, cfg.model || 'anthropic/claude-3.5-sonnet', prompt, imageBase64);
  }
}

/* ── Feature functions ─────────────────────────────────────── */

/**
 * Analyze a 360° panorama image and return scene name + description.
 */
export async function analyzeScene(imageBase64: string): Promise<{ name: string; description: string; altText: string }> {
  const prompt = `You are analyzing a 360-degree panoramic photo for a virtual tour.
Please identify what room/space this is and respond ONLY with valid JSON in this exact format:
{
  "name": "Short room name (2-4 words)",
  "description": "One sentence describing the space for visitors (max 100 chars)",
  "altText": "Accessibility description of the panorama (max 80 chars)"
}`;

  const raw = await callAI(prompt, imageBase64);
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(match?.[0] || '{}');
  } catch {
    return { name: 'New Room', description: 'A beautiful panoramic space.', altText: 'Panoramic room view.' };
  }
}

/**
 * Suggest hotspot connections between scenes.
 */
export async function suggestHotspots(scenes: Array<{ id: string; name: string; description?: string }>) {
  const prompt = `You are designing a virtual tour. Given these rooms, suggest logical hotspot connections between them.
Rooms: ${scenes.map((s, i) => `${i + 1}. "${s.name}" (id: ${s.id})`).join(', ')}.
Respond ONLY with valid JSON array, max 8 connections:
[{"fromSceneId": "id1", "toSceneId": "id2", "label": "Go to Room Name", "yaw": 45, "pitch": -10, "reason": "Natural connection"}]
Use realistic yaw angles (-180 to 180) and pitch around -15 to -5 degrees for floor-level arrows.`;

  const raw = await callAI(prompt);
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    return JSON.parse(match?.[0] || '[]');
  } catch { return []; }
}

/**
 * Generate narration text for a scene.
 */
export async function generateNarration(sceneName: string, description: string, tourContext: string): Promise<string> {
  const prompt = `You are an expert virtual tour guide. Write a short, engaging narration for a "${sceneName}" in a virtual tour of "${tourContext}".
${description ? `Context: ${description}` : ''}
The narration should be 2-3 sentences, conversational and welcoming. Return only the narration text, no quotes or JSON.`;

  return callAI(prompt);
}

/**
 * Generate descriptive alt text for a panoramic image.
 */
export async function generateAltText(imageBase64: string, sceneName: string): Promise<string> {
  const prompt = `Describe this 360° panoramic photo of "${sceneName}" in one clear sentence for screen readers (max 100 chars). Return only the description text.`;
  return callAI(prompt, imageBase64);
}

/**
 * AI Chat — answer questions about virtual tour creation.
 */
export async function askAI(question: string, tourContext: string): Promise<string> {
  const prompt = `You are a helpful assistant for Zoomio, a 360° virtual tour creation tool.
Tour context: "${tourContext}"

User question: "${question}"

Give a concise, helpful answer (max 3 sentences) about virtual tour creation, hotspots, lighting, or navigation.`;

  return callAI(prompt);
}

/**
 * Generate a tour welcome message.
 */
export async function generateWelcomeMessage(tourName: string, category: string, location: string): Promise<string> {
  const prompt = `Write a short, professional welcome message for a virtual tour named "${tourName}" (${category}) in ${location || 'an unknown location'}.
2 sentences max. Engaging and inviting. Return only the text.`;
  return callAI(prompt);
}
