/**
 * Client-side image work. Doing this in the browser rather than the server
 * keeps the deployment dependency-free (no sharp / libvips to compile) and,
 * for the AI path, means a 6000x3000 panorama is never uploaded in full just
 * to be described — it goes over the wire at 1024x512, which is roughly 700
 * image tokens instead of ~4800.
 */

async function loadBitmap(src: string): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    const blob = await (await fetch(src)).blob();
    return createImageBitmap(blob);
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = src;
  });
  return img;
}

function drawTo(
  source: ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
  quality: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

/** Small still used in the scene rail; embedded in tour.json, so keep it tiny. */
export async function makeThumbnail(src: string, width = 192, height = 108): Promise<string> {
  try {
    const bitmap = await loadBitmap(src);
    const url = drawTo(bitmap, width, height, 0.72);
    if ('close' in bitmap) bitmap.close();
    return url;
  } catch {
    return '';
  }
}

/** Downscaled copy for vision requests, returned as bare base64 (no prefix). */
export async function makeAiPreview(src: string): Promise<{ base64: string; mediaType: string }> {
  const bitmap = await loadBitmap(src);
  const dataUrl = drawTo(bitmap, 1024, 512, 0.82);
  if ('close' in bitmap) bitmap.close();
  return { base64: dataUrl.split(',')[1] ?? '', mediaType: 'image/jpeg' };
}

/** Reads a File as a data URL, used when a panorama is added from disk. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export interface ImageFacts {
  width: number;
  height: number;
  aspectRatio: number;
  isEquirectangular: boolean;
  warnings: string[];
}

/**
 * Honest, measurable checks only. The previous version of this app reported
 * fabricated GPS coordinates, camera models, blur and noise scores; anything
 * not actually derivable from the pixels has been removed rather than faked.
 */
export async function inspectImage(src: string, fileSize?: number): Promise<ImageFacts> {
  const bitmap = await loadBitmap(src);
  const width = bitmap.width;
  const height = bitmap.height;
  if ('close' in bitmap) bitmap.close();

  const aspectRatio = width / height;
  const isEquirectangular = Math.abs(aspectRatio - 2) < 0.02;
  const warnings: string[] = [];

  if (!isEquirectangular) {
    warnings.push(
      `Aspect ratio is ${aspectRatio.toFixed(2)}:1. A 360° panorama needs 2:1 ` +
        '(e.g. 6000×3000) or it will look stretched.',
    );
  }
  if (width < 4000) {
    warnings.push(`${width}×${height} is low for a panorama — 4096×2048 or larger looks sharper.`);
  }
  if (fileSize && fileSize > 15 * 1024 * 1024) {
    warnings.push(
      `${(fileSize / 1024 / 1024).toFixed(1)} MB is heavy; visitors on mobile will wait.`,
    );
  }

  return { width, height, aspectRatio, isEquirectangular, warnings };
}
