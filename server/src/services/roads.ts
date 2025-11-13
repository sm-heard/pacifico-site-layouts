import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { lineString, featureCollection, buffer } from '@turf/turf'
import type { Feature, LineString, Polygon, Point } from 'geojson'
import { logger } from '../lib/logger.js'
import {
  getRunPath,
  readManifest,
  readNormalizedGeoJson,
  readRunMetadata,
  updateManifest,
} from '../lib/run-store.js'
import { readFloat32Array, readUint8Array } from '../lib/io/binary.js'
import { buildFrictionSurface } from '../lib/raster/friction.js'
import { runAStar } from '../lib/raster/pathfinding.js'
import { DEFAULT_ROAD_CONFIG, type RoadConfig } from '../config/roads.js'
import { cellToLocal, localToCell, type AlignedGrid } from '../lib/geo/grid.js'
import { fromLocalMeters, toLocalMeters, type LocalProjection } from '../lib/geo/crs.js'

interface RoadSegmentResult {
  assetType: string
  line: Feature<LineString>
  corridor: Feature<Polygon>
  lengthMeters: number
  maxGradePercent: number
  meanGradePercent: number
  cost: number
}

export interface RoadBuildResult {
  segments: RoadSegmentResult[]
  totalLengthMeters: number
  corridorsPath: string
  centerlinesPath: string
}

export interface RoadOverrides {
  widthMeters?: number
  maxGradePercent?: number
}

export async function buildRoadsForRun(
  runId: string,
  overrides: RoadOverrides = {},
): Promise<RoadBuildResult> {
  const manifest = await readManifest(runId)
  if (!manifest) {
    throw new Error(`Run manifest not found for ${runId}`)
  }
  const metadata = await readRunMetadata(runId)
  if (!metadata) {
    throw new Error(`Run metadata not found for ${runId}`)
  }
  if (!manifest.constraints?.baseMaskPath) {
    throw new Error('Constraint base mask missing. Run constraints before roads.')
  }
  if (!manifest.layout?.placed || manifest.layout.placed.length === 0) {
    throw new Error('No placed assets found. Run asset layout before roads.')
  }
  if (!manifest.terrain?.demPath || !manifest.terrain?.slopePercentPath) {
    throw new Error('Terrain data missing. Run terrain generation before roads.')
  }

  const grid = metadata.grid
  const projection = grid.projection ?? metadata.projection
  if (!projection) {
    throw new Error('Projection metadata missing. Cannot compute roads.')
  }

  const totalCells = grid.width * grid.height
  const baseMask = await readUint8Array(getRunPath(runId, manifest.constraints.baseMaskPath), totalCells)
  const slopePercent = await readFloat32Array(getRunPath(runId, manifest.terrain.slopePercentPath), totalCells)
  const dem = await readFloat32Array(getRunPath(runId, manifest.terrain.demPath), totalCells)

  const roadConfig: RoadConfig = {
    ...DEFAULT_ROAD_CONFIG,
    ...overrides,
  }

  const friction = buildFrictionSurface(
    slopePercent,
    baseMask,
    grid.width,
    grid.height,
    roadConfig,
  )

  const entry = await resolveEntryPoint(runId, grid, projection)

  const segments: RoadSegmentResult[] = []
  let totalLengthMeters = 0

  for (const placement of manifest.layout.placed) {
    const targetIndex = placement.centerRow * grid.width + placement.centerCol
    if (placement.centerRow < 0 || placement.centerCol < 0 || targetIndex >= totalCells) {
      logger.warn({ placement }, 'Skipping invalid asset placement center for roads')
      continue
    }

    const path = runAStar(entry, {
      row: placement.centerRow,
      col: placement.centerCol,
      index: targetIndex,
    }, {
      width: grid.width,
      height: grid.height,
      costGrid: friction,
      traversableMask: baseMask,
    })

    if (!path) {
      logger.warn({ runId, assetType: placement.assetType }, 'Failed to find route to asset')
      continue
    }

    const polylineLocal = path.cells.map((cell) => cellToLocal(cell.row, cell.col, grid))
    const polylineWgs = polylineLocal.map((coord) => fromLocalMeters(coord, projection))

    const line = lineString(polylineWgs, {
      assetType: placement.assetType,
      targetRow: placement.centerRow,
      targetCol: placement.centerCol,
    })

    const corridor = buffer(line, roadConfig.widthMeters / 2000, {
      units: 'kilometers',
      steps: 8,
    }) as Feature<Polygon>

    const { lengthMeters, maxGradePercent, meanGradePercent } = analysePath(path.cells, grid, dem)

    totalLengthMeters += lengthMeters
    segments.push({
      assetType: placement.assetType,
      line,
      corridor,
      lengthMeters,
      maxGradePercent,
      meanGradePercent,
      cost: path.cost,
    })
  }

  const roadsDir = getRunPath(runId, 'roads')
  await mkdir(roadsDir, { recursive: true })

  const centerlinesPath = join(roadsDir, 'centerlines.geojson')
  const corridorsPath = join(roadsDir, 'corridors.geojson')

  await writeFile(centerlinesPath, JSON.stringify(featureCollection(segments.map((segment) => segment.line)), null, 2), 'utf-8')
  await writeFile(corridorsPath, JSON.stringify(featureCollection(segments.map((segment) => segment.corridor)), null, 2), 'utf-8')

  await updateManifest(runId, (existing) => ({
    ...existing,
    roads: {
      centerlinesPath: 'roads/centerlines.geojson',
      corridorsPath: 'roads/corridors.geojson',
      segments: segments.map((segment) => ({
        assetType: segment.assetType,
        lengthMeters: segment.lengthMeters,
        maxGradePercent: segment.maxGradePercent,
        meanGradePercent: segment.meanGradePercent,
      })),
      totalLengthMeters,
    },
    parameters: {
      ...(existing.parameters ?? {}),
      roads: {
        widthMeters: roadConfig.widthMeters,
        maxGradePercent: roadConfig.maxGradePercent,
      },
    },
  }))

  logger.info({ runId, segmentCount: segments.length, totalLengthMeters }, 'Road routing complete')

  return {
    segments,
    totalLengthMeters,
    corridorsPath,
    centerlinesPath,
  }
}

