import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { logger } from '../lib/logger.js'
import {
  getRunPath,
  readManifest,
  readRunMetadata,
  updateManifest,
} from '../lib/run-store.js'
import { loadTerrainTile } from '../lib/terrain/fetch.js'
import { decodeTerrainTile, type DecodedTerrainTile } from '../lib/terrain/decoder.js'
import { assembleDem, tileKey } from '../lib/terrain/dem.js'
import {
  recommendTerrainZoom,
  wgs84ExtentToTileRange,
  type TileCoordinate,
} from '../lib/terrain/tile-math.js'
import { computeSlopeAndAspect } from '../lib/terrain/analysis.js'

export interface TerrainBuildResult {
  demPath: string
  metadataPath: string
  zoom: number
  tileCount: number
  resolutionMeters: number
  stats: {
    min: number
    max: number
    mean: number
    validCells: number
    missingCells: number
  }
  slope: {
    minDegrees: number
    maxDegrees: number
    meanDegrees: number
  }
}

export async function buildTerrainForRun(runId: string): Promise<TerrainBuildResult> {
  const manifest = await readManifest(runId)
  if (!manifest) {
    throw new Error(`Run manifest not found for ${runId}`)
  }

  const metadata = await readRunMetadata(runId)
  if (!metadata) {
    throw new Error(`Run metadata not found for ${runId}`)
  }

  const grid = metadata.grid
  const projection = grid.projection ?? metadata.projection
  if (!projection) {
    throw new Error('Projection metadata is missing. Re-run ingestion.')
  }

  const centroidLat = projection.centroid.geometry.coordinates[1]
  const zoom = recommendTerrainZoom(grid.resolution, centroidLat)
  const tileRange = wgs84ExtentToTileRange(grid.extentWgs84, zoom)

  logger.info(
    {
      runId,
      zoom,
      tileCount: tileRange.tiles.length,
      extent: grid.extentWgs84,
    },
    'Fetching terrain tiles',
  )

  const decodedTiles = await fetchAndDecodeTiles(tileRange.tiles)

  const dem = assembleDem(grid, zoom, projection, decodedTiles)
  const slopeAspect = computeSlopeAndAspect(
    dem.elevations,
    grid.width,
    grid.height,
    grid.resolution,
  )

  const demDir = getRunPath(runId, 'dem')
  await mkdir(demDir, { recursive: true })

  const demPath = join(demDir, 'dem.bin')
  const elevationsBuffer = Buffer.from(
    dem.elevations.buffer,
    dem.elevations.byteOffset,
    dem.elevations.byteLength,
  )
  await writeFile(demPath, elevationsBuffer)

  const metadataPath = join(demDir, 'dem.json')
  const tilesPath = join(demDir, 'tiles.json')

  const slopeStats = summariseArray(slopeAspect.slopeDegrees)
  const demMetadata = {
    runId,
    generatedAt: new Date().toISOString(),
    grid,
    zoom,
    stats: dem.stats,
    slope: {
      minDegrees: slopeStats.min,
      maxDegrees: slopeStats.max,
      meanDegrees: slopeStats.mean,
    },
  }
  await writeFile(metadataPath, JSON.stringify(demMetadata, null, 2), 'utf-8')

  await writeFloatArray(join(demDir, 'slope-deg.bin'), slopeAspect.slopeDegrees)
  await writeFloatArray(join(demDir, 'slope-percent.bin'), slopeAspect.slopePercent)
  await writeFloatArray(join(demDir, 'aspect-deg.bin'), slopeAspect.aspectDegrees)

  const tileSummary = tileRange.tiles.map((tile) => ({
    key: tileKey(tile),
    x: tile.x,
    y: tile.y,
    z: tile.z,
  }))
  await writeFile(tilesPath, JSON.stringify(tileSummary, null, 2), 'utf-8')

  await updateManifest(runId, (existing) => ({
    ...existing,
    terrain: {
      demPath: 'dem/dem.bin',
      metadataPath: 'dem/dem.json',
      slopeDegreesPath: 'dem/slope-deg.bin',
      slopePercentPath: 'dem/slope-percent.bin',
      aspectDegreesPath: 'dem/aspect-deg.bin',
      zoom,
      tileCount: tileRange.tiles.length,
      resolutionMeters: dem.stats.resolutionMeters,
      minElevation: dem.stats.min,
      maxElevation: dem.stats.max,
      meanElevation: dem.stats.mean,
      missingCells: dem.stats.missingCells,
      validCells: dem.stats.validCells,
      slopeMinDegrees: slopeStats.min,
      slopeMaxDegrees: slopeStats.max,
      slopeMeanDegrees: slopeStats.mean,
    },
  }))

  return {
    demPath,
    metadataPath,
    zoom,
    tileCount: tileRange.tiles.length,
    resolutionMeters: dem.stats.resolutionMeters,
    stats: {
      min: dem.stats.min,
      max: dem.stats.max,
      mean: dem.stats.mean,
      validCells: dem.stats.validCells,
      missingCells: dem.stats.missingCells,
    },
    slope: {
      minDegrees: slopeStats.min,
      maxDegrees: slopeStats.max,
      meanDegrees: slopeStats.mean,
    },
  }
}

async function fetchAndDecodeTiles(tiles: TileCoordinate[]) {
  const decoded = new Map<string, DecodedTerrainTile>()
  for (const tile of tiles) {
    const loaded = await loadTerrainTile(tile)
    const decodedTile = await decodeTerrainTile(loaded.buffer)
    decoded.set(tileKey(tile), decodedTile)
  }
  return decoded
}

async function writeFloatArray(path: string, array: Float32Array) {
  const buffer = Buffer.from(array.buffer, array.byteOffset, array.byteLength)
  await writeFile(path, buffer)
}

function summariseArray(array: Float32Array) {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  let count = 0

  for (let i = 0; i < array.length; i += 1) {
    const value = array[i]
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
    sum += value
    count += 1
  }

  return {
    min: count > 0 ? min : Number.NaN,
    max: count > 0 ? max : Number.NaN,
    mean: count > 0 ? sum / count : Number.NaN,
  }
}
