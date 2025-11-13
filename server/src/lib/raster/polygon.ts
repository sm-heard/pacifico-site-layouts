import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import { toLocalMeters, type LocalProjection } from '../geo/crs.js'
import type { AlignedGrid } from '../geo/grid.js'

interface LocalRing {
  points: [number, number][]
}

interface LocalPolygon {
  outer: LocalRing
  holes: LocalRing[]
  bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  }
}

export function rasterizePolygonFeature(
  feature: Feature<Polygon | MultiPolygon>,
  grid: AlignedGrid,
  projection: LocalProjection,
): Uint8Array {
  const mask = new Uint8Array(grid.width * grid.height)
  const polygons = geometryToLocalPolygons(feature.geometry, projection)

  for (const poly of polygons) {
    paintPolygon(poly, grid, mask)
  }

  return mask
}

function geometryToLocalPolygons(
  geometry: Polygon | MultiPolygon,
  projection: LocalProjection,
): LocalPolygon[] {
  if (geometry.type === 'Polygon') {
    return [polygonToLocalPolygon(geometry.coordinates, projection)]
  }

  return geometry.coordinates.map((polygon) => polygonToLocalPolygon(polygon, projection))
}

function polygonToLocalPolygon(
  coordinates: Position[][],
  projection: LocalProjection,
): LocalPolygon {
  if (coordinates.length === 0) {
    throw new Error('Polygon coordinates were empty')
  }

  const outer = toLocalRing(coordinates[0], projection)
  const holes = coordinates.slice(1).map((ring) => toLocalRing(ring, projection))
  const bounds = computeBounds(outer.points)

  return {
    outer,
    holes,
    bounds,
  }
}

function toLocalRing(coordinates: Position[], projection: LocalProjection): LocalRing {
  const points = coordinates.map((coord) => toLocalMeters([coord[0], coord[1]], projection))
  return { points: closeRing(points) }
}

function closeRing(points: [number, number][]) {
  if (points.length === 0) return points
  const first = points[0]
  const last = points[points.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) {
    return points
  }
  return [...points, first]
}

function computeBounds(points: [number, number][]) {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  return { minX, maxX, minY, maxY }
}

function paintPolygon(poly: LocalPolygon, grid: AlignedGrid, mask: Uint8Array) {
  const { resolution, origin, width, height } = grid
  const minCol = Math.max(0, Math.floor((poly.bounds.minX - origin[0]) / resolution))
  const maxCol = Math.min(width - 1, Math.ceil((poly.bounds.maxX - origin[0]) / resolution))
  const minRow = Math.max(0, Math.floor((poly.bounds.minY - origin[1]) / resolution))
  const maxRow = Math.min(height - 1, Math.ceil((poly.bounds.maxY - origin[1]) / resolution))

  for (let row = minRow; row <= maxRow; row += 1) {
    const y = origin[1] + (row + 0.5) * resolution
    for (let col = minCol; col <= maxCol; col += 1) {
      const x = origin[0] + (col + 0.5) * resolution
      const index = row * width + col
      if (pointInPolygon(x, y, poly)) {
        mask[index] = 1
      }
    }
  }
}

function pointInPolygon(x: number, y: number, poly: LocalPolygon) {
  if (!isPointInRing(x, y, poly.outer.points)) {
    return false
  }

  for (const hole of poly.holes) {
    if (isPointInRing(x, y, hole.points)) {
      return false
    }
  }

  return true
}

function isPointInRing(x: number, y: number, ring: [number, number][]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]

    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0000001) + xi
    if (intersects) inside = !inside
  }
  return inside
}
