// Unit tests for Zoomio Image Processor Heuristics
import { runQualityInspection } from '../src/utils/imageProcessor';
import { EXIFMetadata } from '../src/types/tour';

describe('Image Quality Inspection Heuristics', () => {
  
  test('Optimal Equirectangular Metadata validation', () => {
    const perfectMetadata: EXIFMetadata = {
      fileSize: '4.5 MB',
      resolution: '4096 x 2048',
      aspectRatio: '2:1',
      isEquirectangular: true
    };

    const report = runQualityInspection(perfectMetadata);
    expect(report.status).toBe('pass');
    expect(report.qualityScore).toBe(95);
    expect(report.errors.length).toBe(0);
    expect(report.warnings.length).toBe(0);
  });

  test('Non-equirectangular aspect ratio validation fails', () => {
    const squareMetadata: EXIFMetadata = {
      fileSize: '1.2 MB',
      resolution: '1000 x 1000',
      aspectRatio: '1:1',
      isEquirectangular: false
    };

    const report = runQualityInspection(squareMetadata);
    expect(report.status).toBe('fail');
    expect(report.qualityScore).toBeLessThan(60);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]).toContain('not in a 2:1 equirectangular aspect ratio');
  });

  test('Low resolution warning triggers', () => {
    const lowResMetadata: EXIFMetadata = {
      fileSize: '0.8 MB',
      resolution: '2048 x 1024',
      aspectRatio: '2:1',
      isEquirectangular: true
    };

    const report = runQualityInspection(lowResMetadata);
    expect(report.status).toBe('warning');
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings[0]).toContain('resolution is low');
  });
  
});
