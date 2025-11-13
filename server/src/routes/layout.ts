import { Hono } from 'hono'
import { z } from 'zod'
import { logger } from '../lib/logger.js'
import { placeAssetsForRun } from '../services/layout.js'

const requestSchema = z.object({
  runId: z.string().min(1),
})

export const layoutRoutes = new Hono()

layoutRoutes.post('/place', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.format() }, 400)
  }

  const { runId } = parsed.data

  try {
    const result = await placeAssetsForRun(runId)
    return c.json({ runId, ...result })
  } catch (error) {
    logger.error({ error, runId }, 'Failed to place assets')
    return c.json({ error: (error as Error).message ?? 'Failed to place assets' }, 500)
  }
})
