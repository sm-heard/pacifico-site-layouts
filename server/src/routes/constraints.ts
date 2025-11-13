import { Hono } from 'hono'
import { z } from 'zod'
import { buildConstraintsForRun } from '../services/constraints.js'
import { logger } from '../lib/logger.js'

const requestSchema = z.object({
  runId: z.string().min(1),
})

export const constraintRoutes = new Hono()

constraintRoutes.post('/build', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.format() }, 400)
  }

  const { runId } = parsed.data
  try {
    const result = await buildConstraintsForRun(runId)
    return c.json({ runId, ...result })
  } catch (error) {
    logger.error({ error, runId }, 'Failed to build constraints')
    return c.json({ error: (error as Error).message ?? 'Failed to build constraints' }, 500)
  }
})
