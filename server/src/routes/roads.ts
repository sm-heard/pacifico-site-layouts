import { Hono } from 'hono'
import { z } from 'zod'
import { logger } from '../lib/logger.js'
import { buildRoadsForRun, type RoadOverrides } from '../services/roads.js'

const requestSchema = z.object({
  runId: z.string().min(1),
  params: z
    .object({
      widthMeters: z.number().min(1).optional(),
      maxGradePercent: z.number().min(0).max(100).optional(),
    })
    .optional(),
})

export const roadRoutes = new Hono()

roadRoutes.post('/build', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.format() }, 400)
  }

  const { runId, params } = parsed.data

  try {
    const overrides: RoadOverrides = params ?? {}
    const result = await buildRoadsForRun(runId, overrides)
    return c.json({ runId, ...result })
  } catch (error) {
    logger.error({ error, runId }, 'Failed to build roads')
    return c.json({ error: (error as Error).message ?? 'Failed to build roads' }, 500)
  }
})
