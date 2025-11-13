MVP+ Site Layouts — Implementation Plan (TypeScript, Hono, Mapbox)

Decision summary and assumptions
- Runtime: Node 20+ with Hono (Node adapter) and TypeScript.
- Map/DEM: Mapbox GL JS in the browser; Mapbox Terrain‑RGB tiles for DEM.
- Units/CRS: Metric (meters, percent). Computations in local UTM; exports also in WGS84. No US‑customary in MVP.
- Inputs: User uploads KML/KMZ containing at minimum a property boundary polygon. Optional: entry point(s) and exclusion polygons. If no entry point is provided, UI requires the user to click/select an entry on the map.
- Exclusions: User‑supplied only (no auto regulatory datasets in MVP).
- Assets in scope (MVP): substation pad, O&M building, laydown yard, generic equipment pad(s).
- Roads: One ingress/egress route connecting the property entry to each placed asset, via least‑cost path on a slope‑based friction surface.
- Cut/fill accuracy target: ±15–25% vs survey‑grade; appropriate for go/no‑go.
- Data retention: Persist uploads and outputs on disk indefinitely for the demo. Per‑run folder with a run manifest (JSON) and reproducibility config.
- Performance targets: Typical AOI ≤10 km²; 10 m grid. Runtime < ~60 seconds per site on a modern laptop/server. Auto‑coarsen to 20 m for larger AOIs.

High‑level architecture
- Frontend (React + Mapbox GL):
  - Upload KMZ/KML; parameter panel; map layers for AOI, masks, assets, roads, and cut/fill.
  - Run orchestration: start/cancel; progress UI via SSE/polling.
  - Exports: download GeoJSON/KMZ/PDF.
- Backend (Hono on Node):
  - Endpoints for ingest, terrain fetch/DEM decode, constraints, placement, routing, volumes, and export.
  - Worker threads for CPU‑intensive raster/vector tasks.
  - File‑system storage for runs; LRU tile cache for Terrain‑RGB.
- Shared core (utilities):
  - CRS helpers (local UTM selection), geometry ops, raster kernels (3×3), typed array utilities, zod schemas, constants.

Data model and file layout (no scaffolding yet)
- Runs
  - Each run gets a unique ID: YYYYMMDD_HHMMSS_<shorthash>.
  - Directory per run: runs/<runId>/
    - inputs/: raw uploads (KMZ/KML) and a normalized GeoJSON.
    - dem/: cached tiles and stitched DEM window (Terrain‑RGB derived raster meta).
    - masks/: slope, AOI, constraints, and combined feasible mask (raster PNG/NPY + GeoJSON footprints as needed).
    - layout/: placed assets (GeoJSON), routing centerlines (LineString), corridor polygons.
    - volumes/: design surface deltas, pad/road volumetrics (JSON + small rasters if needed).
    - exports/: GeoJSON, KMZ, PDF report.
    - run.json: inputs, parameters, timestamps, derived CRS, checksums, final metrics.
- Caches
  - terrain-cache/: Terrain‑RGB tile cache by z/x/y.png with small JSON index; LRU trimming.

API surface (initial)
- POST /api/ingest/upload
  - Accept: KMZ/KML; optional JSON with role hints (e.g., which folder contains boundary).
  - Return: runId, detected layers summary, AOI bbox, chosen CRS (UTM zone).
- POST /api/terrain/fetch
  - Body: { runId }
  - Server: determines AOI bounds in WGS84, computes covering tiles for chosen zoom (≈10 m target after decode), fetches Terrain‑RGB tiles, caches locally, stitches DEM window; returns DEM meta (width, height, resolution) and sample stats (min/max/mean).
- POST /api/constraints/build
  - Body: { runId, params } where params include slope thresholds, buffers/setbacks per asset, property edge setbacks.
  - Return: boolean masks summary (counts of feasible cells), and vectorized feasible regions (optional GeoJSON MultiPolygon for UI overlay).
- POST /api/layout/place
  - Body: { runId, assetDefinitions, params }
  - Return: placed asset footprints (GeoJSON), per‑asset siting scores and reasons for rejection where applicable.
- POST /api/route/compute
  - Body: { runId, params }
  - Return: road centerlines (GeoJSON FeatureCollection); per‑segment grades and flags for smoothing.
