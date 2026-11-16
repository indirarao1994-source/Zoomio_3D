# Developer Architecture & API Guide - Zoomio

Welcome to the Developer Documentation for **Zoomio**. This guide details the software architecture, visual algorithms, simulated AI agent mesh, and deployment scripts.

---

## 1. System Architecture

Zoomio utilizes a modern full-stack monorepo layout:
- **Frontend App (Vite + React + TypeScript + Tailwind)**: Renders a highly responsive dashboard, wizard, and Three.js-based tour editor.
- **Backend API (Node.js + Express + Multer + TypeScript)**: Persists metadata config records and parses local panorama uploads.
- **Offline ZIP Exporter (JSZip)**: Translates active project details and maps image URIs into relative assets inside a client-compiled offline ZIP bundle.

```
+-------------------------------------------------------+
|                 Zoomio UI                       |
|  (Dashboard / Creator Wizard / Studio Editor Canvas)  |
+---------------------------+---------------------------+
                            | (HTTP Requests)
                            v
+---------------------------+---------------------------+
|              Node/Express Backend API                 |
|    - File Upload Parser      - JSON/SQLite Storage    |
|    - ZIP Export Builder      - Simulated AI Agents    |
+-------------------------------------------------------+
```

---

## 2. 360 Viewer Spherical Mathematics

To display panoramic textures, the application projects equirectangular images onto an inverted sphere. Camera direction is adjusted using Spherical polar coordinates (Yaw, Pitch):

### Spherical to 3D Coordinates Converter
To position 3D hotspots relative to the camera vector, the system maps yaw (\(\theta\)) and pitch (\(\phi\)) using:
\[x = R \cdot \sin(\phi) \cdot \cos(\theta)\]
\[y = R \cdot \cos(\phi)\]
\[z = R \cdot \sin(\phi) \cdot \sin(\theta)\]
*Where \(R\) represents the radius of the sphere (e.g., 500 units).*

### Projection of 3D points onto 2D viewports
To align interactive HTML DOM markers on top of the WebGL canvas, we project the 3D coordinate vector through the camera's viewing frustum:
```typescript
const vector = new THREE.Vector3(x, y, z);
vector.project(camera);

// Calculate screen coordinates (relative to viewport bounding box)
const screenX = (vector.x * 0.5 + 0.5) * window.innerWidth;
const screenY = (-(vector.y * 0.5) + 0.5) * window.innerHeight;
```

---

## 3. Simulated AI Agents Mesh

Zoomio coordinates a simulated agent mesh to automate tour layouts:
1. **Image Validator**: Assesses equirectangular dimensions (2:1 check).
2. **Metadata Extractor**: Reads camera exif tags, timestamps, and GPS landmarks.
3. **Image Quality Inspector**: Inspects blur coefficients, exposure limits, and contrast levels.
4. **Scene Relationship Detector**: Identifies visual boundaries.
5. **Navigation Graph Generator**: Formulates optimal walk edges using coordinate matrices.
6. **Hotspot Recommender**: Recommends guidance arrow nodes placement.
7. **Accessibility Agent**: Confirms sequential keyboard indexes.
8. **Optimization Agent**: Recommends compression parameters.
9. **SEO Generator**: Autocompiles crawler index descriptions.
10. **Deployment Agent**: Verifies build files prior to export.

```
[Validator] ---> [Quality Inspector] ---> [Relationship Detector]
                                                 |
                                                 v
[Hotspot Recommender] <----------------- [Graph Generator]
```

---

## 4. REST API Documentation

### Projects
- `GET /api/projects`: Retrieves all stored projects.
- `GET /api/projects/:id`: Retrieves a single project config file.
- `POST /api/projects`: Stores a new project config metadata.
- `PUT /api/projects/:id`: Modifies an existing project state.
- `DELETE /api/projects/:id`: Purges a project record.

### Media & Bundles
- `POST /api/upload`: Multer parser uploading file elements into `/uploads`. Returns url paths.
- `POST /api/export/:projectId`: Server-side fallback packager converting database assets into ZIP download packets.
