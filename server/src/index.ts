import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import { env } from './config/env.js'
import { allowedOrigins } from './config/cors.js'
import { logger } from './lib/logger.js'
import { ensureDataRoots } from './lib/run-store.js'
import { ingestRoutes } from './routes/ingest.js'
import { terrainRoutes } from './routes/terrain.js'
import { constraintRoutes } from './routes/constraints.js'
import { layoutRoutes } from './routes/layout.js'
import { roadRoutes } from './routes/roads.js'

const app = new Hono()

const origins = allowedOrigins()

app.use('*', async (c, next) => {
  const origin = c.req.header('origin')
  if (origin && origins.includes(origin)) {
    c.res.headers.set('Access-Control-Allow-Origin', origin)
    c.res.headers.set('Vary', 'Origin')
  }
  if (c.req.method === 'OPTIONS') {
    c.res.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    c.res.headers.set('Access-Control-Max-Age', '86400')
    return c.body(null, 204)
  }
  await next()
})

app.get('/healthz', (c) => c.json({ status: 'ok', service: 'pacifico-layouts', time: new Date().toISOString() }))

app.route('/api/ingest', ingestRoutes)
app.route('/api/terrain', terrainRoutes)
app.route('/api/constraints', constraintRoutes)
app.route('/api/layout', layoutRoutes)
app.route('/api/roads', roadRoutes)

app.all('*', (c) => c.json({ error: 'Not Found' }, 404))

async function start() {
  await ensureDataRoots()

  serve(
    {
      fetch: app.fetch,
      port: env.PORT,
    },
    (info) => {
      logger.info(`Server is running on http://localhost:${info.port}`)
    },
  )
}

start().catch((error) => {
  logger.error({ error }, 'Failed to start server')
  process.exit(1)
})
