import React, { useState } from 'react';
import { useTourStore } from '../store/useTourStore';
import type { Project, Scene } from '../types/tour';
import { analyzeImageMetadata, runQualityInspection } from '../utils/imageProcessor';
import { generateOfflineTourZip } from '../utils/exportGenerator';
import { ThreeViewer } from './ThreeViewer';
import { AIAgentLogs } from './AIAgentLogs';
import { Upload, ChevronRight, ChevronLeft, CheckCircle2, Info } from 'lucide-react';
import confetti from 'canvas-confetti';

interface WizardProps {
  onCancel: () => void;
  onComplete: () => void;
}

export const Wizard: React.FC<WizardProps> = ({ onCancel, onComplete }) => {
  const store = useTourStore();
  const {
    wizardStep,
    setWizardStep,
    wizardProjectData,
    updateWizardProjectData,
    wizardScenes,
    setWizardScenes,
    addProject,
    setActiveProject,
    runAIAgentsSimulation
  } = store;

  // Wizard UI States
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [isBuildingGraph, setIsBuildingGraph] = useState<boolean>(false);
  const [isGeneratingZip, setIsGeneratingZip] = useState<boolean>(false);

  // EXIF Metadata extraction results
  const [uploadedFilesInfo, setUploadedFilesInfo] = useState<Array<{
    name: string;
    resolution: string;
    size: string;
    isEqui: boolean;
  }>>([]);

  // Questions inside Step 3
  const [qCount, setQCount] = useState<string>('5');
  const [qOrder, setQOrder] = useState<string>('yes');
  const [qAiDetect, setQAiDetect] = useState<boolean>(true);

  // 1. File Upload handler in Step 4
  const handleUploadPanoramas = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const fileList = Array.from(files);
    const scenesList: Scene[] = [];
    const infoList: Array<{ name: string; resolution: string; size: string; isEqui: boolean }> = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const reader = new FileReader();

      // Read file as base64
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = (event) => resolve(event.target?.result as string);
        reader.readAsDataURL(file);
      });

      // Analyze metadata
      const meta = await analyzeImageMetadata(file.name, base64, file.size);
      const validation = runQualityInspection(meta);

      infoList.push({
        name: file.name,
        resolution: meta.resolution,
        size: meta.fileSize,
        isEqui: meta.isEquirectangular
      });

      // Create Scene object
      scenesList.push({
        id: `sc_${Math.random().toString(36).substr(2, 9)}`,
        name: file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' '),
        imageUrl: base64,
        order: i + 1,
        isEntrance: i === 0, // First image as entrance
        metadata: meta,
        validation,
        hotspots: []
      });
    }

    setWizardScenes([...wizardScenes, ...scenesList]);
    setUploadedFilesInfo([...uploadedFilesInfo, ...infoList]);
  };

  // Pre-load 10 generated AI hotel room panoramas with navigation hotspots
  const handleLoadSamples = async () => {
    const rooms = [
      { name: 'Grand Lobby', url: '/samples/rooms/room01_lobby.jpg', emoji: '🏨' },
      { name: 'East Wing Corridor', url: '/samples/rooms/room02_corridor.jpg', emoji: '🚶' },
      { name: 'Conference Room', url: '/samples/rooms/room03_conference.jpg', emoji: '💼' },
      { name: 'Fine Dining Restaurant', url: '/samples/rooms/room04_restaurant.jpg', emoji: '🍽️' },
      { name: 'Indoor Swimming Pool', url: '/samples/rooms/room05_pool.jpg', emoji: '🏊' },
      { name: 'Gym & Fitness Center', url: '/samples/rooms/room06_gym.jpg', emoji: '💪' },
      { name: 'Rooftop Bar & Terrace', url: '/samples/rooms/room07_rooftop.jpg', emoji: '🌃' },
      { name: 'Presidential Suite — Living', url: '/samples/rooms/room08_suite_living.jpg', emoji: '🛋️' },
      { name: 'Presidential Suite — Bedroom', url: '/samples/rooms/room09_suite_bedroom.jpg', emoji: '🛏️' },
      { name: 'Spa & Wellness Center', url: '/samples/rooms/room10_spa.jpg', emoji: '🧘' },
    ];

    const ids = rooms.map((_, i) => `sc_hotel_${i}`);

    const scenesList: Scene[] = rooms.map((room, i) => {
      // Build navigation hotspots: link to next + previous rooms
      const hotspots = [];
      if (i < rooms.length - 1) {
        hotspots.push({
          id: `hs_${i}_next`,
          type: 'navigation' as const,
          label: `→ ${rooms[i + 1].name}`,
          yaw: 0,
          pitch: -15,
          icon: 'arrow' as const,
          actionValue: ids[i + 1],
          animation: 'pulse' as const,
        });
      }
      if (i > 0) {
        hotspots.push({
          id: `hs_${i}_prev`,
          type: 'navigation' as const,
          label: `← ${rooms[i - 1].name}`,
          yaw: 180,
          pitch: -15,
          icon: 'arrow' as const,
          actionValue: ids[i - 1],
          animation: 'pulse' as const,
        });
      }


      return {
        id: ids[i],
        name: `${room.emoji} ${room.name}`,
        imageUrl: room.url,
        order: i + 1,
        isEntrance: i === 0,
        metadata: {
          fileSize: '3.4 MB',
          resolution: '1920 x 1080',
          aspectRatio: '16:9',
          gps: { lat: 25.2048 + i * 0.0001, lng: 55.2708 + i * 0.0001 },
          compassDirection: (i * 36) % 360,
          cameraMake: 'Zoomio Pro',
          cameraModel: 'AI-360-Capture',
          isEquirectangular: true,
        },
        validation: {
          qualityScore: 97 - i,
          brightness: 'optimal' as const,
          blur: 'sharp' as const,
          noise: 'low' as const,
          errors: [],
          warnings: [],
          status: 'pass' as const,
        },
        hotspots,
      };
    });

    const infoList = rooms.map(room => ({
      name: room.name,
      resolution: '1920 x 1080',
      size: '3.4 MB',
      isEqui: true,
    }));

    setWizardScenes([...wizardScenes, ...scenesList]);
    setUploadedFilesInfo([...uploadedFilesInfo, ...infoList]);
  };


  // Trigger AI Image quality checks (Step 5)
  const triggerValidation = () => {
    setIsValidating(true);
    runAIAgentsSimulation(5, () => {
      setIsValidating(false);
      setWizardStep(6);
    });
  };

  // Trigger AI Connection Graph Generation (Step 6)
  const triggerGraphBuilder = () => {
    setIsBuildingGraph(true);
    runAIAgentsSimulation(6, () => {
      setIsBuildingGraph(false);
      
      // Auto generate bidirection links on the wizardScenes list
      const updated = [...wizardScenes];
      for (let i = 0; i < updated.length - 1; i++) {
        // Link node i to i+1
        const fromScene = updated[i];
        const toScene = updated[i + 1];

        // Add hotspot in scene i pointing to i+1
        fromScene.hotspots.push({
          id: `h_nav_${fromScene.id}_to_${toScene.id}`,
          type: 'navigation',
          yaw: 90, // East
          pitch: -10,
          label: `Walk to ${toScene.name}`,
          icon: 'arrow',
          actionValue: toScene.id,
          animation: 'pulse'
        });

        // Add return link hotspot in scene i+1 pointing to i
        toScene.hotspots.push({
          id: `h_nav_${toScene.id}_to_${fromScene.id}`,
          type: 'navigation',
          yaw: -90, // West
          pitch: -10,
          label: `Return to ${fromScene.name}`,
          icon: 'arrow',
          actionValue: fromScene.id,
          animation: 'none'
        });
      }

      setWizardScenes(updated);
      setWizardStep(7);
    });
  };

  // Compile full project from wizard data and download ZIP (Step 15)
  const handleCompileAndDownload = async () => {
    setIsGeneratingZip(true);
    
    // Assemble final project
    const finalProject: Project = {
      id: `proj_${Math.random().toString(36).substr(2, 9)}`,
      name: wizardProjectData.name || 'My Virtual Tour',
      category: wizardProjectData.category as any,
      description: wizardProjectData.description,
      location: wizardProjectData.location,
      coverImage: wizardScenes[0]?.imageUrl,
      primaryColor: wizardProjectData.primaryColor,
      scenes: wizardScenes,
      floorPlans: [], // Fallback empty
      theme: {
        preset: 'modern',
        primaryColor: wizardProjectData.primaryColor,
        secondaryColor: '#0f172a',
        textColor: '#ffffff',
        fontFamily: 'Outfit, sans-serif',
        borderRadius: '0.75rem',
        showWatermark: true,
        watermarkText: 'Zoomio'
      },
      accessibility: {
        keyboardNavigation: true,
        screenReaderDescriptions: {},
        highContrastMode: false,
        audioDescriptions: false
      },
      analytics: {
        visits: 0,
        averageTime: 0,
        hotspotClicks: {},
        sceneViews: {},
        heatmapData: []
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      const zipBlob = await generateOfflineTourZip(finalProject);
      
      // Trigger browser download
      const downloadUrl = URL.createObjectURL(zipBlob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `${finalProject.name.toLowerCase().replace(/\s+/g, '_')}_virtual_tour.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);

      // Save to store
      addProject(finalProject);
      setActiveProject(finalProject);

      // Trigger Confetti!
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 }
      });

      setIsGeneratingZip(false);
      onComplete(); // Back to dashboard or view editor
    } catch (err) {
      alert('Failed to package virtual tour ZIP file.');
      setIsGeneratingZip(false);
    }
  };

  const stepsList = [
    'Welcome',
    'Project Info',
    'AI Planning',
    'Upload Center',
    'AI Quality Validation',
    'Connection Builder',
    'Floor Plan',
    'Hotspots Config',
    'Viewer Setup',
    'Theme Selection',
    'Branding custom',
    'Accessibility',
    'Device Preview',
    'Embed Publish',
    'Generate ZIP'
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 h-[calc(100vh-140px)] flex flex-col justify-between">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 flex-1 overflow-hidden">
        {/* Left progress indicator pane */}
        <div className="lg:col-span-1 border-r border-slate-900 pr-6 overflow-y-auto hidden lg:block scrollbar-thin">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6">Setup Sequence</h3>
          <div className="space-y-4">
            {stepsList.map((step, idx) => {
              const stepNum = idx + 1;
              const isActive = wizardStep === stepNum;
              const isCompleted = wizardStep > stepNum;

              return (
                <div key={idx} className="flex items-center space-x-3.5 group">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border transition-all ${
                      isActive ? 'bg-brand-500 border-brand-500 text-white ring-4 ring-brand-500/20' :
                      isCompleted ? 'bg-slate-900 border-slate-800 text-emerald-400' : 'bg-slate-950 border-slate-800 text-slate-500'
                    }`}
                  >
                    {isCompleted ? '✓' : stepNum}
                  </div>
                  <span
                    className={`text-xs font-semibold transition-all ${
                      isActive ? 'text-white' :
                      isCompleted ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    {step}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Active Content Display Pane */}
        <div className="lg:col-span-3 flex flex-col justify-between overflow-y-auto px-1 scrollbar-thin">
          <div className="flex-1 pr-2">
            
            {/* Step 1: Welcome Splash */}
            {wizardStep === 1 && (
              <div className="flex flex-col items-center justify-center text-center py-12 max-w-xl mx-auto space-y-6">
                <div className="w-20 h-20 bg-brand-500/10 border border-brand-500/20 rounded-full flex items-center justify-center text-4xl animate-float">
                  🌐
                </div>
                <div>
                  <h1 className="text-3xl font-extrabold tracking-tight gradient-text">Create Your Immersive 360° Tour</h1>
                  <p className="text-slate-400 text-sm mt-3 leading-relaxed">
                    Welcome to Zoomio. Our assistant will guide you step-by-step to upload panoramas, validate quality, auto-generate navigation maps, and compile a standalone, offline-ready virtual tour package.
                  </p>
                </div>
                <button
                  onClick={() => setWizardStep(2)}
                  className="px-6 py-3 bg-brand-500 hover:bg-brand-600 rounded-xl text-sm font-bold text-white transition-all shadow-lg shadow-brand-500/20"
                >
                  Start Creating
                </button>
              </div>
            )}

            {/* Step 2: Project Information */}
            {wizardStep === 2 && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h2 className="text-xl font-bold text-white">Project Information</h2>
                  <p className="text-xs text-slate-400 mt-1">Configure project metadata and styling baselines</p>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 font-bold mb-1.5 uppercase tracking-wider">Project Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Stanford Campus Admissions"
                        value={wizardProjectData.name}
                        onChange={(e) => updateWizardProjectData({ name: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 transition-colors"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 font-bold mb-1.5 uppercase tracking-wider">Category</label>
                      <select
                        value={wizardProjectData.category}
                        onChange={(e) => updateWizardProjectData({ category: e.target.value as any })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 transition-colors"
                      >
                        <option value="other">Select category...</option>
                        <option value="university">University / Campus</option>
                        <option value="mall">Shopping Mall / Retail</option>
                        <option value="museum">Art Museum / Gallery</option>
                        <option value="hotel">Resort / Hotel</option>
                        <option value="hospital">Hospital / Clinic</option>
                        <option value="real-estate">Real Estate / Apartment</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 font-bold mb-1.5 uppercase tracking-wider">Location</label>
                    <input
                      type="text"
                      placeholder="e.g. Palo Alto, California"
                      value={wizardProjectData.location}
                      onChange={(e) => updateWizardProjectData({ location: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 font-bold mb-1.5 uppercase tracking-wider">Description</label>
                    <textarea
                      rows={3}
                      placeholder="Describe the tour experience for visitors..."
                      value={wizardProjectData.description}
                      onChange={(e) => updateWizardProjectData({ description: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand-500 transition-colors resize-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 font-bold mb-1.5 uppercase tracking-wider">Primary Brand Color</label>
                    <div className="flex items-center space-x-3">
                      <input
                        type="color"
                        value={wizardProjectData.primaryColor}
                        onChange={(e) => updateWizardProjectData({ primaryColor: e.target.value })}
                        className="w-10 h-10 border-0 bg-transparent cursor-pointer rounded overflow-hidden"
                      />
                      <span className="text-xs text-slate-400 font-mono">{wizardProjectData.primaryColor}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: AI Assistant planning */}
            {wizardStep === 3 && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h2 className="text-xl font-bold text-white">Let's Plan Your Tour</h2>
                  <p className="text-xs text-slate-400 mt-1">Our AI will structure the spatial graph model</p>
                </div>

                <div className="space-y-5">
                  <div className="bg-brand-950/25 border border-brand-900/30 p-4 rounded-xl flex items-start space-x-3">
                    <span className="text-xl">🤖</span>
                    <div>
                      <h4 className="text-xs font-bold text-brand-300">Zoomio Assistant</h4>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                        To generate optimized navigation hotspots, I need some insights. Please tell me about your spatial layouts before uploading files.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs text-slate-400 font-medium mb-1.5">How many location spaces / panoramas do you have?</label>
                      <input
                        type="number"
                        value={qCount}
                        onChange={(e) => setQCount(e.target.value)}
                        className="w-24 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 font-medium mb-1.5">Do you know the walk order of your panorama photos?</label>
                      <div className="flex space-x-3">
                        <button
                          onClick={() => setQOrder('yes')}
                          className={`px-4 py-1.5 text-xs rounded-lg border font-semibold ${
                            qOrder === 'yes' ? 'bg-brand-500 border-brand-500 text-white' : 'border-slate-800 bg-slate-900/50'
                          }`}
                        >
                          Yes, sequential
                        </button>
                        <button
                          onClick={() => setQOrder('no')}
                          className={`px-4 py-1.5 text-xs rounded-lg border font-semibold ${
                            qOrder === 'no' ? 'bg-brand-500 border-brand-500 text-white' : 'border-slate-800 bg-slate-900/50'
                          }`}
                        >
                          No, random files
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 font-medium mb-1.5">Would you like AI Agents to auto-detect scene connection paths?</label>
                      <div className="flex space-x-3">
                        <button
                          onClick={() => setQAiDetect(true)}
                          className={`px-4 py-1.5 text-xs rounded-lg border font-semibold ${
                            qAiDetect ? 'bg-brand-500 border-brand-500 text-white' : 'border-slate-800 bg-slate-900/50'
                          }`}
                        >
                          Yes, automate linkages
                        </button>
                        <button
                          onClick={() => setQAiDetect(false)}
                          className={`px-4 py-1.5 text-xs rounded-lg border font-semibold ${
                            !qAiDetect ? 'bg-brand-500 border-brand-500 text-white' : 'border-slate-800 bg-slate-900/50'
                          }`}
                        >
                          No, link manually
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Uploader center */}
            {wizardStep === 4 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-white">Upload Center</h2>
                  <p className="text-xs text-slate-400 mt-1">Upload 360° panoramas (equirectangular projection)</p>
                </div>

                <div className="space-y-4">
                  {/* Uploader Box */}
                  <label className="border-2 border-slate-800 border-dashed hover:border-brand-500/50 hover:bg-slate-900/10 rounded-2xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-colors group">
                    <Upload size={32} className="text-slate-500 group-hover:text-brand-400 transition-colors" />
                    <span className="text-xs font-bold text-slate-300 mt-3">Drag & Drop 360° Panoramas</span>
                    <span className="text-[10px] text-slate-500 mt-1">Supports JPEG, PNG, WebP (2:1 aspect ratio)</span>
                    <input type="file" multiple accept="image/*" onChange={handleUploadPanoramas} className="hidden" />
                  </label>

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      onClick={handleLoadSamples}
                      className="px-4 py-2 border border-slate-800 bg-slate-900/60 hover:bg-slate-900 rounded-xl text-xs font-semibold text-brand-300 transition-colors"
                    >
                      💡 Load High-Fidelity AI Sample Panoramas
                    </button>
                  </div>

                  {/* Previews grid */}
                  {wizardScenes.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-slate-400 uppercase">Uploaded Files ({wizardScenes.length})</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {wizardScenes.map((scene) => (
                          <div key={scene.id} className="border border-slate-900 bg-slate-950 rounded-xl overflow-hidden shadow-md">
                            <div className="h-24 bg-black flex items-center justify-center overflow-hidden">
                              <img src={scene.imageUrl} alt="preview" className="w-full h-full object-cover" />
                            </div>
                            <div className="p-2">
                              <p className="text-[10px] font-bold text-white truncate">{scene.name}</p>
                              <div className="flex items-center justify-between text-[9px] text-slate-500 mt-1">
                                <span>{scene.metadata.resolution}</span>
                                <span>{scene.metadata.fileSize}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 5: AI Validation report */}
            {wizardStep === 5 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-white">AI Image Validation</h2>
                  <p className="text-xs text-slate-400 mt-1">Analyzing image aspect-ratios, noise, resolution, and exposure</p>
                </div>

                <div className="space-y-4">
                  {isValidating ? (
                    <div className="space-y-6">
                      <div className="flex items-center space-x-3">
                        <span className="w-4 h-4 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
                        <span className="text-xs font-medium text-slate-400">AI Agents running quality audits...</span>
                      </div>
                      <AIAgentLogs />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <CheckCircle2 className="text-emerald-400" size={24} />
                          <div>
                            <h4 className="text-sm font-bold text-white">All checks complete</h4>
                            <p className="text-[10px] text-slate-400 mt-0.5">Images fully validated and optimized for client streaming</p>
                          </div>
                        </div>
                        <button
                          onClick={triggerValidation}
                          className="px-4 py-2 bg-brand-500 hover:bg-brand-600 rounded-xl text-xs font-bold text-white"
                        >
                          Run Quality Audit
                        </button>
                      </div>

                      {/* Reports */}
                      <div className="space-y-3">
                        {wizardScenes.map((scene) => {
                          const status = scene.validation.status;
                          return (
                            <div key={scene.id} className="border border-slate-900 bg-slate-950 p-3.5 rounded-xl flex items-center justify-between">
                              <div>
                                <span className="text-xs font-bold text-slate-200">{scene.name}</span>
                                <div className="flex items-center space-x-4 text-[10px] text-slate-500 mt-1.5">
                                  <span>Aspect: {scene.metadata.aspectRatio}</span>
                                  <span>Exposure: {scene.validation.brightness}</span>
                                  <span>Sharpness: {scene.validation.blur}</span>
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                {status === 'pass' && (
                                  <span className="px-2 py-0.5 text-[9px] font-bold rounded bg-emerald-950 text-emerald-400 border border-emerald-900/20 uppercase">
                                    OPTIMAL
                                  </span>
                                )}
                                {status === 'warning' && (
                                  <span className="px-2 py-0.5 text-[9px] font-bold rounded bg-amber-950 text-amber-400 border border-amber-900/20 uppercase">
                                    WARNING
                                  </span>
                                )}
                                <span className="text-xs font-bold text-white">{scene.validation.qualityScore}/100</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 6: AI Connection Builder */}
            {wizardStep === 6 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-white">AI Connection Builder</h2>
                  <p className="text-xs text-slate-400 mt-1">Predicting geographic adjacency connections and walking graphs</p>
                </div>

                <div className="space-y-4">
                  {isBuildingGraph ? (
                    <div className="space-y-6">
                      <div className="flex items-center space-x-3">
                        <span className="w-4 h-4 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
                        <span className="text-xs font-medium text-slate-400">AI Agents compiling navigation graph...</span>
                      </div>
                      <AIAgentLogs />
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <Info className="text-brand-400" size={24} />
                          <div>
                            <h4 className="text-sm font-bold text-white">Adjacency Path Recognition</h4>
                            <p className="text-[10px] text-slate-400 mt-0.5">Automatically link scenes using EXIF direction cues</p>
                          </div>
                        </div>
                        <button
                          onClick={triggerGraphBuilder}
                          className="px-4 py-2 bg-brand-500 hover:bg-brand-600 rounded-xl text-xs font-bold text-white"
                        >
                          Generate Navigation Graph
                        </button>
                      </div>

                      {/* Display predicted link lists */}
                      <div className="space-y-3">
                        <h4 className="text-xs font-bold text-slate-400 uppercase">Suggested Bidirectional Nodes</h4>
                        {wizardScenes.length < 2 ? (
                          <p className="text-xs text-slate-500">Need at least 2 images to generate links.</p>
                        ) : (
                          <div className="space-y-2">
                            {wizardScenes.slice(0, -1).map((scene, i) => {
                              const next = wizardScenes[i + 1];
                              return (
                                <div key={i} className="border border-slate-900 bg-slate-950 p-3 rounded-xl flex items-center justify-between">
                                  <div className="flex items-center space-x-3 text-xs">
                                    <span className="font-semibold text-slate-200">{scene.name}</span>
                                    <span className="text-slate-600">◀ ➔ ▶</span>
                                    <span className="font-semibold text-slate-200">{next.name}</span>
                                  </div>
                                  <span className="text-[9px] font-bold bg-brand-950 text-brand-400 border border-brand-900/30 px-2 py-0.5 rounded-md uppercase">
                                    Visual Contiguity Match
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 7: Map Builder (Redirect message since full maps are in editor) */}
            {wizardStep === 7 && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h2 className="text-xl font-bold text-white">Interactive Map Builder</h2>
                  <p className="text-xs text-slate-400 mt-1">Overlay panorama coordinates onto floor plans</p>
                </div>
                <div className="p-6 border border-slate-900 bg-slate-950 rounded-2xl text-center space-y-4">
                  <span className="text-3xl block">🗺️</span>
                  <h3 className="text-sm font-bold text-white">Floor Plan Configuration</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    You can upload blueprints or maps and map scene nodes visually. A default ground layout map has been created. You can reposition these markers inside the Advanced Editor studio later.
                  </p>
                  <button
                    onClick={() => setWizardStep(8)}
                    className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-semibold"
                  >
                    Continue to Hotspots
                  </button>
                </div>
              </div>
            )}

            {/* Step 8: Hotspots */}
            {wizardStep === 8 && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h2 className="text-xl font-bold text-white">Hotspots Configuration</h2>
                  <p className="text-xs text-slate-400 mt-1">Configure click events (Audios, Videos, PDFs, Links)</p>
                </div>
                <div className="p-6 border border-slate-900 bg-slate-950 rounded-2xl text-center space-y-4">
                  <span className="text-3xl block">🏷️</span>
                  <h3 className="text-sm font-bold text-white">Interactive Elements</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Default navigation arrows linking your scenes sequentially have been generated by the AI agent. You can append custom popup guides, play voice narrations, or upload PDFs in the next stages.
                  </p>
                  <button
                    onClick={() => setWizardStep(9)}
                    className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-semibold"
                  >
                    Set Transitions
                  </button>
                </div>
              </div>
            )}

            {/* Step 9: Virtual Tour Editor preview */}
            {wizardStep === 9 && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h2 className="text-xl font-bold text-white">Transitions & Viewer Setup</h2>
                  <p className="text-xs text-slate-400 mt-1">Set cameras, timelines and smooth transitions</p>
                </div>
                <div className="p-6 border border-slate-900 bg-slate-950 rounded-2xl text-center space-y-4">
                  <span className="text-3xl block">🎬</span>
                  <h3 className="text-sm font-bold text-white">Timeline Transitions</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Configure walk ease models (Fade, Zoom, Rotate). The player uses a smooth fade ease effect between scene shifts.
                  </p>
                  <button
                    onClick={() => setWizardStep(10)}
                    className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-semibold"
                  >
                    Select Theme
                  </button>
                </div>
              </div>
            )}

            {/* Step 10: Theme Builder */}
            {wizardStep === 10 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-white">Theme Select</h2>
                  <p className="text-xs text-slate-400 mt-1">Choose layout theme styles</p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {['Modern', 'Corporate', 'Luxury', 'Dark'].map((theme, i) => (
                    <div
                      key={i}
                      onClick={() => setWizardStep(11)}
                      className="border border-slate-900 bg-slate-950 p-4 rounded-xl cursor-pointer hover:border-brand-500 transition-colors"
                    >
                      <h4 className="text-xs font-bold text-white">{theme}</h4>
                      <p className="text-[10px] text-slate-500 mt-1">Custom color gradients and spacing profiles</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 11: Branding */}
            {wizardStep === 11 && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h2 className="text-xl font-bold text-white">Branding Customize</h2>
                  <p className="text-xs text-slate-400 mt-1">Upload company logo and watermark overlays</p>
                </div>
                <div className="p-6 border border-slate-900 bg-slate-950 rounded-2xl text-center space-y-4">
                  <span className="text-3xl block">🛡️</span>
                  <h3 className="text-sm font-bold text-white">White-label Watermarking</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Agencies can upload logo files and disable branding tags. Continue to audit accessibility.
                  </p>
                  <button
                    onClick={() => setWizardStep(12)}
                    className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-semibold"
                  >
                    Accessibility Audit
                  </button>
                </div>
              </div>
            )}

            {/* Step 12: Accessibility */}
            {wizardStep === 12 && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h2 className="text-xl font-bold text-white">Accessibility Audit</h2>
                  <p className="text-xs text-slate-400 mt-1">WCAG Web Accessible keyboard route configurations</p>
                </div>
                <div className="p-6 border border-slate-900 bg-slate-950 rounded-2xl text-center space-y-4">
                  <span className="text-3xl block">♿</span>
                  <h3 className="text-sm font-bold text-white">Keyboard Adjacency routes</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    AI Accessibility Agent has generated keyboard indexes and screen reader descriptions.
                  </p>
                  <button
                    onClick={() => setWizardStep(13)}
                    className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-semibold"
                  >
                    View Device Preview
                  </button>
                </div>
              </div>
            )}

            {/* Step 13: Device Preview */}
            {wizardStep === 13 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-white">Device Preview Layout</h2>
                  <p className="text-xs text-slate-400 mt-1">Simulate responsive viewport grids</p>
                </div>
                {wizardScenes.length > 0 ? (
                  <div className="border border-slate-850 rounded-2xl overflow-hidden h-[340px] shadow-lg">
                    <ThreeViewer scene={wizardScenes[0]} editMode={false} autoRotateSpeed={0.5} />
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No scenes uploaded to preview.</p>
                )}
              </div>
            )}

            {/* Step 14: Embed & Publish */}
            {wizardStep === 14 && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h2 className="text-xl font-bold text-white">Publish virtual tour</h2>
                  <p className="text-xs text-slate-400 mt-1">Acquire iframe frames and WordPress shortcodes</p>
                </div>
                <div className="bg-slate-950 p-4 border border-slate-900 rounded-xl">
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Standard Iframe Embed Code</label>
                  <code className="text-[11px] block bg-slate-900 border border-slate-800 p-2.5 rounded text-brand-300 select-all font-mono break-all">
                    &lt;iframe src="https://zoomio.web.app/embed/${wizardProjectData.name.toLowerCase().replace(/\s+/g, '_')}" width="100%" height="600" frameborder="0" allowfullscreen&gt;&lt;/iframe&gt;
                  </code>
                </div>
              </div>
            )}

            {/* Step 15: Download offline bundle */}
            {wizardStep === 15 && (
              <div className="space-y-6 max-w-xl">
                <div>
                  <h2 className="text-xl font-bold text-white">Download Offline Package</h2>
                  <p className="text-xs text-slate-400 mt-1">Generate self-contained standalone ZIP archives</p>
                </div>
                <div className="p-6 border border-slate-900 bg-slate-950 rounded-2xl text-center space-y-4">
                  <span className="text-3xl block">📦</span>
                  <h3 className="text-sm font-bold text-white">ZIP Compilation Complete</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Your virtual tour package is ready for download. This bundle works 100% offline without requiring a database backend. Double-click the index.html file to run it in any browser!
                  </p>
                  
                  <button
                    onClick={handleCompileAndDownload}
                    disabled={isGeneratingZip}
                    className="flex items-center space-x-1.5 px-6 py-3 bg-emerald-500 hover:bg-emerald-600 rounded-xl text-xs font-bold text-white mx-auto shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isGeneratingZip ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Compiling ZIP...</span>
                      </>
                    ) : (
                      <>
                        <span>Download complete package</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

          </div>

          {/* Bottom navigation buttons */}
          {wizardStep > 1 && (
            <div className="flex items-center justify-between border-t border-slate-900 pt-5 mt-6">
              <button
                onClick={() => setWizardStep(wizardStep - 1)}
                className="flex items-center space-x-1 px-4 py-2 border border-slate-800 bg-slate-900/50 hover:bg-slate-900 text-xs font-semibold rounded-xl text-slate-300 transition-colors"
              >
                <ChevronLeft size={14} />
                <span>Back</span>
              </button>

              <div className="flex items-center space-x-3">
                <button
                  onClick={onCancel}
                  className="text-xs text-slate-500 hover:text-slate-400 font-semibold"
                >
                  Exit Wizard
                </button>
                
                {wizardStep < 15 ? (
                  <button
                    onClick={() => {
                      if (wizardStep === 4 && wizardScenes.length === 0) {
                        alert('Please upload at least 1 panorama image to proceed.');
                        return;
                      }
                      setWizardStep(wizardStep + 1);
                    }}
                    className="flex items-center space-x-1 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-xs font-bold text-white rounded-xl transition-all shadow-md shadow-brand-500/10"
                  >
                    <span>Next</span>
                    <ChevronRight size={14} />
                  </button>
                ) : (
                  <button
                    onClick={onComplete}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-xs font-bold text-white rounded-xl transition-all shadow-md shadow-emerald-500/10"
                  >
                    Finish
                  </button>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
