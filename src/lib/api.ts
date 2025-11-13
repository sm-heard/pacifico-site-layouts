import { z } from 'zod'

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8787'

const ingestSchema = z.object({
  runId: z.string(),
  boundaryAreaSqMeters: z.number(),
  boundaryBbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  entryPointsCount: z.number(),
  exclusionsCount: z.number(),
  projection: z.any(),
  grid: z.object({
    resolution: z.number(),
    width: z.number(),
    height: z.number(),
    pixelCount: z.number(),
    extentWgs84: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
  hasEntryPoint: z.boolean(),
  notes: z.string().optional(),
  source: z.object({
    filename: z.string().nullable().optional(),
    mimeType: z.string().nullable().optional(),
    type: z.union([z.literal('kml'), z.literal('kmz')]),
  }),
})

const terrainSchema = z.object({
  runId: z.string(),
  demPath: z.string(),
  metadataPath: z.string(),
  zoom: z.number(),
  tileCount: z.number(),
  resolutionMeters: z.number(),
  stats: z.object({
    min: z.number(),
    max: z.number(),
    mean: z.number(),
    validCells: z.number(),
    missingCells: z.number(),
  }),
  slope: z.object({
    minDegrees: z.number(),
    maxDegrees: z.number(),
    meanDegrees: z.number(),
  }),
})

const constraintsSchema = z.object({
  runId: z.string(),
  baseMaskPath: z.string(),
  distancePath: z.string(),
  baseFeasibleCells: z.number(),
  baseFeasibleAreaSqMeters: z.number(),
  assetMasks: z.array(
    z.object({
      assetId: z.string(),
      path: z.string(),
      feasibleCells: z.number(),
      feasibleAreaSqMeters: z.number(),
    }),
  ),
  maxDistanceMeters: z.number(),
})

const layoutSchema = z.object({
  runId: z.string(),
  features: z.any(),
  placedAssets: z.array(
    z.object({
      assetType: z.string(),
      footprint: z.object({ widthMeters: z.number(), heightMeters: z.number() }),
      polygon: z.any(),
      center: z.object({
        local: z.tuple([z.number(), z.number()]),
        wgs84: z.tuple([z.number(), z.number()]),
        row: z.number(),
        col: z.number(),
      }),
      slopeMeanPercent: z.number(),
    }),
  ),
  skippedAssets: z.array(z.object({ assetType: z.string(), reason: z.string() })),
  layoutPath: z.string(),
})

const roadSegmentSchema = z.object({
  assetType: z.string(),
  line: z.any(),
  corridor: z.any(),
  lengthMeters: z.number(),
  maxGradePercent: z.number(),
  meanGradePercent: z.number(),
  cost: z.number(),
})

const roadsSchema = z.object({
  runId: z.string(),
  segments: z.array(roadSegmentSchema),
  totalLengthMeters: z.number(),
  corridorsPath: z.string(),
  centerlinesPath: z.string(),
})

const constraintsOverviewSchema = z.object({
  runId: z.string(),
  grid: z.object({
    width: z.number(),
    height: z.number(),
    resolution: z.number(),
    extentWgs84: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
  boundary: z.any().nullable(),
  exclusions: z.array(z.any()),
  entryPoints: z.array(z.any()),
  baseMaskDataUrl: z.string(),
  distanceMaskDataUrl: z.string(),
})

const runManifestSchema = z.object({
  runId: z.string(),
  manifest: z
    .object({
      inputs: z
        .object({
          normalizedGeoJsonPath: z.string().optional(),
        })
        .optional(),
      constraints: z
        .object({
          baseMaskPath: z.string().optional(),
          distanceMaskPath: z.string().optional(),
          baseMaskPngPath: z.string().optional(),
          distanceMaskPngPath: z.string().optional(),
        })
        .optional(),
      layout: z
        .object({
          assetsGeoJsonPath: z.string().optional(),
        })
        .optional(),
      roads: z
        .object({
          centerlinesPath: z.string().optional(),
          corridorsPath: z.string().optional(),
        })
        .optional(),
      parameters: z.record(z.any()).optional(),
    })
    .passthrough(),
})

export type IngestResponse = z.infer<typeof ingestSchema>
export type TerrainResponse = z.infer<typeof terrainSchema>
export type ConstraintsResponse = z.infer<typeof constraintsSchema>
export type LayoutResponse = z.infer<typeof layoutSchema>
export type RoadsResponse = z.infer<typeof roadsSchema>
export type ConstraintsOverviewResponse = z.infer<typeof constraintsOverviewSchema>
export type RunManifestResponse = z.infer<typeof runManifestSchema>['manifest']

export interface ConstraintParams {
  maxSlopePercent?: number
  propertySetbackMeters?: number
}

export interface LayoutParams {
  maxSlopePercent?: number
}

export interface RoadParams {
  widthMeters?: number
  maxGradePercent?: number
}

async function handleResponse<T>(response: Response, schema: z.ZodSchema<T>): Promise<T> {
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText)
    throw new Error(message || `Request failed with status ${response.status}`)
  }
  const json = await response.json()
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    console.error('API validation failed', parsed.error, json)
    throw new Error('Received unexpected data from server')
  }
  return parsed.data
}

export async function uploadSite(file: File): Promise<IngestResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${baseUrl}/api/ingest/upload`, {
    method: 'POST',
    body: formData,
  })
  return handleResponse(response, ingestSchema)
}

export async function fetchTerrain(runId: string): Promise<TerrainResponse> {
  const response = await fetch(`${baseUrl}/api/terrain/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId }),
  })
  return handleResponse(response, terrainSchema)
}

