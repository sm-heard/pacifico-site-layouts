# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a geospatial site layout application for designing solar farm infrastructure. The frontend is a React + TypeScript + Vite app with Mapbox GL for visualization and shadcn/ui components. The backend is a Hono API (Node adapter) that handles heavy geospatial computations including terrain analysis, asset placement, road routing, and cut/fill volume calculations.

## Architecture

### Frontend Structure
- **Entry**: `src/main.tsx` → `src/App.tsx`
- **UI Components**: `src/components/ui/` contains shadcn components (Button, Input, Select, Dialog, etc.)
- **Utilities**: `src/lib/utils.ts` provides utility functions including `cn()` for class merging
- **Styling**: Tailwind CSS v4 with shadcn conventions; custom styles in `src/index.css`
- **Path Aliases**: `@/` maps to `./src/` for cleaner imports

### Backend Structure
- **Entry**: `server/src/index.ts` (Hono app served via @hono/node-server)
- **Expected modules** (as project grows):
  - `server/src/modules/terrain/` — DEM fetching, Terrain-RGB decoding, caching
  - `server/src/modules/constraints/` — Slope analysis, setback masks, exclusion zones
  - `server/src/modules/placement/` — Asset placement logic with orientation optimization
  - `server/src/modules/routing/` — A* pathfinding, multi-asset road network generation
  - `server/src/modules/volumes/` — Cut/fill estimation for pads and roads
  - `server/src/modules/export/` — GeoJSON, KMZ, PDF report generation

### Data Management
- **Storage**: `data/` directory at repo root (excluded from VCS)
  - `data/terrain-cache/` — LRU cache of Mapbox Terrain-RGB tiles (z/x/y structure)
  - `data/runs/<runId>/` — Per-run artifacts: inputs, masks, outputs, manifest.json
- **Coordinate Systems**: Computations in local UTM (auto-selected from AOI centroid); display/export in WGS84 (EPSG:4326)

## Development Commands

### Frontend (run from repo root)
- `npm run dev` — Start Vite dev server on port 5173
- `npm run build` — Type-check with `tsc -b` then build for production to `dist/`
- `npm run lint` — Run ESLint on all files
- `npm run preview` — Preview production build locally
- `npm run test` — Run Vitest tests with React Testing Library (when tests exist)

### Backend (run from `server/` directory)
- `npm run dev` — Start Hono dev server with tsx watch on port 8787 (default)
- `npm run build` — Compile TypeScript to `server/dist/`
- `npm run start` — Run compiled Node.js server from `dist/index.js`
- `npm run test` — Run Vitest tests (when configured)

## Environment Variables

### Frontend (`.env` at repo root)
- `VITE_MAPBOX_TOKEN` — Mapbox access token with URL restrictions for localhost:5173
- `VITE_API_BASE_URL` — Backend API URL (default: `http://localhost:8787`)

### Backend (`server/.env`)
- `MAPBOX_ACCESS_TOKEN` — Mapbox token for server-side Terrain-RGB fetching
- `PORT` — Server port (default: 8787)
- `DATA_DIR` — Path to data directory (default: `../data`)

**Note**: Never commit `.env` files. Update `.env.example` files when adding new variables.

## Key Technical Details

### Asset Catalogue & Constraints
See `parameters.md` for complete specifications. Key assets:
- **Substation pad**: 120m × 120m, max 5% slope, 100m property setback
- **O&M building**: 40m × 20m, max 5% slope, 50m property setback
- **Laydown yard**: 80m × 60m, max 6% slope, 75m property setback
- **Equipment pad**: 50m × 50m, max 6% slope, 75m property setback

### Geospatial Processing
- **Terrain source**: Mapbox Terrain-RGB tiles at zoom ~17 (≈10m resolution)
- **Grid resolution**: 10m for AOI ≤10 km²; auto-coarsen to 20m for larger areas
- **Max raster size**: 12 million cells
- **DEM decoding**: `elevation_m = -10000 + (R×256² + G×256 + B) × 0.1`

