import { basename, join, relative } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { bbox as turfBbox, area as turfArea } from '@turf/turf'
import type { FeatureCollection } from 'geojson'

import { logger } from '../lib/logger.js'
import {
  createRunScaffold,
  generateRunId,
  getRunPath,
  writeManifest,
} from '../lib/run-store.js'
import { parseSpatialUpload } from '../lib/kml.js'
import { determineLocalProjection } from '../lib/geo/crs.js'
import { normalizeInputs } from '../lib/geo/geojson.js'
import { computeAlignedGrid, recommendGridResolution } from '../lib/geo/grid.js'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB

async function extractUploadFile(c: Context) {
  const body = await c.req.parseBody()
  const maybeFile = body.file ?? body.upload ?? Object.values(body).find((value) => value instanceof File)

  if (!(maybeFile instanceof File)) {
    throw new Error('Missing file upload. Expected multipart/form-data with a file field.')
  }

  const arrayBuffer = await maybeFile.arrayBuffer()
  if (arrayBuffer.byteLength === 0) {
    throw new Error('Uploaded file was empty.')
  }
  if (arrayBuffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error('Uploaded file exceeds the 50 MB limit.')
  }

  return {
    buffer: Buffer.from(arrayBuffer),
    filename: maybeFile.name,
    mimeType: maybeFile.type,
  }
}

async function persistInputs(runId: string, filename: string | undefined, rawBuffer: Buffer) {
  const inputsDir = getRunPath(runId, 'inputs')
  const safeName = filename ? basename(filename) : 'upload'
  const originalPath = join(inputsDir, safeName)
  await writeFile(originalPath, rawBuffer)
  return { originalPath }
}

async function persistNormalizedGeoJSON(
  runId: string,
  collection: FeatureCollection,
): Promise<string> {
  const inputsDir = getRunPath(runId, 'inputs')
  const normalizedPath = join(inputsDir, 'normalized.geojson')
  await writeFile(normalizedPath, JSON.stringify(collection, null, 2), 'utf-8')
  return normalizedPath
}

export const ingestRoutes = new Hono()

ingestRoutes.post('/upload', async (c) => {
  const runId = generateRunId()
  logger.info({ runId }, 'Starting ingest upload')

  try {
    await createRunScaffold(runId)
    const { buffer, filename, mimeType } = await extractUploadFile(c)

    const parsed = await parseSpatialUpload(buffer, filename, mimeType)
    const normalized = normalizeInputs(parsed.featureCollection)

    const normalizedCollection: FeatureCollection = {
      type: 'FeatureCollection',
      features: parsed.featureCollection.features,
    }

    const boundaryBbox = turfBbox(normalized.boundary)
    const boundaryAreaSqMeters = Math.abs(turfArea(normalized.boundary))
    const projection = determineLocalProjection(normalized.boundary)
    const recommendedResolution = recommendGridResolution(boundaryAreaSqMeters)
    const grid = computeAlignedGrid(normalized.boundary, recommendedResolution, {
      projection,
    })

    const normalizedPath = await persistNormalizedGeoJSON(runId, normalizedCollection)
    const manifest = {
      id: runId,
      createdAt: new Date().toISOString(),
      status: 'pending' as const,
      inputs: {
        originalFilename: filename,
        normalizedGeoJsonPath: relative(getRunPath(runId), normalizedPath),
        boundaryAreaSqMeters,
        entryPointsCount: normalized.entryPoints.length,
        exclusionsCount: normalized.exclusions.length,
      },
      parameters: {
        recommendedResolutionMeters: grid.resolution,
        pixelWidth: grid.width,
        pixelHeight: grid.height,
        pixelCount: grid.pixelCount,
        paddingMeters: grid.paddingMeters,
      },
    }

    await persistInputs(runId, filename, buffer)
    await writeFile(
      join(getRunPath(runId, 'inputs'), 'metadata.json'),
      JSON.stringify(
        {
          boundaryBbox,
          boundaryAreaSqMeters,
          entryPointsCount: normalized.entryPoints.length,
          exclusionsCount: normalized.exclusions.length,
          projection,
          grid,
        },
        null,
        2,
      ),
      'utf-8',
    )

    await writeManifest(runId, manifest)

    logger.info({ runId }, 'Upload processed successfully')
    return c.json(
      {
        runId,
        boundaryAreaSqMeters,
        boundaryBbox,
        entryPointsCount: normalized.entryPoints.length,
        exclusionsCount: normalized.exclusions.length,
        projection,
        grid: {
          resolution: grid.resolution,
          width: grid.width,
          height: grid.height,
          pixelCount: grid.pixelCount,
          extentWgs84: grid.extentWgs84,
        },
        hasEntryPoint: normalized.entryPoints.length > 0,
        notes:
          normalized.entryPoints.length === 0
            ? 'No entry points detected. User must select an entry before routing.'
            : undefined,
        source: {
          filename,
          mimeType,
          type: parsed.sourceType,
        },
      },
      201,
    )
  } catch (error) {
    logger.error({ error, runId }, 'Failed to process upload')
    return c.json({
      error: (error as Error).message ?? 'Failed to process upload',
    }, 400)
  }
})
