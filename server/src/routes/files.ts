import { Hono } from 'hono'
import { readFile, stat } from 'node:fs/promises'
import { basename, normalize } from 'node:path'

import { getRunFilePath, getRunPath } from '../lib/run-store.js'

export const filesRoutes = new Hono()

filesRoutes.get('/:runId/*', async (c) => {
  const runId = c.req.param('runId')
  const wildcard = c.req.param('*')

  if (!wildcard) {
    return c.json({ error: 'Missing file path' }, 400)
  }

  const safeSegments = wildcard
    .split(/[/\\]+/)
    .filter((segment) => segment && segment !== '.')

  if (safeSegments.some((segment) => segment === '..')) {
    return c.json({ error: 'Invalid path' }, 400)
  }

  const relativePath = safeSegments.join('/')
  const baseDir = getRunPath(runId)
  const absolute = getRunFilePath(runId, relativePath)
  const normalizedAbsolute = normalize(absolute)
  if (!normalizedAbsolute.startsWith(normalize(baseDir))) {
    return c.json({ error: 'Path outside run directory' }, 403)
  }

  try {
    const stats = await stat(normalizedAbsolute)
    if (!stats.isFile()) {
      return c.json({ error: 'Not a file' }, 404)
    }

    const data = await readFile(normalizedAbsolute)
    const contentType = lookupContentType(relativePath)
    const headers = new Headers({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${basename(relativePath)}"`,
    })
    return new Response(data, { headers })
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err?.code === 'ENOENT') {
      return c.json({ error: 'File not found' }, 404)
    }
    return c.json({ error: 'Failed to read file' }, 500)
  }
})

function lookupContentType(path: string) {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'json':
      return 'application/json'
    case 'geojson':
      return 'application/geo+json'
    case 'png':
      return 'image/png'
    case 'kmz':
      return 'application/vnd.google-earth.kmz'
    case 'kml':
      return 'application/vnd.google-earth.kml+xml'
    case 'pdf':
      return 'application/pdf'
    case 'zip':
      return 'application/zip'
    case 'bin':
      return 'application/octet-stream'
    default:
      return 'application/octet-stream'
  }
}