### Road Routing
- **Width**: 8m corridor (4m buffer each side of centerline)
- **Max grade**: 10%; slopes >18% impassable
- **Friction cost**: `cost = 1 + k × slope²` (k tuned so 10% slope ≈5× baseline)
- **Algorithm**: Multi-asset A* pathfinding connecting entry point to all assets

### Cut/Fill Estimation
- **Pads**: Flattened to 0–2% slope; elevation = median DEM within footprint
- **Roads**: Centerline profile adjusted to obey max grade; corridor interpolated from profile
- **Soil factors**: Cut swell 1.10; fill compaction 0.95
- **Accuracy**: Target ±15–25% vs survey-grade analysis

### Upload Requirements
- **Formats**: KMZ/KML only
- **Max size**: 50 MB
- **Contents**: Property boundary polygon (required); optional entry points and exclusion polygons
- **Validation**: Sanitize paths when unzipping; validate geometry types

## Code Style

### TypeScript
- ES modules everywhere (`type: "module"` in package.json)
- Strict TypeScript; use `async/await` for async operations
- Prefer explicit types for function parameters and returns
- Use Zod for runtime validation (frontend forms and backend API inputs)

### React Conventions
- Functional components with hooks
- Component files: PascalCase (e.g., `AssetPlacement.tsx`)
- Hooks/utilities: camelCase (e.g., `useMapbox.ts`)
- Constants: UPPER_SNAKE_CASE
- Keep components small and focused; extract reusable logic into custom hooks

### Styling
- Tailwind utility classes following shadcn patterns
- Use `cn()` utility from `@/lib/utils` to merge classes conditionally
- Radix UI primitives via shadcn for accessible components

### Testing
- Unit tests co-locate in `__tests__` directories
- Filename pattern: `*.spec.ts` or `*.spec.tsx`
- Frontend: Vitest + React Testing Library
- Backend: Vitest with mocked Mapbox fetches and synthetic fixtures in `server/test-data/`
- Target ≥80% coverage on core geospatial modules

## Performance Considerations

- **Long-running tasks**: Use `worker_threads` for heavy raster operations to avoid blocking the event loop
- **Target runtime**: ≤60s for AOI ≤10 km² at 10m resolution
- **Tile caching**: LRU disk cache prevents redundant Mapbox fetches
- **Memory**: Monitor raster memory usage; prompt user to increase resolution if exceeding limits

## Security & Best Practices

- **Secrets**: Never commit tokens/keys; store in `.env` files only
- **Upload validation**:
  - Enforce KMZ/KML format and 50 MB limit
  - Sanitize file paths during extraction
  - Validate geometry types and coordinates
- **CORS**: Backend allows `http://localhost:5173` for development
- **Input validation**: Use Zod schemas on both frontend forms and backend API endpoints
- **Error handling**: Log errors with Pino; return user-friendly messages via API

## Common Development Workflows

### Adding a new shadcn component
```bash
npx shadcn@latest add <component-name>
```

### Running frontend and backend concurrently
Terminal 1 (repo root):
```bash
npm run dev
```

Terminal 2 (server directory):
```bash
cd server && npm run dev
```

### Adding a new backend route module
1. Create module in `server/src/modules/<domain>/`
2. Export route handlers using Hono's routing
3. Import and mount in `server/src/index.ts`
4. Add tests in `server/src/modules/<domain>/__tests__/`

### Handling Mapbox interactions
- Frontend: Initialize map in component with `mapbox-gl` using `VITE_MAPBOX_TOKEN`
- Backend: Fetch Terrain-RGB tiles via `undici` using `MAPBOX_ACCESS_TOKEN`
- Cache tiles on backend to minimize API usage
- Respect Mapbox rate limits and terms of service

## References

- **Setup details**: See `SETUP.md` for environment setup checklist
- **Default parameters**: See `parameters.md` for asset specs and algorithm defaults
- **Coding guidelines**: See `AGENTS.md` for module organization and commit conventions
- **Mapbox GL JS**: https://docs.mapbox.com/mapbox-gl-js/
- **Hono docs**: https://hono.dev/
- **shadcn/ui**: https://ui.shadcn.com/
- **Turf.js**: https://turfjs.org/ (used for geospatial calculations on both frontend and backend)
