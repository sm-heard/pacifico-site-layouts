import { Hono } from 'hono'
import { z } from 'zod'
import { logger } from '../lib/logger.js'
import { placeAssetsForRun, type LayoutOverrides } from '../services/layout.js'

const requestSchema = z.object({
  runId: z.string().min(1),
  params: z
    .object({
      maxSlopePercent: z.number().min(0).max(100).optional(),
    })
    .optional(),
})

export const layoutRoutes = new Hono()

layoutRoutes.post('/place', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.format() }, 400)
  }

  const { runId, params } = parsed.data

  try {
    const overrides: LayoutOverrides = params ?? {}
    const result = await placeAssetsForRun(runId, overrides)
    return c.json({ runId, ...result })
  } catch (error) {
    logger.error({ error, runId }, 'Failed to place assets')
    return c.json({ error: (error as Error).message ?? 'Failed to place assets' }, 500)
  }
})
