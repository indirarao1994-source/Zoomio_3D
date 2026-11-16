import { create } from 'zustand';
import type { Project, Scene, Hotspot, FloorPlan, AgentLog } from '../types/tour';

interface HistoryState {
  undoStack: string[];
  redoStack: string[];
}

interface TourState {
  projects: Project[];
  activeProject: Project | null;
  wizardStep: number;
  wizardProjectData: {
    name: string;
    category: 'university' | 'mall' | 'museum' | 'hotel' | 'hospital' | 'other';
    description: string;
    location: string;
    primaryColor: string;
    coverImage?: string;
    logo?: string;
  };
  wizardScenes: Scene[];
  agentLogs: AgentLog[];
  history: HistoryState;

  // Actions
  setProjects: (projects: Project[]) => void;
  setActiveProject: (project: Project | null) => void;
  addProject: (project: Project) => void;
  deleteProject: (id: string) => void;
  updateProject: (id: string, updated: Partial<Project>) => void;
  
  // Active Project Actions (with Undo/Redo tracking)
  updateActiveProject: (updated: Partial<Project> | ((prev: Project) => Project)) => void;
  addSceneToActiveProject: (scene: Scene) => void;
  updateSceneInActive: (sceneId: string, updated: Partial<Scene>) => void;
  deleteSceneFromActive: (sceneId: string) => void;
  addHotspotToActiveScene: (sceneId: string, hotspot: Hotspot) => void;
  updateHotspotInActiveScene: (sceneId: string, hotspotId: string, updated: Partial<Hotspot>) => void;
  deleteHotspotFromActiveScene: (sceneId: string, hotspotId: string) => void;
  addFloorPlanToActive: (floorPlan: FloorPlan) => void;
  updateFloorPlanInActive: (floorPlanId: string, updated: Partial<FloorPlan>) => void;
  deleteFloorPlanFromActive: (floorPlanId: string) => void;

  // Wizard actions
  setWizardStep: (step: number) => void;
  updateWizardProjectData: (data: Partial<TourState['wizardProjectData']>) => void;
  setWizardScenes: (scenes: Scene[]) => void;
  resetWizard: () => void;

  // AI Agent Logging
  addAgentLog: (agentName: string, message: string, type?: AgentLog['type']) => void;
  clearAgentLogs: () => void;
  runAIAgentsSimulation: (step: number, onComplete?: () => void) => void;

  // Undo/Redo
  saveHistorySnapshot: () => void;
  undo: () => void;
  redo: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  projects: [],
  activeProject: null,
  wizardStep: 1,
  wizardProjectData: {
    name: '',
    category: 'other',
    description: '',
    location: '',
    primaryColor: '#3b66ff'
  },
  wizardScenes: [],
  agentLogs: [],
  history: {
    undoStack: [],
    redoStack: []
  },

  setProjects: (projects) => set({ projects }),
  
  setActiveProject: (activeProject) => {
    set({
      activeProject,
      history: { undoStack: [], redoStack: [] } // Clear history when loading project
    });
  },

  addProject: (project) => set((state) => ({ projects: [project, ...state.projects] })),
  
  deleteProject: (id) => set((state) => ({
    projects: state.projects.filter((p) => p.id !== id),
    activeProject: state.activeProject?.id === id ? null : state.activeProject
  })),

  updateProject: (id, updated) => set((state) => {
    const nextProjects = state.projects.map((p) => (p.id === id ? { ...p, ...updated } : p));
    const nextActive = state.activeProject?.id === id ? { ...state.activeProject, ...updated } : state.activeProject;
    return { projects: nextProjects, activeProject: nextActive };
  }),

  // State Updates with Snapshot History saving
  saveHistorySnapshot: () => {
    const { activeProject, history } = get();
    if (!activeProject) return;
    const projectStr = JSON.stringify(activeProject);
    // Avoid double entries
    if (history.undoStack.length > 0 && history.undoStack[history.undoStack.length - 1] === projectStr) {
      return;
    }
    set({
      history: {
        undoStack: [...history.undoStack, projectStr],
        redoStack: [] // Clear redo on new action
      }
    });
  },

