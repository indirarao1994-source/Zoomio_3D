import type { Project, Scene, FloorPlan } from '../types/tour';
import { generateMockPanorama } from './imageProcessor';

// Simple floor plan generated programmatically on canvas to be offline-safe
function generateMockFloorPlan(title: string, color: string = '#3b66ff'): string {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 300;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 400, 300);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  // Grid
  for (let i = 0; i < 400; i += 20) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 300); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(400, i); ctx.stroke();
  }

  // Walls
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 4;
  ctx.strokeRect(30, 30, 340, 240);
  
  // Inner dividers
  ctx.beginPath();
  ctx.moveTo(200, 30);
  ctx.lineTo(200, 270);
  ctx.moveTo(30, 150);
  ctx.lineTo(370, 150);
  ctx.stroke();

  // Rooms Label
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px Outfit, sans-serif';
  ctx.fillText('Lobby / Entrance', 50, 80);
  ctx.fillText('Main Hall', 230, 80);
  ctx.fillText('Section A', 50, 200);
  ctx.fillText('Section B', 230, 200);

  // Compass Rose
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(350, 50, 15, 0, Math.PI * 2);
  ctx.moveTo(350, 30); ctx.lineTo(350, 70);
  ctx.moveTo(330, 50); ctx.lineTo(370, 50);
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 8px Courier';
  ctx.fillText('N', 348, 28);

  // Title
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 14px Outfit, sans-serif';
  ctx.fillText(title + ' Map', 20, 280);

  return canvas.toDataURL('image/png');
}

