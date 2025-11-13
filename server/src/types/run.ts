import type { LocalProjection } from '../lib/geo/crs.js'
import type { AlignedGrid } from '../lib/geo/grid.js'

export interface RunMetadata {
  boundaryBbox: [number, number, number, number]
  boundaryAreaSqMeters: number
  entryPointsCount: number
  exclusionsCount: number
  projection: LocalProjection
  grid: AlignedGrid
}