  undo: () => {
    const { history, activeProject } = get();
    if (history.undoStack.length === 0 || !activeProject) return;
    
    const prevProjectStr = history.undoStack[history.undoStack.length - 1];
    const newUndo = history.undoStack.slice(0, -1);
    const newRedo = [...history.redoStack, JSON.stringify(activeProject)];
    
    set({
      activeProject: JSON.parse(prevProjectStr),
      history: {
        undoStack: newUndo,
        redoStack: newRedo
      }
    });
  },

  redo: () => {
    const { history, activeProject } = get();
    if (history.redoStack.length === 0 || !activeProject) return;

    const nextProjectStr = history.redoStack[history.redoStack.length - 1];
    const newRedo = history.redoStack.slice(0, -1);
    const newUndo = [...history.undoStack, JSON.stringify(activeProject)];

    set({
      activeProject: JSON.parse(nextProjectStr),
      history: {
        undoStack: newUndo,
        redoStack: newRedo
      }
    });
  },

  updateActiveProject: (updated) => {
    get().saveHistorySnapshot();
    set((state) => {
      if (!state.activeProject) return {};
      const nextActive = typeof updated === 'function' ? updated(state.activeProject) : { ...state.activeProject, ...updated };
      
      // Update projects list too
      const nextProjects = state.projects.map((p) => (p.id === nextActive.id ? nextActive : p));
      return { activeProject: nextActive, projects: nextProjects };
    });
  },

  addSceneToActiveProject: (scene) => {
    get().updateActiveProject((prev) => ({
      ...prev,
      scenes: [...prev.scenes, scene]
    }));
  },

