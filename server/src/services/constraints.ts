import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { encode as encodePng } from 'fast-png'
import { logger } from '../lib/logger.js'
import {
  getRunPath,
  readManifest,
  readNormalizedGeoJson,
  readRunMetadata,
  updateManifest,
} from '../lib/run-store.js'
import { normalizeInputs } from '../lib/geo/geojson.js'
import { rasterizePolygonFeature } from '../lib/raster/polygon.js'
import { computeDistanceFromBoundary } from '../lib/raster/distance.js'
import { readFloat32Array, writeFloat32Array, writeUint8Array } from '../lib/io/binary.js'
import { ASSET_CONSTRAINTS, ASSET_TYPES } from '../config/assets.js'

const DISTANCE_MAP_FILENAME = 'distance-to-boundary.bin'
const BASE_MASK_FILENAME = 'base-mask.bin'
const SUMMARY_FILENAME = 'summary.json'
const BASE_MASK_PNG = 'base-mask.png'
const DISTANCE_MASK_PNG = 'distance-to-boundary.png'

export interface ConstraintsBuildResult {
  baseMaskPath: string
  distancePath: string
  baseMaskPngPath: string
  distanceMaskPngPath: string
  baseFeasibleCells: number
  baseFeasibleAreaSqMeters: number
  assetMasks: Array<{
    assetId: string
    path: string
    feasibleCells: number
    feasibleAreaSqMeters: number
  }>
  maxDistanceMeters: number
}

