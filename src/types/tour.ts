export interface EXIFMetadata {
  fileSize: string;
  resolution: string;
  aspectRatio: string;
  gps?: { lat: number; lng: number };
  compassDirection?: number;
  cameraMake?: string;
  cameraModel?: string;
  isEquirectangular: boolean;
}

export interface QualityValidation {
  qualityScore: number;
  brightness: 'optimal' | 'low' | 'high';
  blur: 'sharp' | 'slight' | 'blurry';
  noise: 'low' | 'medium' | 'high';
  errors: string[];
  warnings: string[];
  status: 'pass' | 'warning' | 'fail';
}

export interface Hotspot {
  id: string;
  type: 'navigation' | 'info' | 'image' | 'video' | 'audio' | 'link' | 'pdf' | 'phone';
  yaw: number;
  pitch: number;
  label: string;
  /**
   * Id from the shared catalog in `src/viewer/icons.ts`. Legacy values from
   * earlier saves ('circle', 'pulse', 'media', 'custom') are still accepted and
   * fall back to the type's default icon at render time.
   */
  icon: string;
  customIconUrl?: string;
  actionValue: string;
  animation: 'none' | 'pulse' | 'float' | 'bounce';
  // Style options
  color?: string;       // hotspot accent color
  size?: 'sm' | 'md' | 'lg';
  description?: string; // subtitle/description for info popups
}

export interface TextLabel {
  id: string;
  text: string;
  yaw: number;
  pitch: number;
  fontSize: number;      // 10-32
  color: string;         // text color
  bgColor: string;       // background color
  opacity: number;       // 0-1
  bold: boolean;
  visible: boolean;
  padding?: number;
  borderRadius?: number;
}

export interface SceneLighting {
  brightness: number;   // 50-200, default 100
  contrast: number;     // 50-200, default 100
  saturation: number;   // 0-200, default 100
  hue: number;         // -180 to 180, default 0
  exposure: number;    // 50-200, default 100
}

export interface SceneTransition {
  type: 'fade' | 'zoom' | 'rotate' | 'blur' | 'none';
  duration: number;     // ms, default 600
  easing: 'ease' | 'ease-in' | 'ease-out' | 'linear';
}

export interface Scene {
  id: string;
  name: string;
  description?: string;
  imageUrl: string;
  thumbnail?: string;
  order: number;
  isEntrance: boolean;
  metadata: EXIFMetadata;
  validation: QualityValidation;
  hotspots: Hotspot[];
  textLabels?: TextLabel[];
  lighting?: SceneLighting;
  transition?: SceneTransition;
  initialView?: { yaw: number; pitch: number };
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  audioNarration?: string;
  narrationText?: string;
}

export interface FloorPlanMarker {
  sceneId: string;
  x: number;
  y: number;
}

export interface FloorPlan {
  id: string;
  name: string;
  imageUrl: string;
  markers: FloorPlanMarker[];
}

export interface BrandTheme {
  preset: 'modern' | 'corporate' | 'luxury' | 'dark' | 'minimal' | 'glassmorphism' | 'university' | 'museum' | 'mall' | 'real-estate';
  primaryColor: string;
  secondaryColor: string;
  textColor: string;
  fontFamily: string;
  borderRadius: string;
  showWatermark: boolean;
  watermarkText: string;
  logoUrl?: string;
}

export interface AccessibilityConfig {
  keyboardNavigation: boolean;
  screenReaderDescriptions: Record<string, string>;
  highContrastMode: boolean;
  subtitleTrack?: string;
  audioDescriptions: boolean;
}

export interface TourAnalytics {
  visits: number;
  averageTime: number;
  hotspotClicks: Record<string, number>;
  sceneViews: Record<string, number>;
  heatmapData: Array<{ x: number; y: number; count: number }>;
}

export interface Project {
  id: string;
  name: string;
  category: 'mall' | 'university' | 'hospital' | 'hotel' | 'museum' | 'real-estate' | 'other';
  description: string;
  location: string;
  coverImage?: string;
  logo?: string;
  primaryColor: string;
  scenes: Scene[];
  floorPlans: FloorPlan[];
  theme: BrandTheme;
  accessibility: AccessibilityConfig;
  analytics: TourAnalytics;
  createdAt: string;
  updatedAt: string;
}

export interface AgentLog {
  id: string;
  timestamp: string;
  agentName: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

// Default lighting preset
export const DEFAULT_LIGHTING: SceneLighting = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
  exposure: 100,
};

export const DEFAULT_TRANSITION: SceneTransition = {
  type: 'fade',
  duration: 600,
  easing: 'ease',
};
