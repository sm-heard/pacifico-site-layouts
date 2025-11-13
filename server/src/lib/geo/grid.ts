import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { bbox as turfBbox } from '@turf/turf'
import { determineLocalProjection, fromLocalMeters, toLocalMeters, type LocalProjection } from './crs.js'

export interface GridResolutionOptions {
  coarseResolution?: number
  fineResolution?: number
  fineAreaThresholdSqMeters?: number
  maxPixels?: number
}

export interface AlignedGrid {
  resolution: number
  width: number
  height: number
  pixelCount: number
  origin: [number, number]
  extent: [number, number, number, number]
  extentWgs84: [number, number, number, number]
  paddingMeters: number
  projection: LocalProjection
}

const DEFAULT_RESOLUTION_OPTIONS: Required<GridResolutionOptions> = {
  coarseResolution: 20,
  fineResolution: 10,
  fineAreaThresholdSqMeters: 10 * 1_000_000, // 10 km^2
  maxPixels: 12_000_000,
}

export function recommendGridResolution(
  areaSqMeters: number,
  options: GridResolutionOptions = {},
): number {
  const merged = { ...DEFAULT_RESOLUTION_OPTIONS, ...options }
  const resolution = areaSqMeters <= merged.fineAreaThresholdSqMeters ? merged.fineResolution : merged.coarseResolution
  return resolution
}

export function computeAlignedGrid(
  boundary: Feature<Polygon | MultiPolygon>,
  resolution: number,
  options: { paddingPixels?: number; resolutionOptions?: GridResolutionOptions; projection?: LocalProjection } = {},
): AlignedGrid {
  const paddingPixels = options.paddingPixels ?? 1
  const mergedResolutionOptions = { ...DEFAULT_RESOLUTION_OPTIONS, ...options.resolutionOptions }

  const projection = options.projection ?? determineLocalProjection(boundary)
  const boundaryBbox = turfBbox(boundary) as [number, number, number, number]
  const cornersLocal = getLocalBoundingCorners(boundaryBbox, projection)

  let currentResolution = resolution
  let grid = computeGridFromCorners(cornersLocal, currentResolution, paddingPixels)

  while (grid.pixelCount > mergedResolutionOptions.maxPixels) {
    currentResolution *= 2
    grid = computeGridFromCorners(cornersLocal, currentResolution, paddingPixels)
  }

  const extentWgs84 = computeWgs84Extent(grid.extent, projection)

  return {
    resolution: currentResolution,
    width: grid.width,
    height: grid.height,
    pixelCount: grid.pixelCount,
    origin: grid.origin,
    extent: grid.extent,
    extentWgs84,
    paddingMeters: paddingPixels * currentResolution,
    projection,
  }
}

function computeGridFromCorners(
  cornersLocal: [number, number][],
  resolution: number,
  paddingPixels: number,
) {
  const paddingMeters = paddingPixels * resolution
  const xs = cornersLocal.map((coord) => coord[0])
  const ys = cornersLocal.map((coord) => coord[1])

  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const alignedMinX = Math.floor((minX - paddingMeters) / resolution) * resolution
  const alignedMaxX = Math.ceil((maxX + paddingMeters) / resolution) * resolution
  const alignedMinY = Math.floor((minY - paddingMeters) / resolution) * resolution
  const alignedMaxY = Math.ceil((maxY + paddingMeters) / resolution) * resolution

  const width = Math.max(1, Math.round((alignedMaxX - alignedMinX) / resolution))
  const height = Math.max(1, Math.round((alignedMaxY - alignedMinY) / resolution))
  const pixelCount = width * height

  return {
    width,
    height,
    pixelCount,
    origin: [alignedMinX, alignedMinY] as [number, number],
    extent: [alignedMinX, alignedMinY, alignedMaxX, alignedMaxY] as [number, number, number, number],
  }
}

function getLocalBoundingCorners(
  bboxWgs84: [number, number, number, number],
  projection: LocalProjection,
): [number, number][] {
  const [minLon, minLat, maxLon, maxLat] = bboxWgs84
  const corners: [number, number][] = [
    [minLon, minLat],
    [minLon, maxLat],
    [maxLon, minLat],
    [maxLon, maxLat],
  ]
  return corners.map((coord) => toLocalMeters(coord, projection))
}

function computeWgs84Extent(
  extentLocal: [number, number, number, number],
  projection: LocalProjection,
): [number, number, number, number] {
  const [minX, minY, maxX, maxY] = extentLocal
  const localCorners: [number, number][] = [
    [minX, minY],
    [minX, maxY],
    [maxX, minY],
    [maxX, maxY],
  ]

  const wgsCorners = localCorners.map((coord) => fromLocalMeters(coord, projection))
  const lons = wgsCorners.map((coord) => coord[0])
  const lats = wgsCorners.map((coord) => coord[1])

  const minLon = Math.min(...lons)
  const maxLon = Math.max(...lons)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)

  return [minLon, minLat, maxLon, maxLat]
}

export function cellToLocal(row: number, col: number, grid: AlignedGrid): [number, number] {
  const x = grid.origin[0] + (col + 0.5) * grid.resolution
  const y = grid.origin[1] + (row + 0.5) * grid.resolution
  return [x, y]
}

export function localToCell(local: [number, number], grid: AlignedGrid): {
  row: number
  col: number
  index: number | null
} {
  const colFloat = (local[0] - grid.origin[0]) / grid.resolution - 0.5
  const rowFloat = (local[1] - grid.origin[1]) / grid.resolution - 0.5
  const col = Math.round(colFloat)
  const row = Math.round(rowFloat)
  if (row < 0 || row >= grid.height || col < 0 || col >= grid.width) {
    return { row, col, index: null }
  }
  return { row, col, index: row * grid.width + col }
}
