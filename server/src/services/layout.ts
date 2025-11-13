import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Feature, Polygon } from 'geojson'
import { logger } from '../lib/logger.js'
import {
  getRunPath,
  readManifest,
  readRunMetadata,
  updateManifest,
} from '../lib/run-store.js'
import { readUint8Array, readFloat32Array } from '../lib/io/binary.js'
import { ASSET_CONSTRAINTS, ASSET_TYPES, type AssetConstraintsProfile, type AssetType } from '../config/assets.js'
import { findComponents } from '../lib/raster/components.js'
import type { AlignedGrid } from '../lib/geo/grid.js'
import { cellToLocal } from '../lib/geo/grid.js'
import { fromLocalMeters, type LocalProjection } from '../lib/geo/crs.js'

type AssetConfig = AssetConstraintsProfile

interface PlacementCandidate {
  assetType: AssetType
  centerRow: number
  centerCol: number
  slopeScore: number
  componentId: number
}

interface PlacedAsset {
  assetType: AssetType
  footprint: {
    widthMeters: number
    heightMeters: number
  }
  polygon: Feature<Polygon>
  center: {
    local: [number, number]
    wgs84: [number, number]
    row: number
    col: number
  }
  slopeMeanPercent: number
}

export interface LayoutOverrides {
  maxSlopePercent?: number
}

export interface LayoutResult {
  features: Feature<Polygon>[]
  placedAssets: PlacedAsset[]
  skippedAssets: Array<{ assetType: AssetType; reason: string }>
  layoutPath: string
}

export async function placeAssetsForRun(
  runId: string,
  overrides: LayoutOverrides = {},
): Promise<LayoutResult> {
  const manifest = await readManifest(runId)
  if (!manifest) {
    throw new Error(`Run manifest not found for ${runId}`)
  }
  const metadata = await readRunMetadata(runId)
  if (!metadata) {
    throw new Error(`Run metadata not found for ${runId}`)
  }
  if (!manifest.constraints) {
    throw new Error('Constraint masks not found. Run constraint generation first.')
  }
  if (!manifest.terrain?.slopePercentPath) {
    throw new Error('Slope data missing. Run terrain generation first.')
  }

  const grid = metadata.grid
  const projection = grid.projection ?? metadata.projection
  if (!projection) {
    throw new Error('Projection metadata missing. Cannot place assets.')
  }

  const totalCells = grid.width * grid.height

  const slopePercentPath = getRunPath(runId, manifest.terrain.slopePercentPath ?? 'dem/slope-percent.bin')
  const slopePercent = await readFloat32Array(slopePercentPath, totalCells)

  const placements: PlacedAsset[] = []
  const skipped: LayoutResult['skippedAssets'] = []

  const effectiveConstraints = ASSET_TYPES.reduce<Record<AssetType, AssetConstraintsProfile>>((acc, assetType) => {
    const asset = ASSET_CONSTRAINTS[assetType]
    acc[assetType] = {
      ...asset,
      maxSlopePercent: overrides.maxSlopePercent ?? asset.maxSlopePercent,
    }
    return acc
  }, {} as Record<AssetType, AssetConstraintsProfile>)

  for (const assetType of ASSET_TYPES) {
    const assetMaskInfo = manifest.constraints.assetMasks[assetType]
    if (!assetMaskInfo) {
      skipped.push({ assetType, reason: 'No mask available for asset' })
      continue
    }

    const assetMask = await readUint8Array(getRunPath(runId, assetMaskInfo.path), totalCells)
    const { summaries, labels } = findComponents(assetMask, grid.width, grid.height, slopePercent)

    const assetConfig = effectiveConstraints[assetType]
    const footprintCellsNeeded = Math.ceil(
      (assetConfig.footprint.widthMeters * assetConfig.footprint.heightMeters) /
        (grid.resolution * grid.resolution),
    )

    const sortedComponents = summaries
      .filter((summary) => summary.cellCount >= footprintCellsNeeded)
      .sort((a, b) => a.meanSlopePercent - b.meanSlopePercent)

    let placed: PlacedAsset | null = null

    for (const component of sortedComponents) {
      const candidate = findPlacementInComponent(
        component,
        labels,
        assetMask,
        grid,
        assetConfig,
        placements,
        slopePercent,
      )
      if (!candidate) continue

      const placedAsset = buildPlacedAsset(candidate, grid, projection, assetConfig, slopePercent)
      placements.push(placedAsset)
      placed = placedAsset
      break
    }

    if (!placed) {
      skipped.push({ assetType, reason: 'No feasible patch met footprint or spacing requirements' })
    }
  }

  const features = placements.map((placement) => placement.polygon)
  const layoutDir = getRunPath(runId, 'layout')
  await mkdir(layoutDir, { recursive: true })
  const layoutPath = join(layoutDir, 'assets.geojson')
  await writeFile(
    layoutPath,
    JSON.stringify({ type: 'FeatureCollection', features }, null, 2),
    'utf-8',
  )

  await updateManifest(runId, (existing) => ({
    ...existing,
    layout: {
      assetsGeoJsonPath: 'layout/assets.geojson',
      placed: placements.map((placement) => ({
        assetType: placement.assetType,
        centerWgs84: placement.center.wgs84,
        centerLocal: placement.center.local,
        centerRow: placement.center.row,
        centerCol: placement.center.col,
        slopeMeanPercent: placement.slopeMeanPercent,
        widthMeters: placement.footprint.widthMeters,
        heightMeters: placement.footprint.heightMeters,
      })),
      skipped,
    },
    parameters: {
      ...(existing.parameters ?? {}),
      layout: {
        maxSlopePercent: overrides.maxSlopePercent ?? null,
      },
    },
  }))

  logger.info({ runId, placed: placements.length, skipped }, 'Asset placement complete')

  return {
    features,
    placedAssets: placements,
    skippedAssets: skipped,
    layoutPath,
  }
}

