import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { env } from '../config/env.js'
import { logger } from './logger.js'
import type { RunMetadata } from '../types/run.js'
import type { FeatureCollection } from 'geojson'

const RUN_DIRECTORIES = ['inputs', 'dem', 'masks', 'layout', 'volumes', 'exports']

export interface RunManifest {
  id: string
  createdAt: string
  status: 'pending' | 'ready' | 'failed'
  notes?: string
  inputs?: {
    originalFilename?: string
    normalizedGeoJsonPath?: string
    boundaryAreaSqMeters?: number
    entryPointsCount?: number
    exclusionsCount?: number
  }
  parameters?: Record<string, unknown>
  terrain?: {
    demPath: string
    metadataPath: string
    slopeDegreesPath?: string
    slopePercentPath?: string
    aspectDegreesPath?: string
    zoom: number
    tileCount: number
    resolutionMeters: number
    minElevation: number
    maxElevation: number
    meanElevation: number
    missingCells: number
    validCells: number
    slopeMinDegrees?: number
    slopeMaxDegrees?: number
    slopeMeanDegrees?: number
  }
  constraints?: {
    baseMaskPath: string
    distanceMaskPath: string
    assetMasks: Record<string, {
      path: string
      feasibleCells: number
    }>
    baseFeasibleCells: number
  }
  layout?: {
    assetsGeoJsonPath: string
    placed: Array<{
      assetType: string
      centerWgs84: [number, number]
      centerLocal: [number, number]
      centerRow: number
      centerCol: number
      slopeMeanPercent: number
      widthMeters: number
      heightMeters: number
    }>
    skipped: Array<{ assetType: string; reason: string }>
  }
  roads?: {
    centerlinesPath: string
    corridorsPath: string
    totalLengthMeters: number
    segments: Array<{
      assetType: string
      lengthMeters: number
      maxGradePercent: number
      meanGradePercent: number
    }>
  }
}

const runsRoot = join(env.dataDir, 'runs')
const terrainCacheRoot = join(env.dataDir, 'terrain-cache')

export async function ensureDataRoots() {
  await mkdir(env.dataDir, { recursive: true })
  await mkdir(runsRoot, { recursive: true })
  await mkdir(terrainCacheRoot, { recursive: true })
}

export function generateRunId() {
  const now = new Date()
  const timestamp = now.toISOString().replace(/[-:TZ]/g, '').slice(0, 14)
  const suffix = randomBytes(3).toString('hex')
  return `${timestamp}_${suffix}`
}

export async function createRunScaffold(runId: string) {
  const base = join(runsRoot, runId)
  await mkdir(base, { recursive: true })
  await Promise.all(
    RUN_DIRECTORIES.map(async (dir) => {
      await mkdir(join(base, dir), { recursive: true })
    }),
  )
  return base
}

export async function writeManifest(runId: string, manifest: RunManifest) {
  const base = join(runsRoot, runId)
  const manifestPath = join(base, 'run.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
  logger.debug({ manifestPath }, 'Wrote run manifest')
}

export function getRunPath(runId: string, subdir?: string) {
  return subdir ? join(runsRoot, runId, subdir) : join(runsRoot, runId)
}

export function getRunFilePath(runId: string, relativePath: string) {
  return join(getRunPath(runId), relativePath)
}

export async function readManifest(runId: string): Promise<RunManifest | null> {
  try {
    const manifestPath = join(getRunPath(runId), 'run.json')
    const raw = await readFile(manifestPath, 'utf-8')
    return JSON.parse(raw) as RunManifest
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function updateManifest(
  runId: string,
  updater: (manifest: RunManifest) => RunManifest,
) {
  const manifest = await readManifest(runId)
  if (!manifest) {
    throw new Error(`Run manifest not found for ${runId}`)
  }
  const updated = updater(manifest)
  await writeManifest(runId, updated)
}

export function getTerrainCachePath(z: number, x: number, y: number) {
  return join(terrainCacheRoot, String(z), String(x), `${y}.png`)
}

export async function readRunMetadata(runId: string): Promise<RunMetadata | null> {
  try {
    const metadataPath = getRunFilePath(runId, 'inputs/metadata.json')
    const raw = await readFile(metadataPath, 'utf-8')
    return JSON.parse(raw) as RunMetadata
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function readNormalizedGeoJson(runId: string): Promise<FeatureCollection> {
  const manifest = await readManifest(runId)
  if (!manifest || !manifest.inputs?.normalizedGeoJsonPath) {
    throw new Error('Run manifest is missing normalized GeoJSON path. Re-run ingestion.')
  }

  const path = getRunFilePath(runId, manifest.inputs.normalizedGeoJsonPath)
  const raw = await readFile(path, 'utf-8')
  const parsed = JSON.parse(raw)
  if (!parsed || parsed.type !== 'FeatureCollection') {
    throw new Error('Normalized GeoJSON did not contain a FeatureCollection.')
  }
  return parsed
}