export async function rebuildTerrain(runId: string): Promise<TerrainResponse> {
  return fetchTerrain(runId)
}

export async function buildConstraints(
  runId: string,
  params?: ConstraintParams,
): Promise<ConstraintsResponse> {
  const response = await fetch(`${baseUrl}/api/constraints/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      params && Object.keys(params).length > 0 ? { runId, params } : { runId },
    ),
  })
  return handleResponse(response, constraintsSchema)
}

export async function fetchConstraintsOverview(runId: string): Promise<ConstraintsOverviewResponse> {
  const response = await fetch(`${baseUrl}/api/constraints/${runId}/overview`)
  return handleResponse(response, constraintsOverviewSchema)
}

export async function fetchRunManifest(runId: string): Promise<z.infer<typeof runManifestSchema>> {
  const response = await fetch(`${baseUrl}/api/runs/${runId}/manifest`)
  return handleResponse(response, runManifestSchema)
}

export async function placeAssets(
  runId: string,
  params?: LayoutParams,
): Promise<LayoutResponse> {
  const response = await fetch(`${baseUrl}/api/layout/place`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      params && Object.keys(params).length > 0 ? { runId, params } : { runId },
    ),
  })
  return handleResponse(response, layoutSchema)
}

export async function rebuildLayout(runId: string, params?: LayoutParams): Promise<LayoutResponse> {
  return placeAssets(runId, params)
}

export async function buildRoads(
  runId: string,
  params?: RoadParams,
): Promise<RoadsResponse> {
  const response = await fetch(`${baseUrl}/api/roads/build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      params && Object.keys(params).length > 0 ? { runId, params } : { runId },
    ),
  })
  return handleResponse(response, roadsSchema)
}

export async function rebuildRoads(runId: string, params?: RoadParams): Promise<RoadsResponse> {
  return buildRoads(runId, params)
}

export type PipelineStage =
  | 'idle'
  | 'upload'
  | 'terrain'
  | 'constraints'
  | 'layout'
  | 'roads'
  | 'complete'

export interface PipelineResult {
  ingest?: IngestResponse
  terrain?: TerrainResponse
  constraints?: ConstraintsResponse
  layout?: LayoutResponse
  roads?: RoadsResponse
}

export async function runPipeline(
  file: File,
  onStage?: (stage: PipelineStage) => void,
): Promise<PipelineResult> {
  onStage?.('upload')
  const ingest = await uploadSite(file)
  const runId = ingest.runId

  onStage?.('terrain')
  const terrain = await fetchTerrain(runId)

  onStage?.('constraints')
  const constraints = await buildConstraints(runId)

  onStage?.('layout')
  const layout = await placeAssets(runId)

  onStage?.('roads')
  const roads = await buildRoads(runId)

  onStage?.('complete')
  return { ingest, terrain, constraints, layout, roads }
}
