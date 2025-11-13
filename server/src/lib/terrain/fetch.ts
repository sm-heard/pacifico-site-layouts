import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { logger } from '../logger.js'
import { env } from '../../config/env.js'
import { getTerrainCachePath } from '../run-store.js'
import type { TileCoordinate } from './tile-math.js'

export interface TerrainTileData {
  tile: TileCoordinate
  path: string
  buffer: Buffer
  fromCache: boolean
}

const MAPBOX_TILE_ENDPOINT = 'https://api.mapbox.com/v4'

async function fetchTileFromSource(tile: TileCoordinate): Promise<Buffer> {
  if (!env.MAPBOX_ACCESS_TOKEN) {
    throw new Error('MAPBOX_ACCESS_TOKEN is not configured')
  }

  const url = `${MAPBOX_TILE_ENDPOINT}/mapbox.terrain-rgb/${tile.z}/${tile.x}/${tile.y}.pngraw?access_token=${env.MAPBOX_ACCESS_TOKEN}`
  const response = await fetch(url)
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to fetch terrain tile ${tile.z}/${tile.x}/${tile.y}: ${response.status} ${response.statusText} ${text}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export async function loadTerrainTile(tile: TileCoordinate): Promise<TerrainTileData> {
  const path = getTerrainCachePath(tile.z, tile.x, tile.y)
  try {
    const buffer = await readFile(path)
    return { tile, path, buffer, fromCache: true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  const buffer = await fetchTileFromSource(tile)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, buffer)
  logger.debug({ tile, path }, 'Cached terrain tile')
  return { tile, path, buffer, fromCache: false }
}
