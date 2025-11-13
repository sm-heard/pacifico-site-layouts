import { Hono } from 'hono'

import { readManifest } from '../lib/run-store.js'

export const runsRoutes = new Hono()

runsRoutes.get('/:runId/manifest', async (c) => {
  const runId = c.req.param('runId')
  const manifest = await readManifest(runId)
  if (!manifest) {
    return c.json({ error: 'Run not found' }, 404)
  }
  return c.json({ runId, manifest })
})