- POST /api/volumes/compute
  - Body: { runId, params }
  - Return: volume summary (cut, fill, net, swell/compaction applied); per‑asset and road corridor volumes.
- POST /api/export
  - Body: { runId, formats: ["geojson","kmz","pdf"] }
  - Return: download URLs or blobs.
- GET /api/runs/:runId
  - Return: run manifest (inputs, params, outputs present, status).
- GET /api/runs
  - Return: list of recent runs and statuses for simple persistence UI.

Reasonable defaults (parameters)
- Grid/resolution: 10 m for AOI ≤10 km²; 20 m above that. Snap AOI bbox to DEM pixel grid.
- Assets:
  - substation: 120×120 m, max slope 5%, 100 m setback from property edge, 150 m spacing from other assets.
  - o&m: 40×20 m, max slope 5%, 50 m setback, 50 m spacing.
  - laydown: 80×60 m, max slope 6%, 75 m setback, 50 m spacing.
  - equipment pad: 50×50 m, max slope 6%, 75 m spacing.
- Roads: width 8 m; max grade 10%; turning radius ≥25 m at junctions; friction penalties high above 10% slope.
- Volumes: pads 0–2% target grade; road corridor uses centerline grade with corridor width; swell +10% (cut), compaction 0.95 (fill).

Algorithmic plan
1) CRS and units
   - Determine local UTM zone from AOI centroid (proj4/utm). Keep a proj4 definition for forward/back transforms.
   - All buffering/setbacks use UTM meters. Store WGS84 geometries for display/exports.

2) Terrain‑RGB DEM
   - Tile coverage: compute z/x/y set to cover AOI with zoom chosen to approximate 10 m ground resolution at AOI latitude.
   - Decode per pixel: elevation_m = -10000 + (R*256*256 + G*256 + B) * 0.1.
   - Stitch into a DEM window aligned to AOI bbox; store as typed array Float32 with geotransform.

3) Slope and aspect
   - Use Horn 3×3 kernel for dz/dx, dz/dy; slope = atan(sqrt(gx² + gy²)) in radians; store slope in percent (tan(theta)*100) and degrees.
   - Optionally compute aspect degrees [0,360) if needed for later constraints.

4) Constraints/masks
   - AOI mask: rasterize AOI polygon to the DEM grid; clip other masks to AOI.
   - Slope mask: per asset type threshold (≤5–6%).
   - Setbacks/buffers: buffer property boundary inward (setback) and apply user exclusion geometries; use polygon‑clipping and rasterize.
   - Combined feasible mask: AOI ∧ slope ∧ setbacks ∧ exclusions.

5) Asset placement (grid‑first)
   - Cluster contiguous feasible cells into patches; compute area and flatness score per patch.
   - For each asset, in priority order: find the smallest patch meeting footprint area + margin; place oriented rectangle (test multiple orientations 0/45/90 deg); enforce spacing via rbush index of placed footprints.
   - If no patch fits, record reason (insufficient area, slope, setbacks).

6) Road routing
   - Build friction surface: base cost from slope percent (e.g., cost = 1 + k·slope²; steep slopes penalized), with very steep slopes masked.
   - A* from entry point to each asset centroid; allow sharing segments by seeding multiple targets via a Steiner‑like approach or by routing to nearest existing path.
   - Smooth path: Douglas‑Peucker for plan curvature + elevation‑aware smoothing to respect max grade; enforce turning radius by offsetting corners.
   - Corridorize: buffer centerline by half width (8 m / 2) to polygon for volume and export.

7) Cut/fill volumes
   - Pads: set design elevation to mean (or a quantile) of the patch; slope target 0–2% in a chosen direction; compute delta = design − existing per cell; sum cut (negative), fill (positive); apply swell/compaction to totals.
   - Roads: sample DEM along centerline; adjust elevations to meet max grade (constrained profile); rasterize corridor; compute delta vs existing similarly.
   - Report per asset, per road, and totals (cut, fill, net, borrow/waste).