function findPlacementInComponent(
  component: ReturnType<typeof findComponents>['summaries'][number],
  labels: Int32Array,
  mask: Uint8Array,
  grid: AlignedGrid,
  assetConfig: AssetConfig,
  existingPlacements: PlacedAsset[],
  slopePercent: Float32Array,
): PlacementCandidate | null {
  const { bounds } = component
  let bestCandidate: PlacementCandidate | null = null

  for (let row = bounds.minRow; row <= bounds.maxRow; row += 1) {
    for (let col = bounds.minCol; col <= bounds.maxCol; col += 1) {
      const index = row * grid.width + col
      if (mask[index] === 0 || labels[index] !== component.id) continue

      if (!footprintFits(row, col, mask, grid, assetConfig)) continue
      if (!satisfiesSpacing(row, col, grid, assetConfig.spacingMeters, existingPlacements, assetConfig)) {
        continue
      }

      const slopeScore = scoreSlope(row, col, grid, assetConfig, slopePercent)
      if (!Number.isFinite(slopeScore)) continue

      if (!bestCandidate || slopeScore < bestCandidate.slopeScore) {
        bestCandidate = {
          assetType: assetConfig.id,
          centerRow: row,
          centerCol: col,
          slopeScore,
          componentId: component.id,
        }
      }
    }
  }

  return bestCandidate
}

function footprintFits(
  centerRow: number,
  centerCol: number,
  mask: Uint8Array,
  grid: AlignedGrid,
  assetConfig: AssetConfig,
) {
  const { minRow, maxRow, minCol, maxCol } = footprintBounds(centerRow, centerCol, grid, assetConfig)
  if (
    minRow < 0 ||
    minCol < 0 ||
    maxRow >= grid.height ||
    maxCol >= grid.width
  ) {
    return false
  }

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const index = row * grid.width + col
      if (mask[index] === 0) {
        return false
      }
    }
  }
  return true
}

function footprintBounds(
  centerRow: number,
  centerCol: number,
  grid: AlignedGrid,
  assetConfig: AssetConfig,
) {
  const halfHeightCells = assetConfig.footprint.heightMeters / grid.resolution / 2
  const halfWidthCells = assetConfig.footprint.widthMeters / grid.resolution / 2

  const minRow = Math.floor(centerRow - halfHeightCells)
  const maxRow = Math.ceil(centerRow + halfHeightCells)
  const minCol = Math.floor(centerCol - halfWidthCells)
  const maxCol = Math.ceil(centerCol + halfWidthCells)

  return { minRow, maxRow, minCol, maxCol }
}

