import { fromLocalMeters, type LocalProjection } from '../geo/crs.js'
import type { AlignedGrid } from '../geo/grid.js'
import {
  TILE_SIZE,
  groundResolutionMetersPerPixel,
  lonLatToTilePixel,
  type TileCoordinate,
} from './tile-math.js'
import type { DecodedTerrainTile } from './decoder.js'

export interface DemAssembly {
  grid: AlignedGrid
  zoom: number
  elevations: Float32Array
  stats: {
    min: number
    max: number
    mean: number
    validCells: number
    missingCells: number
    resolutionMeters: number
  }
}

export function assembleDem(
  grid: AlignedGrid,
  zoom: number,
  projection: LocalProjection,
  tileData: Map<string, DecodedTerrainTile>,
): DemAssembly {
  const { width, height, resolution, origin } = grid
  const elevations = new Float32Array(width * height)

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  let validCells = 0
  let missingCells = 0

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const localX = origin[0] + (col + 0.5) * resolution
      const localY = origin[1] + (row + 0.5) * resolution
      const [lon, lat] = fromLocalMeters([localX, localY], projection)
      const value = sampleElevation(lon, lat, zoom, tileData)
      const index = row * width + col
      elevations[index] = value

      if (Number.isFinite(value)) {
        if (value < min) min = value
        if (value > max) max = value
        sum += value
        validCells += 1
      } else {
        missingCells += 1
      }
    }
  }

  const mean = validCells > 0 ? sum / validCells : Number.NaN
  const resolutionMeters = groundResolutionMetersPerPixel(zoom, projection.centroid.geometry.coordinates[1])

  return {
    grid,
    zoom,
    elevations,
    stats: {
      min,
      max,
      mean,
      validCells,
      missingCells,
      resolutionMeters,
    },
  }
}

function sampleElevation(
  lon: number,
  lat: number,
  zoom: number,
  tileData: Map<string, DecodedTerrainTile>,
) {
  const tileCoord = lonLatToTilePixel(lon, lat, zoom)
  const globalPixelX = tileCoord.tileXFloat * TILE_SIZE
  const globalPixelY = tileCoord.tileYFloat * TILE_SIZE

  const x0 = Math.floor(globalPixelX)
  const y0 = Math.floor(globalPixelY)
  const x1 = x0 + 1
  const y1 = y0 + 1

  const fX = globalPixelX - x0
  const fY = globalPixelY - y0

  const v00 = getElevationAtGlobalPixel(x0, y0, zoom, tileData)
  const v10 = getElevationAtGlobalPixel(x1, y0, zoom, tileData)
  const v01 = getElevationAtGlobalPixel(x0, y1, zoom, tileData)
  const v11 = getElevationAtGlobalPixel(x1, y1, zoom, tileData)

  if (
    !Number.isFinite(v00) ||
    !Number.isFinite(v10) ||
    !Number.isFinite(v01) ||
    !Number.isFinite(v11)
  ) {
    return Number.NaN
  }

  const interpX0 = v00 + fX * (v10 - v00)
  const interpX1 = v01 + fX * (v11 - v01)
  return interpX0 + fY * (interpX1 - interpX0)
}

function getElevationAtGlobalPixel(
  globalPixelX: number,
  globalPixelY: number,
  zoom: number,
  tileData: Map<string, DecodedTerrainTile>,
) {
  const tileX = Math.floor(globalPixelX / TILE_SIZE)
  const tileY = Math.floor(globalPixelY / TILE_SIZE)
  const pixelX = Math.floor(globalPixelX - tileX * TILE_SIZE)
  const pixelY = Math.floor(globalPixelY - tileY * TILE_SIZE)

  const key = tileKey({ x: tileX, y: tileY, z: zoom })
  const tile = tileData.get(key)
  if (!tile) {
    return Number.NaN
  }

  const clampedX = Math.max(0, Math.min(TILE_SIZE - 1, pixelX))
  const clampedY = Math.max(0, Math.min(TILE_SIZE - 1, pixelY))
  const index = clampedY * tile.width + clampedX
  return tile.elevations[index]
}

export function tileKey(tile: TileCoordinate) {
  return `${tile.z}/${tile.x}/${tile.y}`
}