8) Exports
   - GeoJSON: AOI, exclusions, assets, road centerlines, corridor polygons; properties include CRS used for measurements.
   - KMZ: convert GeoJSON→KML (tokml); zip with jszip; basic styling via per‑layer styles.
   - PDF: HTML template rendered via Puppeteer; includes parameter table, metrics, and map snapshots (Mapbox Static Images API). Cache static images per run.

9) Caching and storage
   - Terrain‑RGB tiles: file cache by z/x/y key; LRU management; short index JSON with hit counts and last access.
   - DEM windows and masks: store small NPY/JSON metadata to avoid recomputation; invalidate on parameter change.
   - Runs: immutable outputs per run; allow “recompute” to produce a new run ID.

10) Validation and error handling
   - Strict upload validation (MIME, size ≤ 50 MB, KML/KMZ only), safe unzip, reject path traversal.
   - Geometry validation: ensure AOI is polygonal and valid; detect missing entry and prompt UI to select.
   - Clear error codes/messages for common failures (tile fetch, invalid geometry, zero feasible area).

11) Observability
   - Structured logs (pino); job spans per runId; timing for each stage.
   - Optional verbose mode for debugging with per‑stage artifacts.

12) Performance tactics
   - Chunk raster ops; stream tiles; use worker_threads for kernels (slope, mask combine, routing).
   - Cap grid size by adapting resolution based on AOI area; hard cap max pixels (e.g., ≤ 12M cells).
   - Use typed arrays and avoid per‑cell object allocations.

Detailed task breakdown

Phase 0 — Project hygiene
0.1 Define Node/TS project standards
  - tsconfig (strict), path aliases, eslint + prettier config.
  - .env management (MAPBOX_ACCESS_TOKEN), config schema with zod.
0.2 Repo layout decision (no scaffolding yet)
  - Option A: single repo with /server (Hono) and /web (Vite React).
  - Option B: single app with Vite + a basic Node server in the same root. Prefer A for clarity.

Phase 1 — Ingestion and CRS
1.1 KMZ/KML upload endpoint (/api/ingest/upload)
  - Implement streaming upload (busboy), size limits, KMZ unzip (jszip).
  - Parse KML to GeoJSON (togeojson + xmldom), detect boundary polygon; optional entry points and exclusions.
  - Validate geometries; write normalized GeoJSON to runs/<id>/inputs/.
1.2 CRS utilities
  - Implement local UTM selection from AOI centroid; expose proj4/proj functions.
  - Implement projections WGS84<->UTM for points/lines/polygons and GeoJSON FeatureCollections.
1.3 AOI raster alignment
  - Compute AOI bbox in WGS84; add small padding (e.g., 1–2 pixels) to fully cover edges.

Phase 2 — Terrain and derived rasters
2.1 Terrain‑RGB tile math
  - Choose zoom level for ≈10 m resolution at latitude; compute z/x/y coverage.
  - Implement tile fetch with retries/backoff; cache to terrain-cache/.
2.2 DEM window assembly
  - Stitch tiles to a single DEM window covering AOI; store as Float32Array + metadata (origin, pixel size).
2.3 Slope/aspect kernel
  - Implement Horn 3×3 kernel; output slope arrays (percent and degrees). Unit tests on synthetic surfaces.

Phase 3 — Constraints and masks
3.1 Rasterize AOI and exclusions to DEM grid
  - Polygon rasterization; fast scanline with bounding boxes; tests.
3.2 Slope threshold masks per asset class
3.3 Property setback mask (inward buffer)
  - Buffer in UTM; rasterize to grid.
3.4 Combined feasible mask
  - AOI ∧ slope ∧ setbacks ∧ exclusions; compute stats and store.

Phase 4 — Asset placement
4.1 Connected components on feasible mask to identify patches
4.2 Patch scoring (area, flatness)
4.3 Footprint fitting
  - Try orientations (0/45/90); ensure margin; choose best by minimal earthwork/slope variance.
4.4 Spacing enforcement with rbush
4.5 Placement output GeoJSON with metadata (scores, constraints satisfied)

Phase 5 — Routing
5.1 Friction surface from slope (parameterized function)
5.2 A* pathfinding on grid
  - Use fastpriorityqueue; diagonal moves allowed with √2 cost; respect masked steep cells.
5.3 Path smoothing and grade enforcement
  - Simplify geometry (Douglas‑Peucker); resample elevations; enforce ≤10% grade by iterative profile adjustments.
