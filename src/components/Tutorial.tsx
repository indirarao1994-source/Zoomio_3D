import React, { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, Play, MousePointer2, Navigation, Info, Image, Sun, Type, Film, Settings, Lightbulb, ExternalLink } from 'lucide-react';

interface TutorialStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  tip?: string;
  highlight?: string; // element selector to highlight
  action?: string;    // what the user should do
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Zoomio! 👋',
    description: 'This is your virtual tour studio. You can create professional 360° virtual tours just like Panoee, Matterport, or Kuula — right in your browser.',
    icon: <span className="text-4xl">🌐</span>,
    action: 'Click Next to start the tour of your editor',
  },
  {
    id: 'scenes',
    title: 'Left Panel — Scene List',
    description: 'All your rooms appear as thumbnail cards on the left. Click any thumbnail to switch to that room. Hover over a card to get upload and delete options.',
    icon: <span className="text-4xl">🗂️</span>,
    tip: 'Click the + Add Scene button at the bottom to add a new room',
    action: 'Try clicking on a different room thumbnail',
    highlight: 'scenes-panel',
  },
  {
    id: 'viewer',
    title: 'Center — 360° Panorama Viewer',
    description: 'The large center area shows your current panorama. Click and drag to look around. Use the scroll wheel to zoom in/out. This is where all your hotspots will appear!',
    icon: <span className="text-4xl">🔭</span>,
    tip: 'Hold and drag → to look around. Scroll → to zoom.',
    action: 'Try dragging inside the panorama now',
  },
  {
    id: 'toolbar',
    title: 'Right Toolbar — Tools',
    description: 'The vertical icon strip on the right is your toolbox. Select a tool, then click in the panorama to place hotspots or labels. The active tool is highlighted in cyan.',
    icon: <span className="text-4xl">🛠️</span>,
    action: 'Click different tool icons to see their descriptions',
    highlight: 'tool-strip',
  },
  {
    id: 'hotspot-nav',
    title: '🚪 Navigation Hotspot',
    description: 'Select the Navigation tool (🚪 door icon), then CLICK anywhere in the panorama to place a navigation arrow. Choose the destination room in the Properties panel. Viewers click this to walk to the next room.',
    icon: <Navigation size={40} className="text-cyan-400" />,
    tip: 'Place navigation hotspots at doorways or room transitions for the most realistic experience',
    action: 'Select the Navigation tool and click in the panorama to place one',
  },
  {
    id: 'hotspot-info',
    title: 'ℹ️ Info Popup Hotspot',
    description: 'Select the Info tool, then click to place an information marker. Type your info text in the Properties panel. Viewers click the marker to read the popup.',
    icon: <Info size={40} className="text-yellow-400" />,
    tip: 'Great for room descriptions, product details, or interesting facts',
    action: 'Place an info hotspot on an interesting feature in your panorama',
  },
  {
    id: 'hotspot-media',
    title: '🖼️ Media Hotspots (Image/Video/Audio)',
    description: 'Use Image, Video, or Audio tools to embed rich media. Paste a URL in the Properties panel. Viewers click to open a popup player or gallery.',
    icon: <Image size={40} className="text-purple-400" />,
    tip: 'Use YouTube/Vimeo links for video, direct MP3 URLs for audio',
    action: 'Try placing a video hotspot and pasting a YouTube URL',
  },
  {
    id: 'text-label',
    title: '🏷️ Text Labels',
    description: 'Select the Text Label tool, then click anywhere to place floating text in the 3D space. Perfect for room names, wayfinding signs, or annotations. Customize font, color, and size in the panel.',
    icon: <Type size={40} className="text-orange-400" />,
    tip: 'Text labels float in the panorama at the exact spot you click',
    action: 'Click the Label tool and place a room name above a doorway',
  },
  {
    id: 'lighting',
    title: '💡 Lighting Controls',
    description: 'Select the Lighting tool to open sliders for Brightness, Contrast, Saturation, Hue, and Exposure. These adjust how the panorama looks without changing the source image.',
    icon: <Sun size={40} className="text-amber-400" />,
    tip: 'If your panorama looks too dark or washed out, adjust Brightness and Contrast first',
    action: 'Try adjusting the Brightness slider',
  },
  {
    id: 'transition',
    title: '🎬 Scene Transitions',
    description: 'Select the Transition tool to set the animation when entering this scene — Fade, Zoom, Rotate, or Blur. Set the speed and easing per scene.',
    icon: <Film size={40} className="text-indigo-400" />,
    tip: 'Use "Fade" for professional results, "Zoom" for dramatic effect',
  },
  {
    id: 'settings',
    title: '⚙️ Scene Settings',
    description: 'The Settings tool lets you rename scenes, set a description, mark the entrance, enable auto-rotation, and set the initial camera direction when viewers first enter.',
    icon: <Settings size={40} className="text-slate-400" />,
    tip: 'Always set the Initial View to face the most interesting part of the room',
    action: 'Click "Capture Current View" after positioning the camera how you want',
  },
  {
    id: 'auto-rotate',
    title: '⟳ Auto-Rotate & Follow Mode',
    description: 'The header bar has Auto-Rotate (panorama spins automatically) and Follow Mode (camera follows your mouse — great for demos). Use the speed slider to control rotation speed.',
    icon: <span className="text-4xl">🌀</span>,
    tip: 'Auto-rotate is great for trade show displays or lobby kiosks',
    action: 'Toggle Auto-Rotate ON and watch the panorama spin',
  },
  {
    id: 'ai',
    title: '🤖 AI Features',
    description: 'Click the AI button (✨) to use AI-powered features: auto-analyze your panorama images for scene names, suggest hotspot connections between rooms, generate narration text, and get help from the AI assistant.',
    icon: <span className="text-4xl">✨</span>,
    tip: 'Add your Gemini or OpenRouter API key in AI Settings to unlock these features',
    action: 'Click the ✨ AI button in the header to open the AI panel',
  },
  {
    id: 'export',
    title: '📦 Export Your Tour',
    description: 'Click "Export ZIP" in the header to download your entire virtual tour as a standalone ZIP file. Double-click index.html to view it offline — no server needed! All images are embedded.',
    icon: <span className="text-4xl">📦</span>,
    tip: 'The ZIP works offline, on any computer, with no internet required',
    action: 'Click Export ZIP to download your tour',
  },
  {
    id: 'done',
    title: "You're ready! 🎉",
    description: 'You now know all the tools. Start by uploading your own 360° panorama images, place hotspots between rooms, and export your tour. If you ever need help, click the ? button.',
    icon: <span className="text-4xl">🎉</span>,
    tip: 'Use the hotkey shortcuts below for faster workflows',
    action: 'Close this tutorial and start creating!',
  },
];