function satisfiesSpacing(
  row: number,
  col: number,
  grid: AlignedGrid,
  spacingMeters: number,
  existing: PlacedAsset[],
  assetConfig: AssetConfig,
) {
  if (existing.length === 0) return true
  const center = cellToLocal(row, col, grid)

  for (const placed of existing) {
    const requiredSpacing = Math.max(spacingMeters, placedSpacingMeters(placed))
    const requiredSpacingSq = requiredSpacing * requiredSpacing
    const dx = center[0] - placed.center.local[0]
    const dy = center[1] - placed.center.local[1]
    if (dx * dx + dy * dy < requiredSpacingSq) {
      if (rectanglesOverlap(center, assetConfig.footprint, placed.center.local, placed.footprint)) {
        return false
      }
    }
  }

  return true
}

function placedSpacingMeters(placed: PlacedAsset) {
  const assetConfig = ASSET_CONSTRAINTS[placed.assetType]
  return assetConfig.spacingMeters
}

function rectanglesOverlap(
  centerA: [number, number],
  footprintA: { widthMeters: number; heightMeters: number },
  centerB: [number, number],
  footprintB: { widthMeters: number; heightMeters: number },
) {
  const [ax, ay] = centerA
  const [bx, by] = centerB
  const aHalfWidth = footprintA.widthMeters / 2
  const aHalfHeight = footprintA.heightMeters / 2
  const bHalfWidth = footprintB.widthMeters / 2
  const bHalfHeight = footprintB.heightMeters / 2

  const overlapX = Math.abs(ax - bx) < aHalfWidth + bHalfWidth
  const overlapY = Math.abs(ay - by) < aHalfHeight + bHalfHeight
  return overlapX && overlapY
}

function scoreSlope(
  centerRow: number,
  centerCol: number,
  grid: AlignedGrid,
  assetConfig: AssetConfig,
  slopePercent: Float32Array,
) {
  const { minRow, maxRow, minCol, maxCol } = footprintBounds(centerRow, centerCol, grid, assetConfig)
  let sum = 0
  let count = 0
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const value = slopePercent[row * grid.width + col]
      if (!Number.isFinite(value)) continue
      sum += value
      count += 1
    }
  }
  return count > 0 ? sum / count : Number.POSITIVE_INFINITY
}

function buildPlacedAsset(
  candidate: PlacementCandidate,
  grid: AlignedGrid,
  projection: LocalProjection,
  assetConfig: AssetConfig,
  slopePercent: Float32Array,
): PlacedAsset {
  const centerLocal = cellToLocal(candidate.centerRow, candidate.centerCol, grid)
  const centerWgs = fromLocalMeters(centerLocal, projection)
  const polygon = rectanglePolygon(
    centerLocal,
    assetConfig.footprint,
    projection,
    candidate.assetType,
  )

  const slopeMean = scoreSlope(
    candidate.centerRow,
    candidate.centerCol,
    grid,
    assetConfig,
    slopePercent,
  )

  return {
    assetType: candidate.assetType,
    footprint: assetConfig.footprint,
    polygon,
    center: {
      local: centerLocal,
      wgs84: centerWgs,
      row: candidate.centerRow,
      col: candidate.centerCol,
    },
    slopeMeanPercent: slopeMean,
  }
}

function rectanglePolygon(
  center: [number, number],
  footprint: { widthMeters: number; heightMeters: number },
  projection: LocalProjection,
  assetType: AssetType,
): Feature<Polygon> {
  const halfWidth = footprint.widthMeters / 2
  const halfHeight = footprint.heightMeters / 2

  const cornersLocal: [number, number][] = [
    [center[0] - halfWidth, center[1] - halfHeight],
    [center[0] + halfWidth, center[1] - halfHeight],
    [center[0] + halfWidth, center[1] + halfHeight],
    [center[0] - halfWidth, center[1] + halfHeight],
  ]

  const cornersWgs = cornersLocal.map((coord) => fromLocalMeters(coord, projection))
  cornersWgs.push(cornersWgs[0])

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [cornersWgs],
    },
    properties: {
      assetType,
      widthMeters: footprint.widthMeters,
      heightMeters: footprint.heightMeters,
    },
  }
}
