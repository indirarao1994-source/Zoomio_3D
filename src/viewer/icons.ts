/**
 * Shared hotspot icon catalog.
 *
 * Icons are stored as SVG path data on a 24x24 grid, which lets the same
 * definition drive both renderers with no duplicated artwork:
 * - the studio overlays them as inline <svg>,
 * - the published player rasterises them with Path2D onto a canvas texture.
 *
 * Nothing is loaded over the network, so a published tour still makes zero
 * extra requests no matter how many icons it uses.
 */

export type HotspotIconId =
  | 'pin'
  | 'arrow'
  | 'door'
  | 'stairs'
  | 'info'
  | 'image'
  | 'video'
  | 'audio'
  | 'link'
  | 'dot'
  | 'star'
  | 'cart'
  | 'food'
  | 'bed'
  | 'wifi'
  | 'phone';

export interface IconPath {
  d: string;
  /** Filled shapes read as solid markers; stroked ones as line art. */
  fill?: boolean;
  /**
   * Drawn in the contrasting colour rather than the accent — used to punch the
   * hole in a map pin so it reads correctly against any background.
   */
  contrast?: boolean;
}

export interface HotspotIconDef {
  id: HotspotIconId;
  label: string;
  paths: IconPath[];
  /**
   * `bottom` means the shape's tip marks the exact point, so the marker must be
   * lifted by half its height. A pin drawn centred silently points above the
   * thing it labels.
   */
  anchor: 'center' | 'bottom';
}

export const HOTSPOT_ICONS: HotspotIconDef[] = [
  {
    id: 'pin',
    label: 'Location pin',
    anchor: 'bottom',
    paths: [
      // Google-Maps style teardrop: tip at (12,22), bulb centred on (12,9).
      { d: 'M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z', fill: true },
      { d: 'M12 11.6a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2z', fill: true, contrast: true },
    ],
  },
  {
    id: 'arrow',
    label: 'Direction',
    anchor: 'center',
    paths: [{ d: 'M6 14.5l6-6 6 6' }],
  },
  {
    id: 'door',
    label: 'Doorway',
    anchor: 'center',
    paths: [
      { d: 'M7 3.5h8.5a1.5 1.5 0 0 1 1.5 1.5v15.5H7z' },
      { d: 'M13.6 12.2h.02', fill: true },
    ],
  },
  {
    id: 'stairs',
    label: 'Stairs',
    anchor: 'center',
    paths: [{ d: 'M4 19h4v-4h4v-4h4V7h4' }],
  },
  {
    id: 'info',
    label: 'Information',
    anchor: 'center',
    paths: [
      { d: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z' },
      { d: 'M12 11v5' },
      { d: 'M12 7.6h.02', fill: true },
    ],
  },
  {
    id: 'image',
    label: 'Photo',
    anchor: 'center',
    paths: [
      { d: 'M4 5.5h16v13H4z' },
      { d: 'M4 15l4.5-4.5 4 4 3-3L20 15' },
      { d: 'M9 9.6h.02', fill: true },
    ],
  },
  {
    id: 'video',
    label: 'Video',
    anchor: 'center',
    paths: [{ d: 'M8 5.5l11 6.5-11 6.5z', fill: true }],
  },
  {
    id: 'audio',
    label: 'Audio',
    anchor: 'center',
    paths: [
      { d: 'M4 9.5h3.5L12 5.5v13L7.5 14.5H4z', fill: true },
      { d: 'M15.5 9a4.2 4.2 0 0 1 0 6' },
      { d: 'M18.2 6.4a8 8 0 0 1 0 11.2' },
    ],
  },
  {
    id: 'link',
    label: 'Web link',
    anchor: 'center',
    paths: [
      { d: 'M10.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.54 3.54 0 0 0-5-5l-1.2 1.2' },
      { d: 'M13.5 10.5a3.5 3.5 0 0 0-5 0L6 13a3.54 3.54 0 0 0 5 5l1.2-1.2' },
    ],
  },
  {
    id: 'dot',
    label: 'Simple dot',
    anchor: 'center',
    paths: [{ d: 'M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10z', fill: true }],
  },
  {
    id: 'star',
    label: 'Highlight',
    anchor: 'center',
    paths: [{ d: 'M12 3.5l2.6 5.5 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z', fill: true }],
  },
  {
    id: 'cart',
    label: 'Shop / product',
    anchor: 'center',
    paths: [
      { d: 'M3.5 4.5h2.2l2.3 10.5h9.2l2.1-7.6H7' },
      { d: 'M9.4 19.2h.02', fill: true },
      { d: 'M16.6 19.2h.02', fill: true },
    ],
  },
  {
    id: 'food',
    label: 'Food & drink',
    anchor: 'center',
    paths: [
      { d: 'M6 3.5v7a2.5 2.5 0 0 0 5 0v-7' },
      { d: 'M8.5 13v7.5' },
      { d: 'M17.5 3.5c-1.7 0-2.8 1.6-2.8 4s1.1 3.6 2.8 3.6V20.5' },
    ],
  },
  {
    id: 'bed',
    label: 'Room / bed',
    anchor: 'center',
    paths: [
      { d: 'M3.5 18v-9' },
      { d: 'M3.5 13h17v5' },
      { d: 'M20.5 13v-2a2 2 0 0 0-2-2h-7v4' },
      { d: 'M7.2 10.8h.02', fill: true },
    ],
  },
  {
    id: 'wifi',
    label: 'Wi-Fi / facility',
    anchor: 'center',
    paths: [
      { d: 'M4.5 9.5a12 12 0 0 1 15 0' },
      { d: 'M7.5 13a7.6 7.6 0 0 1 9 0' },
      { d: 'M10.5 16.4a3.2 3.2 0 0 1 3 0' },
      { d: 'M12 19.5h.02', fill: true },
    ],
  },
  {
    id: 'phone',
    label: 'Phone',
    anchor: 'center',
    paths: [
      {
        d: 'M6.5 4.5h3l1.5 3.7-1.9 1.4a11 11 0 0 0 5.3 5.3l1.4-1.9 3.7 1.5v3a1.5 1.5 0 0 1-1.6 1.5C10.6 18.4 5.6 13.4 5 6.1a1.5 1.5 0 0 1 1.5-1.6z',
      },
    ],
  },
];

const BY_ID = new Map(HOTSPOT_ICONS.map((i) => [i.id, i]));

/** Icon each hotspot type starts with when it is first placed. */
export const DEFAULT_ICON_FOR_TYPE: Record<string, HotspotIconId> = {
  // Navigation points somewhere, so a direction chevron beats a pin.
  navigation: 'arrow',
  // Everything else marks a place or an object — the map pin is what people
  // already recognise from Google Maps.
  info: 'pin',
  image: 'image',
  video: 'video',
  audio: 'audio',
  link: 'link',
  pdf: 'info',
  phone: 'phone',
};

export function getHotspotIcon(
  iconId: string | undefined,
  type: string | undefined,
): HotspotIconDef {
  return (
    (iconId && BY_ID.get(iconId as HotspotIconId)) ||
    BY_ID.get(DEFAULT_ICON_FOR_TYPE[type ?? ''] ?? 'pin') ||
    BY_ID.get('pin')!
  );
}

/** Inline SVG markup for the studio's DOM overlays. */
export function iconToSvg(
  def: HotspotIconDef,
  accent = '#ffffff',
  contrast = '#0f172a',
  size = 24,
): string {
  const body = def.paths
    .map((p) => {
      const colour = p.contrast ? contrast : accent;
      return p.fill
        ? `<path d="${p.d}" fill="${colour}"/>`
        : `<path d="${p.d}" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}