  updateSceneInActive: (sceneId, updated) => {
    get().updateActiveProject((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) => (s.id === sceneId ? { ...s, ...updated } : s))
    }));
  },

  deleteSceneFromActive: (sceneId) => {
    get().updateActiveProject((prev) => ({
      ...prev,
      scenes: prev.scenes.filter((s) => s.id !== sceneId)
    }));
  },

  addHotspotToActiveScene: (sceneId, hotspot) => {
    get().updateActiveProject((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) => (s.id === sceneId ? { ...s, hotspots: [...s.hotspots, hotspot] } : s))
    }));
  },

  updateHotspotInActiveScene: (sceneId, hotspotId, updated) => {
    get().updateActiveProject((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) => {
        if (s.id !== sceneId) return s;
        return {
          ...s,
          hotspots: s.hotspots.map((h) => (h.id === hotspotId ? { ...h, ...updated } : h))
        };
      })
    }));
  },

  deleteHotspotFromActiveScene: (sceneId, hotspotId) => {
    get().updateActiveProject((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) => {
        if (s.id !== sceneId) return s;
        return {
          ...s,
          hotspots: s.hotspots.filter((h) => h.id !== hotspotId)
        };
      })
    }));
  },

  addFloorPlanToActive: (floorPlan) => {
    get().updateActiveProject((prev) => ({
      ...prev,
      floorPlans: [...prev.floorPlans, floorPlan]
    }));
  },

  updateFloorPlanInActive: (floorPlanId, updated) => {
    get().updateActiveProject((prev) => ({
      ...prev,
      floorPlans: prev.floorPlans.map((fp) => (fp.id === floorPlanId ? { ...fp, ...updated } : fp))
    }));
  },

  deleteFloorPlanFromActive: (floorPlanId) => {
    get().updateActiveProject((prev) => ({
      ...prev,
      floorPlans: prev.floorPlans.filter((fp) => fp.id !== floorPlanId)
    }));
  },

  // Wizard state management
  setWizardStep: (wizardStep) => set({ wizardStep }),
  
  updateWizardProjectData: (data) => set((state) => ({
    wizardProjectData: { ...state.wizardProjectData, ...data }
  })),

  setWizardScenes: (wizardScenes) => set({ wizardScenes }),

  resetWizard: () => set({
    wizardStep: 1,
    wizardProjectData: {
      name: '',
      category: 'other',
      description: '',
      location: '',
      primaryColor: '#3b66ff'
    },
    wizardScenes: [],
    agentLogs: []
  }),

  // AI Agent Logger System
  addAgentLog: (agentName: string, message: string, type: AgentLog['type'] = 'info') => {
    const newLog: AgentLog = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      agentName,
      message,
      type
    };
    set((state) => ({ agentLogs: [...state.agentLogs, newLog] }));
  },

  clearAgentLogs: () => set({ agentLogs: [] }),

  runAIAgentsSimulation: (step, onComplete) => {
    const { addAgentLog } = get();
    get().clearAgentLogs();

    const messagesByStep: Record<number, Array<{ agent: string; msg: string; type: AgentLog['type']; delay: number }>> = {
      // Step 5: AI Validation
      5: [
        { agent: 'Image Validator', msg: 'Scanning uploaded panoramic files...', type: 'info', delay: 300 },
        { agent: 'Image Quality Inspector', msg: 'Inspecting resolution & dimensions of panorama list.', type: 'info', delay: 1000 },
        { agent: 'Image Quality Inspector', msg: 'Brightness level scan complete. Auto-exposure looks solid (94/100).', type: 'success', delay: 1800 },
        { agent: 'Image Validator', msg: 'Checking aspect ratios... All files conform to 2:1 equirectangular projections.', type: 'success', delay: 2500 },
        { agent: 'Image Quality Inspector', msg: 'Blur check passed. Images show high sharpness indexes.', type: 'success', delay: 3200 },
        { agent: 'Optimization Agent', msg: 'Recommended compression actions: Convert high-resolution files to WebP structure to save 62% file size.', type: 'warning', delay: 4000 }
      ],
      // Step 6: AI Connection Graph Builder
      6: [
        { agent: 'Metadata Extractor', msg: 'Extracting GPS data, camera headers, and timestamp tags...', type: 'info', delay: 300 },
        { agent: 'Metadata Extractor', msg: 'GPS landmarks mapped. Positional accuracy +/- 3 meters.', type: 'success', delay: 1000 },
        { agent: 'Scene Relationship Detector', msg: 'Analyzing node adjacency by matching name headers and GPS spatial vectors...', type: 'info', delay: 1800 },
        { agent: 'Scene Relationship Detector', msg: 'Detected Visual Contiguity: Entrance Hall connects with Lobby Central.', type: 'success', delay: 2600 },
        { agent: 'Navigation Graph Generator', msg: 'Synthesizing layout paths. Generating optimized bidirectional graph links.', type: 'success', delay: 3500 },
        { agent: 'Hotspot Recommendation Agent', msg: 'Placement optimization: Arrow transitions recommended at yaw angles pointing towards adjacent doors.', type: 'success', delay: 4300 }
      ],
      // Step 12: Accessibility Audit
      12: [
        { agent: 'Accessibility Agent', msg: 'Auditing virtual tour node structures against WCAG 2.2 guidelines.', type: 'info', delay: 300 },
        { agent: 'Accessibility Agent', msg: 'Synthesized 5 default screen reader description cards based on image titles.', type: 'success', delay: 1200 },
        { agent: 'Accessibility Agent', msg: 'Keyboard route verified. Focus states mapped sequentially to navigation nodes.', type: 'success', delay: 2200 }
      ],
      // Step 14: Publishing Agent
      14: [
        { agent: 'SEO Generator', msg: 'Crafting semantic metadata tags, titles, and crawler description headers.', type: 'success', delay: 400 },
        { agent: 'Optimization Agent', msg: 'Prefetch schema configured: Lazy-load off-screen textures during transition flys.', type: 'info', delay: 1200 },
        { agent: 'Deployment Agent', msg: 'Packaging local artifacts. Standalone offline HTML builder ready.', type: 'success', delay: 2000 }
      ]
    };

    const steps = messagesByStep[step] || [];
    if (steps.length === 0) {
      if (onComplete) onComplete();
      return;
    }

    steps.forEach((item) => {
      setTimeout(() => {
        addAgentLog(item.agent, item.msg, item.type);
        // If it's the last one, trigger completion callback
        if (item === steps[steps.length - 1] && onComplete) {
          setTimeout(onComplete, 500);
        }
      }, item.delay);
    });
  }
}));