5.4 Corridorization to polygon of width 8 m

Phase 6 — Cut/fill
6.1 Pad design surface generation
  - Choose pad elevation (mean/median); set target grade 0–2%.
6.2 Road design profile
  - Centerline elevation profile, constrained by max grade; interpolate across corridor width.
6.3 Volume computation
  - Per cell delta, sum cut/fill, apply swell/compaction; produce JSON summaries.

Phase 7 — Exports
7.1 GeoJSON export (layers with properties and units)
7.2 KML/KMZ export (tokml + jszip)
7.3 PDF export
  - HTML template with parameters, metrics, and Mapbox Static snapshots for maps.

Phase 8 — Frontend (React + Mapbox)
8.1 App shell
  - Layout with side panel, top bar, map canvas.
8.2 Upload flow and parameter forms
  - Inputs for slope thresholds, setbacks, road width/grade, resolution cap, soil factors.
8.3 Map layers
  - AOI, slope (raster styled via hillshade/contours optional), feasible mask, assets, roads, corridor.
8.4 Run control and progress
  - Start/stop; live status via polling/SSE; toasts for errors.
8.5 Export actions
  - Download KMZ/GeoJSON/PDF; show summary stats table.

Phase 9 — Persistence, caching, ops
9.1 Tile cache with LRU bounds (max size, TTL optional)
9.2 Run manifest and cleanup utilities (manual purge UI/action)
9.3 Logging (pino) and basic metrics (timings)

Phase 10 — Quality
10.1 Unit tests
  - DEM decode, slope kernel, rasterization, A*, corridorization, volumes on synthetic fixtures.
10.2 Integration tests
  - End‑to‑end run on small synthetic AOI; verify placement, routing, volumes within tolerances.
10.3 UX QA
  - Parameter edge cases; empty AOI; missing entry; no feasible area.

Acceptance criteria (MVP)
- Upload a property boundary; select entry; set parameters; click “Generate”.
- The system returns placed assets, a routed road network, and cut/fill totals within 60 seconds for a ≤10 km² AOI at 10 m resolution.
- Users can toggle masks and layers, adjust parameters, and re‑run.
- Exports: valid GeoJSON, KMZ viewable in Google Earth, and a PDF report with maps and metrics.
- Run artifacts are persisted on disk and re‑loadable.

Milestones
- M1: Ingest + CRS + DEM decode + slope (Phases 1–2)
- M2: Constraints/masks + placement (Phase 3–4)
- M3: Routing + corridorization (Phase 5)
- M4: Volumes + exports (Phase 6–7)
- M5: Frontend polish + persistence + tests (Phases 8–10)

Risks and mitigations
- Large AOIs blow up memory/time → adaptive resolution and hard pixel caps; chunked processing.
- Terrain‑RGB gaps or API limits → robust retries, progress UI, local caching; allow providing local DEM GeoTIFF later.
- KML idiosyncrasies → strict parsing and validation; simple heuristics + user corrections in UI.
- PDF map snapshots complexity → prefer Mapbox Static Images API; avoid server‑side map rendering.

Post‑MVP backlog (P1/P2 from PRD)
- Multi‑entry routing and shared road optimization.
- Environmental/regulatory layers (FEMA, NWI) as optional overlays.
- Alternative assets (solar/wind arrays) with packing heuristics.
- Improved road vertical design with horizontal geometry and superelevation checks.
- Higher‑fidelity DEMs (GeoTIFF/LiDAR) and TIN‑based volumes.

Parameter catalog (initial)
- General: gridResolutionMode(auto/fixed), maxPixels, swellFactor(1.10), compactionFactor(0.95)
- Slope thresholds: substation(≤5%), o&m(≤5%), laydown(≤6%), equip(≤6%)
- Setbacks: property(100 m substation, 50 m o&m, 75 m laydown/equip); asset spacing(150 m substation, etc.)
- Roads: width(8 m), maxGrade(10%), turnRadius(≥25 m)

Environment variables
- MAPBOX_ACCESS_TOKEN: required (frontend and backend)
- PORT: backend port (default 8787)
- DATA_DIR: base directory for runs and cache (default ./data)

