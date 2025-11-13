MVP Default Parameters

Coordinate reference system
- Computations in local UTM zone chosen from AOI centroid.
- Display/export geometries also stored in WGS84 (EPSG:4326).
- Units: meters and percent for all measurements.

Terrain and grid
- Primary elevation source: Mapbox Terrain‑RGB tiles.
- Target grid resolution: 10 m for AOI area ≤ 10 km²; auto-coarsen to 20 m for larger AOIs.
- Maximum raster size: 12 million cells (reduce resolution further if exceeded).
- DEM decoding: elevation_m = -10000 + (R*256*256 + G*256 + B) * 0.1.

Upload expectations
- Inputs: KMZ/KML containing property boundary polygon; optional entry point(s) and exclusion polygons.
- Maximum upload size: 50 MB.
- If no entry point provided, user selects one on the map before running layout generation.

Asset catalogue
- Substation pad
  - Footprint: 120 m × 120 m rectangle.
  - Max slope: 5%.
  - Property setback: ≥ 100 m from boundary.
  - Spacing to other assets: ≥ 150 m.
- O&M building
  - Footprint: 40 m × 20 m rectangle.
  - Max slope: 5%.
  - Property setback: ≥ 50 m.
  - Spacing to other assets: ≥ 50 m.
- Laydown yard
  - Footprint: 80 m × 60 m rectangle.
  - Max slope: 6%.
  - Property setback: ≥ 75 m.
  - Spacing to other assets: ≥ 50 m.
- Equipment pad (generic)
  - Footprint: 50 m × 50 m square.
  - Max slope: 6%.
  - Property setback: ≥ 75 m.
  - Spacing to other assets: ≥ 75 m.

Placement workflow
- Feasible mask = AOI ∧ slope threshold ∧ property setback ∧ user exclusions.
- Contiguous feasible patches must exceed footprint area + 10 m buffer margin on all sides.
- Candidate orientations: 0°, 45°, 90°; choose best by minimizing average slope and cut/fill estimate.

Road routing
- Road width: 8 m (corridor buffered 4 m each side of centerline).
- Maximum grade: 10%.
- Desired turning radius at junctions: ≥ 25 m.
- Friction cost baseline: cost(cell) = 1 + k * slope_percent² with k tuned so 10% slope costs ~5× baseline.
- Steep slopes (>18%) treated as impassable.
- Multi-asset routing: connect entry to highest-priority asset first, then incrementally connect remaining assets to nearest existing road node via A*.

Cut/fill estimation
- Pads: design surface flattened to 0–2% slope toward nearest drainage edge; elevation set to median DEM value within footprint.
- Roads: centerline profile adjusted to obey max grade; corridor elevation interpolated from profile.
- Soil factors: cut swell factor 1.10; fill compaction factor 0.95.
- Report per asset, per road segment, and totals (cut, fill, net, borrow/waste).
- Accuracy goal: ±15–25% vs survey-grade analysis.

Exports
- GeoJSON: WGS84 coordinates, metric properties (areas, lengths, volumes).
- KMZ: KML converted from GeoJSON with simple style cues (distinct colors per layer).
- PDF: Includes parameter summary, key metrics, and Mapbox Static map snapshots.

Caching and storage
- Terrain cache: on-disk LRU in `data/terrain-cache` keyed by z/x/y.
- Run artifacts: stored under `data/runs/<runId>/` with inputs, masks, outputs, and manifest JSON.

Operational bounds
- Target run time: ≤ 60 s for AOI ≤ 10 km² at 10 m resolution on a modern laptop/server.
- Fallback: prompt user to increase resolution or simplify inputs if pixel cap exceeded or runtime estimates surpass 2 minutes.

