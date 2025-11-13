Setup Checklist — Vite (React) + Hono (Node) + Mapbox

Repo structure (recommended)
- Keep your existing Vite app at the repo root (or in `web/`).
- Create a sibling backend folder `server/` for Hono.
- Add a shared data directory `data/` at the repo root for runs and cache.

Example
- `./`  ← Vite app (already created with `npm create vite@latest`)
- `./server/`  ← Hono on Node (TypeScript, ESM)
- `./data/`  ← persisted runs and Terrain‑RGB tile cache

Prereqs
- Node 20+ installed.
- A Mapbox access token with URL restrictions (include `http://localhost:5173`).

Frontend (Vite app) setup
1) Install packages (run in the Vite app root)
   - `npm i react react-dom mapbox-gl zod @turf/turf`
   - `npm i -D tailwindcss postcss autoprefixer`
   - `npx tailwindcss init -p`
2) shadcn/ui
   - `npx shadcn@latest init`
   - Components to add (as needed):
     - `npx shadcn@latest add button input select slider switch dialog progress sonner`
     - Optionals: `checkbox label form dropdown-menu tabs tooltip textarea card table separator scroll-area`
   - Note: You already added `sonner` (toast replacement). Mount the Sonner provider once.
3) Mapbox GL CSS
   - Ensure the Mapbox GL CSS is included in your app entry.
4) Env file
- Copy `./.env.example` to `./.env` (or `./.env.local`) and fill in values.
5) CORS (client side)
   - The frontend will call the backend at `VITE_API_BASE_URL`.

Backend (Hono on Node) setup
1) Scaffold server (in repo root)
   - `mkdir server && cd server`
   - `npm create hono@latest` → choose: Template “node”, Language “TypeScript”, Module format “ESM”, no Docker.
2) Install packages (run in `server/`)
   - Runtime/core: `npm i hono pino pino-pretty zod undici`
   - Upload/parsing: `npm i busboy jszip @tmcw/togeojson xmldom fast-xml-parser`
   - Geometry/CRS: `npm i @turf/turf polygon-clipping proj4 utm rbush fastpriorityqueue`
   - Export/reporting: `npm i tokml puppeteer lru-cache`
   - Dev/build: `npm i -D typescript tsx @types/node @types/geojson`
-3) Env file
- Copy `server/.env.example` to `server/.env` and fill in values:
     - `MAPBOX_ACCESS_TOKEN=your_token`
     - `PORT=8787`
     - `DATA_DIR=../data` (or leave default `./data` inside `server/`)
4) Scripts (package.json)
   - Add a `dev` script using `tsx` to run your entry (e.g., `src/index.ts`).
5) CORS (server side)
   - Allow origin `http://localhost:5173` for development (and any additional dev origins).

Data and caching
- Create `./data/terrain-cache/` for Terrain‑RGB tiles (server will manage LRU).
- Per‑run outputs under `./data/runs/<runId>/` with inputs, intermediate rasters, and exports.

Network and Mapbox usage
- Default to a zoom approximating ~10 m ground resolution for Terrain‑RGB tiles.
- Cache tiles on disk; fetch only tiles overlapping the AOI bounding box.
- Keep this a demo: avoid tile overfetching; respect Mapbox rate limits.

Development workflow
- Frontend: `npm run dev` (Vite) in the Vite app directory.
- Backend: `npm run dev` (Hono via tsx) in `server/`.
- Configure the frontend to point to `VITE_API_BASE_URL` (default `http://localhost:8787`).
- Backend tests: in `server/`, run `npm run test` (Vitest) for integration coverage using synthetic fixtures.

Smoke test (no code changes required)
1) Start backend (`server/`): verify it listens on `:8787` and has a health route.
2) Start frontend (Vite): ensure Mapbox map loads using `VITE_MAPBOX_TOKEN`.
3) Confirm browser requests to `:8787` succeed (check CORS headers).

Operational notes
- Puppeteer downloads Chromium (~100–150 MB). If that’s too heavy for the demo, switch to a lighter PDF path later (e.g., `pdfkit`).
- Keep long‑running raster tasks off the event loop using `worker_threads`.
- Limit uploads to KML/KMZ and ≤50 MB; require user to click an entry point if missing.

Optional next steps (still no code)
- Add a `docs/parameters.md` to document defaults (grid size, slopes, setbacks) so the UI mirrors config.
- Add an `.env.example` at repo root and in `server/` for safer onboarding.
- Decide whether to keep the Vite app at repo root or move it to `web/`; both are fine.
