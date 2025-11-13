const EARTH_CIRCUMFERENCE_METERS = 40075016.68557849
export const TILE_SIZE = 256

export const TILE_SOURCE = 'mapbox.terrain-rgb'

export function groundResolutionMetersPerPixel(zoom: number, latitude: number) {
  const latitudeRad = (latitude * Math.PI) / 180
  return (
    (Math.cos(latitudeRad) * EARTH_CIRCUMFERENCE_METERS) /
    (TILE_SIZE * Math.pow(2, zoom))
  )
}

export function recommendTerrainZoom(targetResolutionMeters: number, latitude: number) {
  const clampedResolution = Math.max(targetResolutionMeters, 1)
  let zoom = 0
  let resolution = Number.POSITIVE_INFINITY
  while (zoom < 22) {
    resolution = groundResolutionMetersPerPixel(zoom, latitude)
    if (resolution <= clampedResolution) {
      break
    }
    zoom += 1
  }
  return zoom
}

export interface TileCoordinate {
  z: number
  x: number
  y: number
}

export interface TilePixelCoordinate extends TileCoordinate {
  pixelX: number
  pixelY: number
  pixelXFloat: number
  pixelYFloat: number
  tileXFloat: number
  tileYFloat: number
}

export function wgs84ExtentToTileRange(
  extentWgs84: [number, number, number, number],
  zoom: number,
) {
  const [minLon, minLat, maxLon, maxLat] = extentWgs84
  const topLeft = lonLatToTile(minLon, maxLat, zoom)
  const bottomRight = lonLatToTile(maxLon, minLat, zoom)

  const minX = Math.min(topLeft.x, bottomRight.x)
  const maxX = Math.max(topLeft.x, bottomRight.x)
  const minY = Math.min(topLeft.y, bottomRight.y)
  const maxY = Math.max(topLeft.y, bottomRight.y)

  return {
    minX,
    maxX,
    minY,
    maxY,
    tiles: collectTiles(minX, minY, maxX, maxY, zoom),
  }
}

export function lonLatToTile(lon: number, lat: number, zoom: number): TileCoordinate {
  const latRad = (lat * Math.PI) / 180
  const n = Math.pow(2, zoom)
  const x = Math.floor(((lon + 180) / 360) * n)
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  )
  return { x, y, z: zoom }
}

export function lonLatToTilePixel(lon: number, lat: number, zoom: number): TilePixelCoordinate {
  const latRad = (lat * Math.PI) / 180
  const n = Math.pow(2, zoom)
  const tileXFloat = ((lon + 180) / 360) * n
  const tileYFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n

  const x = Math.floor(tileXFloat)
  const y = Math.floor(tileYFloat)
  const pixelXFloat = (tileXFloat - x) * TILE_SIZE
  const pixelYFloat = (tileYFloat - y) * TILE_SIZE
  const pixelX = Math.min(TILE_SIZE - 1, Math.max(0, Math.round(pixelXFloat)))
  const pixelY = Math.min(TILE_SIZE - 1, Math.max(0, Math.round(pixelYFloat)))

  return {
    z: zoom,
    x,
    y,
    pixelX,
    pixelY,
    pixelXFloat,
    pixelYFloat,
    tileXFloat,
    tileYFloat,
  }
}

function collectTiles(minX: number, minY: number, maxX: number, maxY: number, zoom: number) {
  const tiles: TileCoordinate[] = []
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      tiles.push({ x, y, z: zoom })
    }
  }
  return tiles
}