const SHORTCUTS = [
  { key: 'Click + Drag', action: 'Look around panorama' },
  { key: 'Scroll wheel', action: 'Zoom in/out' },
  { key: 'Double-click (edit mode)', action: 'Quick-place hotspot' },
  { key: 'Ctrl+Z', action: 'Undo' },
  { key: 'Ctrl+Y', action: 'Redo' },
  { key: 'F', action: 'Fullscreen' },
  { key: 'Esc', action: 'Close panels' },
];

/* ── Tutorial storage ─────────────────────────────────────── */
const SEEN_KEY = 'tutorial_seen_v2';
export function markTutorialSeen() { localStorage.setItem(SEEN_KEY, '1'); }
export function isTutorialSeen()   { return !!localStorage.getItem(SEEN_KEY); }
export function resetTutorial()    { localStorage.removeItem(SEEN_KEY); }

/* ── Main tutorial component ──────────────────────────────── */
interface TutorialProps {
  onClose: () => void;
  startStep?: number;
}

export const Tutorial: React.FC<TutorialProps> = ({ onClose, startStep = 0 }) => {
  const [step, setStep] = useState(startStep);
  const current = TUTORIAL_STEPS[step];

  const next = () => {
    if (step < TUTORIAL_STEPS.length - 1) setStep(s => s + 1);
    else { markTutorialSeen(); onClose(); }
  };
  const prev = () => { if (step > 0) setStep(s => s - 1); };
  const skip = () => { markTutorialSeen(); onClose(); }

  const isLast = step === TUTORIAL_STEPS.length - 1;
  const progress = ((step + 1) / TUTORIAL_STEPS.length) * 100;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-[520px] max-h-[90vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: '#161b22', border: '1px solid rgba(0,212,255,0.2)' }}>

        {/* Progress bar */}
        <div className="h-0.5 bg-slate-800">
          <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500"
            style={{ width: `${progress}%` }} />
        </div>

        {/* Close button */}
        <button onClick={skip}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
          <X size={14} />
        </button>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          {/* Icon */}
          <div className="flex justify-center mb-5">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)' }}>
              {current.icon}
            </div>
          </div>

          {/* Step indicator */}
          <div className="text-center mb-2">
            <span className="text-[10px] font-bold tracking-[3px] text-slate-500 uppercase">
              STEP {step + 1} OF {TUTORIAL_STEPS.length}
            </span>
          </div>

          {/* Title */}
          <h2 className="text-xl font-bold text-white text-center mb-3 leading-snug">{current.title}</h2>

          {/* Description */}
          <p className="text-sm text-slate-300 text-center leading-relaxed mb-4">{current.description}</p>

          {/* Tip */}
          {current.tip && (
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl mb-4"
              style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)' }}>
              <Lightbulb size={14} className="text-yellow-400 shrink-0 mt-0.5" />
              <span className="text-xs text-yellow-200/80 leading-relaxed">{current.tip}</span>
            </div>
          )}

          {/* Action prompt */}
          {current.action && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl mb-4"
              style={{ background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.15)' }}>
              <Play size={12} className="text-cyan-400 shrink-0" />
              <span className="text-xs text-cyan-300/80 font-medium">{current.action}</span>
            </div>
          )}

          {/* Shortcuts (last step only) */}
          {isLast && (
            <div className="mt-2">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-2">Keyboard Shortcuts</div>
              <div className="space-y-1.5">
                {SHORTCUTS.map(s => (
                  <div key={s.key} className="flex items-center justify-between text-xs">
                    <code className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[10px]">{s.key}</code>
                    <span className="text-slate-400">{s.action}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Step dots */}
        <div className="flex justify-center gap-1.5 pb-4">
          {TUTORIAL_STEPS.map((_, i) => (
            <button key={i} onClick={() => setStep(i)}
              className="w-1.5 h-1.5 rounded-full transition-all duration-200"
              style={{ background: i === step ? '#00d4ff' : i < step ? 'rgba(0,212,255,0.4)' : 'rgba(255,255,255,0.1)' }} />
          ))}
        </div>

        {/* Navigation buttons */}
        <div className="px-8 pb-6 flex items-center gap-3">
          <button onClick={skip}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-3 py-2">
            Skip Tutorial
          </button>
          <div className="flex-1 flex gap-2 justify-end">
            {step > 0 && (
              <button onClick={prev}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors">
                <ChevronLeft size={14} /> Back
              </button>
            )}
            <button onClick={next}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold text-black transition-all"
              style={{ background: 'linear-gradient(135deg, #00d4ff, #0099cc)' }}>
              {isLast ? '🎉 Start Creating!' : <>Next <ChevronRight size={14} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Tooltip hint for individual tools ─────────────────────── */
interface ToolTooltipProps {
  toolId: string;
  visible: boolean;
}

const TOOL_TIPS: Record<string, { title: string; desc: string; shortcut?: string }> = {
  select:     { title: 'Select & Edit', desc: 'Click hotspots or labels to select and edit them', shortcut: 'V' },
  navigation: { title: 'Navigation Hotspot', desc: 'Click panorama to place a doorway to another room', shortcut: 'N' },
  info:       { title: 'Info Popup', desc: 'Click to add an information marker with popup text', shortcut: 'I' },
  image:      { title: 'Image Gallery', desc: 'Click to embed an image or photo gallery', shortcut: 'G' },
  video:      { title: 'Video Player', desc: 'Click to embed a YouTube, Vimeo, or direct video', shortcut: 'V' },
  audio:      { title: 'Audio Hotspot', desc: 'Click to add a sound clip or narration trigger', shortcut: 'A' },
  link:       { title: 'URL / Link', desc: 'Click to add an external website link', shortcut: 'L' },
  label:      { title: 'Text Label', desc: 'Click to place a floating text label in 3D space', shortcut: 'T' },
  lighting:   { title: 'Lighting', desc: 'Adjust brightness, contrast, saturation & hue', shortcut: 'B' },
  transition: { title: 'Scene Transition', desc: 'Set the entry animation for this scene', shortcut: 'F' },
  settings:   { title: 'Scene Settings', desc: 'Name, description, entrance, auto-rotate & initial view', shortcut: 'S' },
};

export function useToolTooltip(toolId: string) {
  return TOOL_TIPS[toolId] || null;
}

/* ── "How to" quick reference card ─────────────────────────── */
interface QuickHelpProps { onClose: () => void; }

export const QuickHelp: React.FC<QuickHelpProps> = ({ onClose }) => {
  const guides = [
    {
      icon: '🚪', title: 'Add Navigation Between Rooms',
      steps: ['Select Navigation tool (🚪)', 'Click near a doorway in the panorama', 'Choose destination room in Properties panel', 'Repeat for each room connection'],
    },
    {
      icon: '🏷️', title: 'Add Location Labels',
      steps: ['Select Text Label tool (🏷️)', 'Click where you want the label', 'Type the room name in Properties', 'Adjust color, size, and opacity'],
    },
    {
      icon: '💡', title: 'Fix Dark or Washed-Out Panoramas',
      steps: ['Select Lighting tool (💡)', 'Raise Brightness if image is too dark', 'Adjust Contrast for more depth', 'Increase Saturation for vivid colors'],
    },
    {
      icon: '⚙️', title: 'Set Starting View',
      steps: ['Select Settings tool (⚙️)', 'Drag the panorama to your preferred angle', 'Click "Capture Current View"', 'Save — viewers will start at this angle'],
    },
    {
      icon: '📦', title: 'Export Offline Tour',
      steps: ['Click "Export ZIP" in the header', 'Wait for the ZIP to download', 'Extract the ZIP folder', 'Open index.html in any browser'],
    },
  ];

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-end p-4">
      <div className="w-[380px] max-h-[80vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: '#161b22', border: '1px solid rgba(0,212,255,0.2)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="text-sm font-bold text-white">📖 Quick Reference Guide</h3>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-white transition-colors"><X size={14} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {guides.map(g => (
            <div key={g.title} className="rounded-xl p-3.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{g.icon}</span>
                <span className="text-xs font-bold text-white">{g.title}</span>
              </div>
              <ol className="space-y-1">
                {g.steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-slate-400">
                    <span className="w-4 h-4 rounded-full bg-cyan-500/20 text-cyan-400 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i+1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          ))}

          {/* Similar platforms */}
          <div className="rounded-xl p-3.5" style={{ background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.12)' }}>
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-2">🌐 Similar Platforms</div>
            {[
              { name: 'Panoee',      url: 'https://panoee.net',       note: 'Generous free tier, 32K support' },
              { name: 'Kuula',       url: 'https://kuula.co',         note: 'Social virtual tours' },
              { name: 'CloudPano',   url: 'https://cloudpano.com',    note: 'Real estate focused' },
              { name: 'Matterport',  url: 'https://matterport.com',   note: '3D + AI powered (premium)' },
              { name: '3DVista',     url: 'https://3dvista.com',      note: 'Offline, one-time purchase' },
              { name: 'Roundme',     url: 'https://roundme.com',      note: 'Community tours' },
            ].map(p => (
              <a key={p.name} href={p.url} target="_blank" rel="noreferrer"
                className="flex items-center justify-between py-1.5 text-xs hover:text-cyan-400 transition-colors">
                <span className="text-slate-300 font-medium">{p.name}</span>
                <div className="flex items-center gap-1">
                  <span className="text-slate-500 text-[9px]">{p.note}</span>
                  <ExternalLink size={10} className="text-slate-600" />
                </div>
              </a>
            ))}
          </div>

          {/* Innovative feature ideas */}
          <div className="rounded-xl p-3.5" style={{ background: 'rgba(168,85,247,0.04)', border: '1px solid rgba(168,85,247,0.15)' }}>
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-2">✨ Innovative Features (Coming Soon)</div>
            {[
              '🤖 AI Auto-Connect — automatically links all rooms with nav hotspots',
              '🗣️ Voice Guide — AI narrates each room as viewer enters',
              '📊 Heatmap Analytics — see where visitors look most',
              '🎭 Virtual Staging — AI replaces room furniture in-browser',
              '🌤️ Time of Day — simulate day/night lighting changes',
              '📱 QR Code Export — generate shareable QR for any room',
              '🌍 Multi-Language — AI translates hotspot text automatically',
              '🔵 AR Mode — view tour overlaid on real world (WebXR)',
            ].map(f => (
              <div key={f} className="text-[11px] text-slate-400 py-1 border-b border-slate-800/50 last:border-0">{f}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
