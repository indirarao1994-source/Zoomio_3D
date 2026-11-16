import type { EXIFMetadata, QualityValidation } from '../types/tour';

/**
 * Programmatically generates a 2:1 equirectangular panorama texture using HTML Canvas.
 * This is 100% offline, self-contained, and provides realistic architectural-looking interior rooms.
 */
export function generateMockPanorama(roomName: string, primaryColorHex: string = '#3b66ff'): string {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // 1. Draw sky/ceiling gradient (top half)
  const skyGrad = ctx.createLinearGradient(0, 0, 0, height / 2);
  skyGrad.addColorStop(0, '#0f172a');
  skyGrad.addColorStop(1, '#1e293b');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, height / 2);

  // 2. Draw floor gradient (bottom half)
  const floorGrad = ctx.createLinearGradient(0, height / 2, 0, height);
  floorGrad.addColorStop(0, '#334155');
  floorGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, height / 2, width, height / 2);

  // 3. Draw architectural walls & panels
  ctx.fillStyle = primaryColorHex;
  ctx.globalAlpha = 0.15;
  for (let i = 0; i < 4; i++) {
    const x = i * (width / 4) + 20;
    ctx.fillRect(x, height / 4, width / 4 - 40, height / 2);
  }
  ctx.globalAlpha = 1.0;

  // 4. Draw wall outlines (pillars)
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const x = i * (width / 4);
    ctx.beginPath();
    ctx.moveTo(x, height / 4);
    ctx.lineTo(x, 3 * height / 4);
    ctx.stroke();

    // Floor perspective lines
    ctx.beginPath();
    ctx.moveTo(x, 3 * height / 4);
    ctx.lineTo(x, height);
    ctx.stroke();

    // Ceiling perspective lines
    ctx.beginPath();
    ctx.moveTo(x, height / 4);
    ctx.lineTo(x, 0);
    ctx.stroke();
  }

  // 5. Draw decorative windows/lights
  ctx.fillStyle = '#64748b';
  for (let i = 0; i < 4; i++) {
    const wx = i * (width / 4) + (width / 8) - 40;
    // Draw window
    ctx.fillStyle = '#38bdf8';
    ctx.globalAlpha = 0.2;
    ctx.fillRect(wx, height / 3, 80, 80);
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = '#0284c7';
    ctx.strokeRect(wx, height / 3, 80, 80);

    // Cross panes
    ctx.beginPath();
    ctx.moveTo(wx + 40, height / 3);
    ctx.lineTo(wx + 40, height / 3 + 80);
    ctx.moveTo(wx, height / 3 + 40);
    ctx.lineTo(wx + 80, height / 3 + 40);
    ctx.stroke();
  }

  // 6. Draw floor grid lines (simulating tiles)
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  for (let i = 0; i < height / 2; i += 20) {
    ctx.beginPath();
    ctx.moveTo(0, height / 2 + i);
    ctx.lineTo(width, height / 2 + i);
    ctx.stroke();
  }

  // 7. Render room name & details directly onto the wall texture (360 Billboard text)
  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Title
  ctx.font = 'bold 36px Outfit, sans-serif';
  ctx.fillText(roomName.toUpperCase(), width / 2, height / 2 - 20);

  // Subtitle
  ctx.font = '16px Inter, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('Zoomio Interactive 360° Space', width / 2, height / 2 + 25);

  // Compass markings on walls
  const compassPoints = ['NORTH (0°)', 'EAST (90°)', 'SOUTH (180°)', 'WEST (270°)'];
  ctx.font = '12px Courier, monospace';
  ctx.fillStyle = primaryColorHex;
  for (let i = 0; i < 4; i++) {
    const x = i * (width / 4) + (width / 8);
    ctx.fillText(`[ ${compassPoints[i]} ]`, x, height / 4 - 20);
  }

  return canvas.toDataURL('image/jpeg');
}

/**
 * Extracts fake or heuristic EXIF/resolution info from an image file/Base64.
 */
export function analyzeImageMetadata(_fileName: string, dataUrl: string, fileSize: number = 2450000): Promise<EXIFMetadata> {
  return new Promise((resolve) => {
    // Determine resolution from image url
    const img = new Image();
    img.onload = () => {
      const res = `${img.width} x ${img.height}`;
      const aspect = (img.width / img.height).toFixed(2);
      const isEquirectangular = img.width === img.height * 2;

      // Extract random GPS nearby
      const lat = 37.7749 + (Math.random() - 0.5) * 0.05;
      const lng = -122.4194 + (Math.random() - 0.5) * 0.05;

      resolve({
        fileSize: (fileSize / (1024 * 1024)).toFixed(2) + ' MB',
        resolution: res,
        aspectRatio: aspect + ':1',
        gps: { lat, lng },
        compassDirection: Math.floor(Math.random() * 360),
        cameraMake: 'Zoomio Pro',
        cameraModel: 'AI-360-Capture',
        isEquirectangular
      });
    };
    img.onerror = () => {
      resolve({
        fileSize: '0 MB',
        resolution: 'Unknown',
        aspectRatio: 'Unknown',
        isEquirectangular: false
      });
    };
    img.src = dataUrl;
  });
}

/**
 * Validates the quality of a 360 panorama.
 */
export function runQualityInspection(metadata: EXIFMetadata): QualityValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  let score = 95;

  if (!metadata.isEquirectangular) {
    errors.push('Image is not in a 2:1 equirectangular aspect ratio. Recommended aspect ratio is 2:1 (e.g., 6000x3000).');
    score -= 40;
  }

  const [w] = metadata.resolution.split(' x ').map(Number);
  if (w < 4000) {
    warnings.push('Image resolution is low (' + metadata.resolution + '). For high-fidelity tours, 4K+ (4096x2048) resolution is recommended.');
    score -= 20;
  }

  const sizeMb = parseFloat(metadata.fileSize);
  if (sizeMb > 15) {
    warnings.push('File size is very large (' + metadata.fileSize + '). This may slow down mobile client rendering times.');
    score -= 10;
  }

  const status = errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warning' : 'pass';

  return {
    qualityScore: Math.max(0, score),
    brightness: 'optimal',
    blur: 'sharp',
    noise: 'low',
    errors,
    warnings,
    status
  };
}