export async function buildConstraintsForRun(runId: string): Promise<ConstraintsBuildResult> {
  const manifest = await readManifest(runId)
  if (!manifest) {
    throw new Error(`Run manifest not found for ${runId}`)
  }

  const metadata = await readRunMetadata(runId)
  if (!metadata) {
    throw new Error(`Run metadata not found for ${runId}`)
  }

  if (!manifest.terrain?.slopePercentPath) {
    throw new Error('Terrain data missing. Run terrain generation before constraints.')
  }

  const normalizedCollection = await readNormalizedGeoJson(runId)
  const normalized = normalizeInputs(normalizedCollection)

  const grid = metadata.grid
  const projection = grid.projection ?? metadata.projection
  if (!projection) {
    throw new Error('Projection metadata missing. Cannot compute constraints.')
  }

  const totalCells = grid.width * grid.height
  const baseMask = rasterizePolygonFeature(normalized.boundary, grid, projection)

  for (const exclusion of normalized.exclusions) {
    const exclusionMask = rasterizePolygonFeature(exclusion, grid, projection)
    for (let i = 0; i < totalCells; i += 1) {
      if (exclusionMask[i] === 1) {
        baseMask[i] = 0
      }
    }
  }

  const baseFeasibleCells = countActive(baseMask)
  const baseFeasibleAreaSqMeters = baseFeasibleCells * grid.resolution * grid.resolution

  const masksDir = getRunPath(runId, 'masks')
  await mkdir(masksDir, { recursive: true })

  const baseMaskPath = join(masksDir, BASE_MASK_FILENAME)
  await writeUint8Array(baseMaskPath, baseMask)
  await writePng(join(masksDir, BASE_MASK_PNG), grid.width, grid.height, baseMaskToPng(baseMask))

  const slopePercentPath = getRunPath(runId, manifest.terrain.slopePercentPath ?? 'dem/slope-percent.bin')
  const slopePercent = await readFloat32Array(slopePercentPath, totalCells)

  const distanceResult = computeDistanceFromBoundary(
    baseMask,
    grid.width,
    grid.height,
    grid.resolution,
  )
  const distancePath = join(masksDir, DISTANCE_MAP_FILENAME)
  await writeFloat32Array(distancePath, distanceResult.distances)
  await writePng(
    join(masksDir, DISTANCE_MASK_PNG),
    grid.width,
    grid.height,
    distanceToPng(distanceResult.distances, grid.width, grid.height, distanceResult.maxDistance),
  )

  const assetSummaries: ConstraintsBuildResult['assetMasks'] = []

  for (const assetType of ASSET_TYPES) {
    const asset = ASSET_CONSTRAINTS[assetType]
    const assetMask = new Uint8Array(totalCells)

    for (let i = 0; i < totalCells; i += 1) {
      if (baseMask[i] === 0) continue
      const slope = slopePercent[i]
      if (!Number.isFinite(slope) || slope > asset.maxSlopePercent) continue
      const distance = distanceResult.distances[i]
      if (distance < asset.propertySetbackMeters) continue
      assetMask[i] = 1
    }

    const feasibleCells = countActive(assetMask)
    const assetPath = join(masksDir, `asset-${assetType}-mask.bin`)
    await writeUint8Array(assetPath, assetMask)

    assetSummaries.push({
      assetId: assetType,
      path: assetPath,
      feasibleCells,
      feasibleAreaSqMeters: feasibleCells * grid.resolution * grid.resolution,
    })
  }

  const summary = {
    runId,
    generatedAt: new Date().toISOString(),
    baseFeasibleCells,
    baseFeasibleAreaSqMeters,
    maxDistanceMeters: distanceResult.maxDistance,
    assets: assetSummaries,
  }
  await writeFile(join(masksDir, SUMMARY_FILENAME), JSON.stringify(summary, null, 2), 'utf-8')

  await updateManifest(runId, (existing) => ({
    ...existing,
    constraints: {
      baseMaskPath: 'masks/' + BASE_MASK_FILENAME,
      distanceMaskPath: 'masks/' + DISTANCE_MAP_FILENAME,
      baseMaskPngPath: 'masks/' + BASE_MASK_PNG,
      distanceMaskPngPath: 'masks/' + DISTANCE_MASK_PNG,
      baseFeasibleCells,
      assetMasks: Object.fromEntries(
        assetSummaries.map((asset) => [asset.assetId, {
          path: 'masks/' + `asset-${asset.assetId}-mask.bin`,
          feasibleCells: asset.feasibleCells,
        }]),
      ),
    },
  }))

  logger.info(
    {
      runId,
      baseFeasibleCells,
      assets: assetSummaries.map((asset) => ({
        assetId: asset.assetId,
        feasibleCells: asset.feasibleCells,
      })),
    },
    'Constraint masks generated',
  )

  return {
    baseMaskPath,
    distancePath,
    baseMaskPngPath: join(masksDir, BASE_MASK_PNG),
    distanceMaskPngPath: join(masksDir, DISTANCE_MASK_PNG),
    baseFeasibleCells,
    baseFeasibleAreaSqMeters,
    assetMasks: assetSummaries,
    maxDistanceMeters: distanceResult.maxDistance,
  }
}

function countActive(mask: Uint8Array) {
  let count = 0
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] === 1) count += 1
  }
  return count
}

function baseMaskToPng(mask: Uint8Array) {
  const png = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i += 1) {
    png[i] = mask[i] ? 255 : 0
  }
  return png
}

function distanceToPng(data: Float32Array, width: number, height: number, maxDistance: number) {
  const png = new Uint8Array(width * height)
  const scale = maxDistance > 0 ? 1 / maxDistance : 0
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i]
    if (!Number.isFinite(value)) {
      png[i] = 0
      continue
    }
    const normalized = Math.max(0, Math.min(1, value * scale))
    png[i] = Math.round(normalized * 255)
  }
  return png
}

async function writePng(path: string, width: number, height: number, grayscale: Uint8Array) {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < grayscale.length; i += 1) {
    const value = grayscale[i]
    const offset = i * 4
    rgba[offset] = value
    rgba[offset + 1] = value
    rgba[offset + 2] = value
    rgba[offset + 3] = 255
  }
  const pngBuffer = encodePng({ width, height, data: rgba })
  await writeFile(path, pngBuffer)
}
