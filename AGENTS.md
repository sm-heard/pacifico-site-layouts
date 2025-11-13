# Repository Guidelines

## Project Structure & Module Organization
- `./` – Vite React 18 frontend (TypeScript) with Mapbox GL and shadcn/ui.
- `./server/` – Hono (Node adapter) API in TypeScript; heavy geospatial and report logic lives here.
- `./data/` – Persisted run artifacts and the Terrain‑RGB tile cache (keep out of VCS).
- `docs/` – Planning aides (`plan.md`, `SETUP.md`, `parameters.md`). Add new reference material here.
- Tests mirror source layout: e.g., `src/components/__tests__` and `server/src/__tests__`.

## Build, Test, and Development Commands
- Frontend dev server: `npm run dev` (Vite on port 5173).
- Frontend build: `npm run build` → outputs to `dist/`.
- Frontend tests: `npm run test` (Vitest + React Testing Library).
- Backend dev: in `server/`, `npm run dev` (tsx executes `src/index.ts`).
- Backend start: `npm run start` (node on compiled output or tsx; keep scripts aligned).
- Backend tests: `npm run test` (Vitest; add integration fixtures under `server/test-data/`).

## Coding Style & Naming Conventions
- TypeScript everywhere; use ES modules and `async/await`.
- Prettier + ESLint (`@typescript-eslint`) enforce 2‑space indentation, single quotes, trailing commas.
- Components: `PascalCase`; hooks/utilities: `camelCase`; constants: `UPPER_SNAKE_CASE`.
- Keep files small and cohesive: UI in `src/features/<feature>`; backend modules in `server/src/modules/<domain>`.
- Tailwind classes follow shadcn conventions; keep custom styles in `src/styles`.

## Testing Guidelines
- Unit tests co‑locate with code in `__tests__` folders; filenames `*.spec.ts(x)`.
- Frontend: cover rendering, interactions, and Mapbox layer toggles via Vitest + RTL.
- Backend: mock Mapbox fetches; verify mask, routing, and volume outputs against synthetic fixtures.
- Aim for ≥80% coverage on core modules (constraints, routing, volumes). Run tests before pushing.

## Commit & Pull Request Guidelines
- Commits: imperative mood, scoped prefixes encouraged (e.g., `feat:`, `fix:`, `chore:`). Keep commits focused and include rationale in the body if non-obvious.
- Pull requests: describe the change, link planning task or issue, enumerate test results, and attach screenshots/gifs for UI tweaks.
- Do not commit `data/` artifacts, `.env*`, or Chromium binaries. Add new env vars to `.env.example` with explanations.

## Security & Configuration Tips
- Store `MAPBOX_ACCESS_TOKEN` in `.env`; never hard-code or commit tokens.
- Validate uploads carefully (KMZ/KML only, ≤50 MB). Sanitise paths when unzipping.
- Long-running raster tasks should use `worker_threads` to keep the API responsive.
