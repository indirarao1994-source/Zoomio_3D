/**
 * Engine-level types. Deliberately framework-agnostic and free of any React or
 * studio imports so the exact same engine powers the editor canvas, the
 * downloaded ZIP, and the hosted tour.
 */

export type HotspotKind =
  | 'navigation'
  | 'info'
  | 'image'
  | 'video'
  | 'audio'
  | 'link'
  | 'pdf'
  | 'phone';

/**
 * Id from the shared catalog in `./icons.ts`. Kept as a plain string so tours
 * saved by older versions still load; unknown ids fall back to the hotspot
 * type's default icon at render time.
 */
export type HotspotIcon = string;

export type HotspotAnimation = 'none' | 'pulse' | 'float' | 'bounce';

export interface PanoHotspot {
  id: string;
  type: HotspotKind;
  /** Degrees, -180..180. 0 faces the panorama's centre column. */
  yaw: number;
  /** Degrees, -90..90. Positive looks up. */
  pitch: number;
  label: string;
  icon: HotspotIcon;
  customIconUrl?: string;
  /** Target scene id for `navigation`; free text / URL for everything else. */
  actionValue: string;
  animation: HotspotAnimation;
}

export interface PanoScene {
  id: string;
  name: string;
  imageUrl: string;
  hotspots: PanoHotspot[];
  /** Initial camera yaw in degrees when the scene is entered. */
  initialYaw?: number;
  initialPitch?: number;
  /** Compass offset: real-world bearing of yaw 0, for the compass widget. */
  northOffset?: number;
  narrationText?: string;
  audioNarration?: string;
}

export interface PanoTheme {
  primaryColor: string;
  textColor: string;
  /** Hotspot ring/fill accent. Falls back to primaryColor. */
  accentColor?: string;
}

export type LoadPhase = 'idle' | 'preview' | 'full' | 'error';

export interface PanoEngineEvents {
  /** Fired once the very first scene has a full-resolution texture. */
  onReady?: () => void;
  /** 0..1 across the current scene's load, plus which phase produced it. */
  onProgress?: (progress: number, phase: LoadPhase) => void;
  onSceneChange?: (sceneId: string, index: number) => void;
  /** Continuous camera feedback, used to drive compass and minimap widgets. */
  onCameraMove?: (yaw: number, pitch: number, fov: number) => void;
  onHotspotClick?: (hotspot: PanoHotspot) => void;
  onHotspotHover?: (hotspot: PanoHotspot | null) => void;
  /** Only fires in edit mode, when the user clicks empty panorama space. */
  onPlace?: (yaw: number, pitch: number) => void;
  onError?: (message: string) => void;
  onXRStateChange?: (active: boolean, mode: 'vr' | 'ar' | null) => void;
}

export interface PanoEngineOptions extends PanoEngineEvents {
  container: HTMLElement;
  scenes: PanoScene[];
  initialSceneId?: string;
  theme?: PanoTheme;
  /** Shows placement affordances and reports clicks on empty space. */
  editMode?: boolean;
  /** Degrees per second of idle auto-rotation. 0 disables. */
  autoRotateSpeed?: number;
  /** Seconds of user inactivity before auto-rotate resumes. */
  autoRotateDelay?: number;
  /** Initial vertical field of view in degrees. */
  fov?: number;
  minFov?: number;
  maxFov?: number;
  /** Enables the WebXR code paths. Harmless when the device lacks support. */
  xr?: boolean;
  /**
   * Street-View-style discs on the floor for navigation routes. On by default;
   * the studio turns them off while placing hotspots so they don't sit under
   * the author's cursor.
   */
  floorMarkers?: boolean;
}
