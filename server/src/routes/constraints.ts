import { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { buildConstraintsForRun, type ConstraintsOverrides } from '../services/constraints.js'
import { logger } from '../lib/logger.js'
import { readManifest, readRunMetadata, readNormalizedGeoJson, getRunFilePath } from '../lib/run-store.js'

const requestSchema = z.object({
  runId: z.string().min(1),
  params: z
    .object({
      maxSlopePercent: z.number().min(0).max(100).optional(),
      propertySetbackMeters: z.number().min(0).optional(),
    })
    .optional(),
})

export const constraintRoutes = new Hono()

constraintRoutes.post('/build', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.format() }, 400)
  }

  const { runId, params } = parsed.data
  try {
    const overrides: ConstraintsOverrides = params ?? {}
    const result = await buildConstraintsForRun(runId, overrides)
    return c.json({ runId, ...result })
  } catch (error) {
    logger.error({ error, runId }, 'Failed to build constraints')
    return c.json({ error: (error as Error).message ?? 'Failed to build constraints' }, 500)
  }
})

constraintRoutes.get('/:runId/overview', async (c) => {
  const runId = c.req.param('runId')
  try {
    const manifest = await readManifest(runId)
    if (!manifest?.constraints) {
      return c.json({ error: 'Constraints not generated for this run' }, 404)
    }

    const metadata = await readRunMetadata(runId)
    if (!metadata) {
      return c.json({ error: 'Run metadata missing' }, 404)
    }

    const normalized = await readNormalizedGeoJson(runId)
    const boundary = normalized.features.find((feature) => feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon')
    const entryPoints = normalized.features.filter((feature) => feature.geometry?.type === 'Point')
    const exclusions = normalized.features.filter(
      (feature) =>
        feature.geometry?.type === 'Polygon' ||
        feature.geometry?.type === 'MultiPolygon'
    ).filter((feature) => feature !== boundary)

    const baseMaskPngPath = manifest.constraints.baseMaskPngPath
    const distanceMaskPngPath = manifest.constraints.distanceMaskPngPath

    if (!baseMaskPngPath || !distanceMaskPngPath) {
      return c.json({ error: 'Constraint previews unavailable' }, 404)
    }

    const [baseMaskPng, distanceMaskPng] = await Promise.all([
      readFile(getRunFilePath(runId, baseMaskPngPath)),
      readFile(getRunFilePath(runId, distanceMaskPngPath)),
    ])

    return c.json({
      runId,
      grid: {
        width: metadata.grid.width,
        height: metadata.grid.height,
        resolution: metadata.grid.resolution,
        extentWgs84: metadata.grid.extentWgs84,
      },
      boundary,
      exclusions,
      entryPoints,
      baseMaskDataUrl: toDataUrl(baseMaskPng),
      distanceMaskDataUrl: toDataUrl(distanceMaskPng),
    })
  } catch (error) {
    logger.error({ error, runId }, 'Failed to fetch constraint overview')
    return c.json({ error: (error as Error).message ?? 'Failed to fetch constraints overview' }, 500)
  }
})

function toDataUrl(buffer: Buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`
}