async function resolveEntryPoint(
  runId: string,
  grid: AlignedGrid,
  projection: LocalProjection,
) {
  const normalized = await readNormalizedGeoJson(runId)
  const entryPoint = normalized.features.find(
    (feature): feature is Feature<Point> => feature.geometry?.type === 'Point',
  )
  if (!entryPoint) {
    throw new Error('No entry point found in inputs. User must specify an entry before routing.')
  }
  const [lon, lat] = entryPoint.geometry.coordinates
  const local = toLocalMeters([lon, lat], projection)
  const cell = localToCell(local, grid)
  if (cell.index == null) {
    throw new Error('Entry point lies outside the computed grid extent. Adjust AOI padding.')
  }
  return { row: cell.row, col: cell.col, index: cell.index }
}

function analysePath(cells: Array<{ row: number; col: number }>, grid: AlignedGrid, dem: Float32Array) {
  let lengthMeters = 0
  let maxGradePercent = 0
  let slopeSum = 0
  let slopeCount = 0

  for (let i = 1; i < cells.length; i += 1) {
    const prev = cells[i - 1]
    const curr = cells[i]
    const prevIndex = prev.row * grid.width + prev.col
    const currIndex = curr.row * grid.width + curr.col
    const dz = dem[currIndex] - dem[prevIndex]
    const dx = (curr.col - prev.col) * grid.resolution
    const dy = (curr.row - prev.row) * grid.resolution
    const horizontal = Math.hypot(dx, dy)
    if (horizontal === 0) continue
    lengthMeters += horizontal
    const grade = Math.abs((dz / horizontal) * 100)
    if (Number.isFinite(grade)) {
      slopeSum += grade
      slopeCount += 1
      if (grade > maxGradePercent) {
        maxGradePercent = grade
      }
    }
  }

  return {
    lengthMeters,
    maxGradePercent,
    meanGradePercent: slopeCount > 0 ? slopeSum / slopeCount : 0,
  }
}
