/**
 * Camera choreography for video export.
 *
 * The export renders deterministically: given a frame index it computes exactly
 * where the camera should be, rather than sampling a live animation. That means
 * the result is identical on a fast desktop and a slow laptop — a real-time
 * screen capture would drop frames on slower machines and produce a stuttery
 * video, which is exactly the file the customer would then post publicly.
 */

export interface VideoSceneRef {
  id: string;
  name: string;
  /** Yaw the scene opens on, in degrees. */
  initialYaw?: number;
}

export type Orientation = 'landscape' | 'portrait' | 'square';

export interface OrientationSpec {
  id: Orientation;
  label: string;
  /** Where this shape is normally posted, shown in the picker. */
  hint: string;
  width: number;
  height: number;
  /**
   * Vertical framing needs a narrower horizontal field of view or the panorama
   * looks squashed; landscape can afford a wider one.
   */
  fov: number;
}

export const ORIENTATIONS: OrientationSpec[] = [
  {
    id: 'landscape',
    label: 'Landscape 16:9',
    hint: 'YouTube, websites, email',
    width: 1280,
    height: 720,
    fov: 78,
  },
  {
    id: 'portrait',
    label: 'Portrait 9:16',
    hint: 'WhatsApp Status, Reels, Shorts',
    width: 720,
    height: 1280,
    fov: 62,
  },
  {
    id: 'square',
    label: 'Square 1:1',
    hint: 'Instagram feed, LinkedIn',
    width: 1000,
    height: 1000,
    fov: 70,
  },
];

export interface PathOptions {
  scenes: VideoSceneRef[];
  /** Seconds the camera spends inside each scene. */
  secondsPerScene: number;
  /** Seconds of cross-fade between consecutive scenes. */
  transitionSeconds: number;
  fps: number;
  /** Degrees of horizontal sweep within a scene. */
  sweepDegrees: number;
}

export interface FrameInstruction {
  frame: number;
  sceneIndex: number;
  yaw: number;
  pitch: number;
  /**
   * 0 while settled in a scene; ramps 0→1 across a transition so the caller can
   * cross-fade to `nextSceneIndex`.
   */
  transitionProgress: number;
  nextSceneIndex: number | null;
  /** Title card opacity, 1 → 0 over the opening seconds. */
  titleOpacity: number;
}

/** Ease that starts and ends still, so pans don't jerk at the boundaries. */
function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export function totalFrames(opts: PathOptions): number {
  const perScene = Math.round(opts.secondsPerScene * opts.fps);
  return perScene * opts.scenes.length;
}

export function estimateDuration(opts: PathOptions): number {
  return opts.secondsPerScene * opts.scenes.length;
}

/**
 * Resolves a single frame to a camera pose. Each scene gets an eased horizontal
 * sweep centred on its opening yaw; the tail of each scene overlaps the next to
 * drive the cross-fade.
 */
export function frameAt(frame: number, opts: PathOptions): FrameInstruction {
  const perScene = Math.max(1, Math.round(opts.secondsPerScene * opts.fps));
  const transitionFrames = Math.max(1, Math.round(opts.transitionSeconds * opts.fps));

  const sceneIndex = Math.min(opts.scenes.length - 1, Math.floor(frame / perScene));
  const within = frame - sceneIndex * perScene;
  const t = within / perScene;

  const scene = opts.scenes[sceneIndex];
  const startYaw = (scene?.initialYaw ?? 0) - opts.sweepDegrees / 2;
  const yaw = startYaw + easeInOutSine(t) * opts.sweepDegrees;

  // A gentle rise from slightly below eye level reads as "looking around a
  // room" rather than a flat spin.
  const pitch = -6 + Math.sin(t * Math.PI) * 6;

  const framesLeft = perScene - within;
  const isLast = sceneIndex >= opts.scenes.length - 1;
  const inTransition = !isLast && framesLeft <= transitionFrames;

  return {
    frame,
    sceneIndex,
    yaw,
    pitch,
    transitionProgress: inTransition ? 1 - framesLeft / transitionFrames : 0,
    nextSceneIndex: inTransition ? sceneIndex + 1 : null,
    // Title card holds briefly then fades, only over the first scene.
    titleOpacity:
      sceneIndex === 0 ? Math.max(0, 1 - Math.max(0, within - opts.fps * 1.2) / (opts.fps * 0.8)) : 0,
  };
}