export function getMockTemplateProject(
  category: 'university' | 'mall' | 'museum' | 'hotel' | 'hospital',
  projectName: string = ''
): Project {
  const id = `mock_${category}_${Math.random().toString(36).substr(2, 9)}`;
  const title = projectName || `${category.charAt(0).toUpperCase() + category.slice(1)} Virtual Tour`;
  
  let primaryColor = '#3b66ff'; // Default Blue
  if (category === 'hotel') primaryColor = '#d97706'; // Luxury Amber
  if (category === 'museum') primaryColor = '#8b5cf6'; // Art Violet
  if (category === 'mall') primaryColor = '#ec4899'; // Retail Pink
  if (category === 'hospital') primaryColor = '#10b981'; // Medical Teal

  const floorPlanImage = generateMockFloorPlan(title, primaryColor);

  // 1. Generate Scenes based on template category
  let scenes: Scene[] = [];
  let floorPlans: FloorPlan[] = [];

  if (category === 'university') {
    const s1_img = generateMockPanorama('Admissions Welcome Plaza', primaryColor);
    const s2_img = generateMockPanorama('Main Green Quad', primaryColor);
    const s3_img = generateMockPanorama('Dean Admissions Lobby', primaryColor);
    const s4_img = generateMockPanorama('General Science Auditorium', primaryColor);
    const s5_img = generateMockPanorama('Academic Central Library', primaryColor);

    scenes = [
      {
        id: 'uni_entrance',
        name: 'Admissions Welcome Plaza',
        imageUrl: s1_img,
        order: 1,
        isEntrance: true,
        metadata: { fileSize: '2.1 MB', resolution: '4096 x 2048', aspectRatio: '2:1', gps: { lat: 37.7749, lng: -122.4194 }, compassDirection: 0, cameraMake: 'Insta360', cameraModel: 'ONE X2', isEquirectangular: true },
        validation: { qualityScore: 98, brightness: 'optimal', blur: 'sharp', noise: 'low', errors: [], warnings: [], status: 'pass' },
        hotspots: [
          { id: 'h_uni_1', type: 'navigation', yaw: 45, pitch: -10, label: 'Walk to Main Quad', icon: 'arrow', actionValue: 'uni_quad', animation: 'pulse' },
          { id: 'h_uni_2', type: 'info', yaw: -30, pitch: 5, label: 'Plaza Information', icon: 'circle', actionValue: 'Welcome to our campus! The admissions plaza was built in 2012 to greet incoming freshmen and visitors.', animation: 'float' }
        ],
        narrationText: 'Welcome to the Admissions Welcome Plaza. From here, you can walk forward into the Main Green Quad or check out the Admissions lobby.'
      },
      {
        id: 'uni_quad',
        name: 'Main Green Quad',
        imageUrl: s2_img,
        order: 2,
        isEntrance: false,
        metadata: { fileSize: '2.4 MB', resolution: '4096 x 2048', aspectRatio: '2:1', gps: { lat: 37.7752, lng: -122.4192 }, compassDirection: 90, cameraMake: 'Insta360', cameraModel: 'ONE X2', isEquirectangular: true },
        validation: { qualityScore: 96, brightness: 'optimal', blur: 'sharp', noise: 'low', errors: [], warnings: [], status: 'pass' },
        hotspots: [
          { id: 'h_uni_3', type: 'navigation', yaw: -180, pitch: -10, label: 'Return to Entrance', icon: 'arrow', actionValue: 'uni_entrance', animation: 'none' },
          { id: 'h_uni_4', type: 'navigation', yaw: 120, pitch: -5, label: 'Enter Admissions Lobby', icon: 'door', actionValue: 'uni_lobby', animation: 'pulse' },
          { id: 'h_uni_5', type: 'navigation', yaw: -60, pitch: -10, label: 'Go to central Library', icon: 'arrow', actionValue: 'uni_library', animation: 'bounce' },
          { id: 'h_uni_6', type: 'navigation', yaw: 30, pitch: -10, label: 'Walk to Science Hall', icon: 'arrow', actionValue: 'uni_science', animation: 'none' }
        ],
        narrationText: 'This is the Main Green Quad, the heart of our campus life. You can access the Admissions Office, the Science Auditorium, and the Central Library from here.'
      },
      {
        id: 'uni_lobby',
        name: 'Dean Admissions Lobby',
        imageUrl: s3_img,
        order: 3,
        isEntrance: false,
        metadata: { fileSize: '1.9 MB', resolution: '4096 x 2048', aspectRatio: '2:1', gps: { lat: 37.7750, lng: -122.4190 }, compassDirection: 180, cameraMake: 'Insta360', cameraModel: 'ONE X2', isEquirectangular: true },
        validation: { qualityScore: 94, brightness: 'optimal', blur: 'sharp', noise: 'low', errors: [], warnings: [], status: 'pass' },
        hotspots: [
          { id: 'h_uni_7', type: 'navigation', yaw: -90, pitch: -10, label: 'Exit to Quad', icon: 'arrow', actionValue: 'uni_quad', animation: 'none' },
          { id: 'h_uni_8', type: 'pdf', yaw: 10, pitch: 0, label: 'Download Campus Brochure', icon: 'custom', actionValue: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', animation: 'float' },
          { id: 'h_uni_9', type: 'phone', yaw: 50, pitch: -5, label: 'Call Office: +1 (555) 987-6543', icon: 'circle', actionValue: '15559876543', animation: 'pulse' }
        ],
        narrationText: 'You have entered the Admissions Lobby. You can download our campus brochure here, or contact the office directly.'
      },
      {
        id: 'uni_science',
        name: 'General Science Auditorium',
        imageUrl: s4_img,
        order: 4,
        isEntrance: false,
        metadata: { fileSize: '2.6 MB', resolution: '4096 x 2048', aspectRatio: '2:1', gps: { lat: 37.7755, lng: -122.4193 }, compassDirection: 270, cameraMake: 'Insta360', cameraModel: 'ONE X2', isEquirectangular: true },
        validation: { qualityScore: 92, brightness: 'optimal', blur: 'sharp', noise: 'low', errors: [], warnings: ['Slight corner lighting glare detected'], status: 'warning' },
        hotspots: [
          { id: 'h_uni_10', type: 'navigation', yaw: -130, pitch: -10, label: 'Return to Quad', icon: 'arrow', actionValue: 'uni_quad', animation: 'none' },
          { id: 'h_uni_11', type: 'video', yaw: 15, pitch: 10, label: 'Watch Lecture Demo', icon: 'circle', actionValue: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', animation: 'pulse' }
        ],
        narrationText: 'Welcome to the Science Auditorium, equipped with standard modern state-of-the-art interactive display screens and lecture capturing equipment.'
      },
      {
        id: 'uni_library',
        name: 'Academic Central Library',
        imageUrl: s5_img,
        order: 5,
        isEntrance: false,
        metadata: { fileSize: '2.8 MB', resolution: '4096 x 2048', aspectRatio: '2:1', gps: { lat: 37.7751, lng: -122.4195 }, compassDirection: 45, cameraMake: 'Insta360', cameraModel: 'ONE X2', isEquirectangular: true },
        validation: { qualityScore: 95, brightness: 'optimal', blur: 'sharp', noise: 'low', errors: [], warnings: [], status: 'pass' },
        hotspots: [
          { id: 'h_uni_12', type: 'navigation', yaw: 180, pitch: -10, label: 'Return to Quad', icon: 'arrow', actionValue: 'uni_quad', animation: 'none' },
          { id: 'h_uni_13', type: 'link', yaw: 0, pitch: 0, label: 'Search Online Catalog', icon: 'circle', actionValue: 'https://fonts.google.com', animation: 'float' },
          { id: 'h_uni_14', type: 'audio', yaw: -60, pitch: 5, label: 'Library Guide Audio', icon: 'custom', actionValue: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', animation: 'none' }
        ],
        narrationText: 'Shhh... You are now inside the Academic Central Library. Feel free to browse the online catalogs or ask for guide assistance.'
      }
    ];

    floorPlans = [
      {
        id: 'uni_floor_1',
        name: 'Campus Main Layout',
        imageUrl: floorPlanImage,
        markers: [
          { sceneId: 'uni_entrance', x: 20, y: 30 },
          { sceneId: 'uni_quad', x: 50, y: 50 },
          { sceneId: 'uni_lobby', x: 80, y: 30 },
          { sceneId: 'uni_science', x: 80, y: 70 },
          { sceneId: 'uni_library', x: 20, y: 70 }
        ]
      }
    ];
  } else {
    // Generates a shorter generic template for other categories
    const s1_img = generateMockPanorama(`${category.charAt(0).toUpperCase() + category.slice(1)} Grand Entrance`, primaryColor);
    const s2_img = generateMockPanorama(`${category.charAt(0).toUpperCase() + category.slice(1)} Central Lobby`, primaryColor);
    const s3_img = generateMockPanorama(`${category.charAt(0).toUpperCase() + category.slice(1)} Premium Lounge`, primaryColor);

    scenes = [
      {
        id: 'gen_entrance',
        name: `${category.charAt(0).toUpperCase() + category.slice(1)} Grand Entrance`,
        imageUrl: s1_img,
        order: 1,
        isEntrance: true,
        metadata: { fileSize: '2.0 MB', resolution: '4096 x 2048', aspectRatio: '2:1', gps: { lat: 37.7749, lng: -122.4194 }, compassDirection: 0, cameraMake: 'Panasonic', cameraModel: 'Lumix GH6', isEquirectangular: true },
        validation: { qualityScore: 97, brightness: 'optimal', blur: 'sharp', noise: 'low', errors: [], warnings: [], status: 'pass' },
        hotspots: [
          { id: 'h_gen_1', type: 'navigation', yaw: 0, pitch: -10, label: 'Walk to Lobby', icon: 'arrow', actionValue: 'gen_lobby', animation: 'pulse' }
        ]
      },
      {
        id: 'gen_lobby',
        name: `${category.charAt(0).toUpperCase() + category.slice(1)} Central Lobby`,
        imageUrl: s2_img,
        order: 2,
        isEntrance: false,
        metadata: { fileSize: '2.2 MB', resolution: '4096 x 2048', aspectRatio: '2:1', gps: { lat: 37.7750, lng: -122.4194 }, compassDirection: 90, cameraMake: 'Panasonic', cameraModel: 'Lumix GH6', isEquirectangular: true },
        validation: { qualityScore: 94, brightness: 'optimal', blur: 'sharp', noise: 'low', errors: [], warnings: [], status: 'pass' },
        hotspots: [
          { id: 'h_gen_2', type: 'navigation', yaw: 180, pitch: -10, label: 'Go Back', icon: 'arrow', actionValue: 'gen_entrance', animation: 'none' },
          { id: 'h_gen_3', type: 'navigation', yaw: 45, pitch: -5, label: 'Enter Premium Lounge', icon: 'door', actionValue: 'gen_lounge', animation: 'pulse' }
        ]
      },
      {
        id: 'gen_lounge',
        name: `${category.charAt(0).toUpperCase() + category.slice(1)} Premium Lounge`,
        imageUrl: s3_img,
        order: 3,
        isEntrance: false,
        metadata: { fileSize: '1.8 MB', resolution: '4096 x 2048', aspectRatio: '2:1', gps: { lat: 37.7751, lng: -122.4195 }, compassDirection: 180, cameraMake: 'Panasonic', cameraModel: 'Lumix GH6', isEquirectangular: true },
        validation: { qualityScore: 96, brightness: 'optimal', blur: 'sharp', noise: 'low', errors: [], warnings: [], status: 'pass' },
        hotspots: [
          { id: 'h_gen_4', type: 'navigation', yaw: -135, pitch: -10, label: 'Return to Lobby', icon: 'arrow', actionValue: 'gen_lobby', animation: 'none' },
          { id: 'h_gen_5', type: 'info', yaw: 10, pitch: 0, label: 'Lounge Features', icon: 'circle', actionValue: 'Welcome to our premium customer suite. Equipped with free high-speed Wi-Fi, refreshments, and business amenities.', animation: 'float' }
        ]
      }
    ];

    floorPlans = [
      {
        id: 'gen_floor',
        name: 'Ground Floor Blueprint',
        imageUrl: floorPlanImage,
        markers: [
          { sceneId: 'gen_entrance', x: 25, y: 50 },
          { sceneId: 'gen_lobby', x: 50, y: 50 },
          { sceneId: 'gen_lounge', x: 75, y: 50 }
        ]
      }
    ];
  }

  return {
    id,
    name: title,
    category,
    description: `A state-of-the-art interactive virtual tour of our high-quality ${category} facilities, generated by Zoomio.`,
    location: 'Silicon Valley, California, USA',
    primaryColor,
    scenes,
    floorPlans,
    theme: {
      preset: category === 'hotel' ? 'luxury' : category === 'museum' ? 'glassmorphism' : 'modern',
      primaryColor,
      secondaryColor: '#1e293b',
      textColor: '#ffffff',
      fontFamily: 'Outfit, sans-serif',
      borderRadius: '0.75rem',
      showWatermark: true,
      watermarkText: 'Created with Zoomio'
    },
    accessibility: {
      keyboardNavigation: true,
      screenReaderDescriptions: {
        'uni_entrance': 'The brick admissions entrance pathway leading towards the main grass quad. Information hotspot on the left.',
        'uni_quad': 'The main central grassy quad surrounded by departmental halls and admission office doors.'
      },
      highContrastMode: false,
      audioDescriptions: false
    },
    analytics: {
      visits: Math.floor(Math.random() * 2500) + 500,
      averageTime: Math.floor(Math.random() * 180) + 60,
      hotspotClicks: {
        'h_uni_1': Math.floor(Math.random() * 800) + 200,
        'h_uni_2': Math.floor(Math.random() * 300) + 50
      },
      sceneViews: {
        'uni_entrance': Math.floor(Math.random() * 2500) + 500,
        'uni_quad': Math.floor(Math.random() * 1800) + 400
      },
      heatmapData: Array.from({ length: 50 }, () => ({
        x: Math.floor(Math.random() * 100),
        y: Math.floor(Math.random() * 100),
        count: Math.floor(Math.random() * 50) + 1
      }))
    },
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
    updatedAt: new Date().toISOString()
  };
}
