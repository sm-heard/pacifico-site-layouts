import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, beforeEach, afterEach, it, vi } from 'vitest'
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson'
import { area as turfArea, bbox as turfBbox } from '@turf/turf'

import { ASSET_TYPES } from '../../config/assets.js'

const ENTRY_POINT_PROPERTIES = { kind: 'entry' }

describe('end-to-end services', () => {
  let dataDir: string

  beforeEach(async () => {
    vi.resetModules()
    dataDir = await mkdtemp(join(tmpdir(), 'pacifico-test-'))
    process.env.DATA_DIR = dataDir
    process.env.MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN ?? 'test-token'
    const { ensureDataRoots } = await import('../../lib/run-store.js')
    await ensureDataRoots()
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('builds constraints, places assets, and routes roads on synthetic data', async () => {
    const { createRunScaffold, getRunPath, writeManifest } = await import('../../lib/run-store.js')
    const { determineLocalProjection } = await import('../../lib/geo/crs.js')
    const { computeAlignedGrid } = await import('../../lib/geo/grid.js')
    const { buildConstraintsForRun } = await import('../constraints.js')
    const { placeAssetsForRun } = await import('../layout.js')
    const { buildRoadsForRun } = await import('../roads.js')

    const runId = 'integration-run'
    await createRunScaffold(runId)
    const runPath = getRunPath(runId)

    const boundary: Feature<Polygon> = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-119.8, 35.0],
          [-119.8, 35.01],
          [-119.79, 35.01],
          [-119.79, 35.0],
          [-119.8, 35.0],
        ]],
      },
      properties: {},
    }

    const entryPoint: Feature<Point> = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [-119.7995, 35.0005],
      },
      properties: ENTRY_POINT_PROPERTIES,
    }

    const normalized: FeatureCollection = {
      type: 'FeatureCollection',
      features: [boundary, entryPoint],
    }

    const projection = determineLocalProjection(boundary)
    const grid = computeAlignedGrid(boundary, 10, { projection, paddingPixels: 2 })
    const totalCells = grid.width * grid.height
    const boundaryAreaSqMeters = turfArea(boundary)
    const metadata = {
      boundaryBbox: turfBbox(boundary) as [number, number, number, number],
      boundaryAreaSqMeters,
      entryPointsCount: 1,
      exclusionsCount: 0,
      projection,
      grid,
    }

    await writeFile(
      join(runPath, 'inputs', 'normalized.geojson'),
      JSON.stringify(normalized, null, 2),
      'utf-8',
    )
    await writeFile(
      join(runPath, 'inputs', 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf-8',
    )

    const zeros = new Float32Array(totalCells).fill(0)
    const gentleSlope = new Float32Array(totalCells).fill(4)

    await writeFloat32(join(runPath, 'dem', 'dem.bin'), zeros)
    await writeFloat32(join(runPath, 'dem', 'slope-percent.bin'), gentleSlope)
    await writeFloat32(join(runPath, 'dem', 'slope-deg.bin'), zeros)
    await writeFloat32(join(runPath, 'dem', 'aspect-deg.bin'), zeros)

    await writeFile(
      join(runPath, 'dem', 'dem.json'),
      JSON.stringify({ runId, grid, zoom: 15 }, null, 2),
      'utf-8',
    )

    await writeManifest(runId, {
      id: runId,
      createdAt: new Date().toISOString(),
      status: 'pending',
      inputs: {
        originalFilename: 'synthetic.kmz',
        normalizedGeoJsonPath: 'inputs/normalized.geojson',
        boundaryAreaSqMeters,
        entryPointsCount: 1,
        exclusionsCount: 0,
      },
      terrain: {
        demPath: 'dem/dem.bin',
        metadataPath: 'dem/dem.json',
        slopeDegreesPath: 'dem/slope-deg.bin',
        slopePercentPath: 'dem/slope-percent.bin',
        aspectDegreesPath: 'dem/aspect-deg.bin',
        zoom: 15,
        tileCount: 1,
        resolutionMeters: grid.resolution,
        minElevation: 0,
        maxElevation: 0,
        meanElevation: 0,
        missingCells: 0,
        validCells: totalCells,
        slopeMinDegrees: 0,
        slopeMaxDegrees: 0,
        slopeMeanDegrees: 0,
      },
    })

    const constraints = await buildConstraintsForRun(runId)
    expect(constraints.baseFeasibleCells).toBeGreaterThan(0)
    expect(constraints.assetMasks.length).toBeGreaterThan(0)
    await expect(stat(join(runPath, 'masks', 'base-mask.bin'))).resolves.toBeDefined()

    const layout = await placeAssetsForRun(runId)
    expect(layout.placedAssets.length).toBeGreaterThan(0)
    expect(layout.placedAssets.length).toBe(ASSET_TYPES.length)
    await expect(stat(join(runPath, 'layout', 'assets.geojson'))).resolves.toBeDefined()

    const roads = await buildRoadsForRun(runId)
    expect(roads.segments.length).toBe(layout.placedAssets.length)
    expect(roads.totalLengthMeters).toBeGreaterThan(0)
    roads.segments.forEach((segment) => {
      expect(segment.maxGradePercent).toBeLessThan(10.01)
      expect(segment.meanGradePercent).toBeLessThan(10.01)
    })
    await expect(stat(join(runPath, 'roads', 'centerlines.geojson'))).resolves.toBeDefined()
    await expect(stat(join(runPath, 'roads', 'corridors.geojson'))).resolves.toBeDefined()
  })
})

async function writeFloat32(path: string, data: Float32Array) {
  await writeFile(path, Buffer.from(data.buffer, data.byteOffset, data.byteLength))
}
