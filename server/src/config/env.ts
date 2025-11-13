import { resolve } from 'node:path'
import { config as loadEnvFile } from 'dotenv'
import { z } from 'zod'

const envFiles = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../.env'),
]

for (const file of envFiles) {
  loadEnvFile({ path: file, override: false })
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  MAPBOX_ACCESS_TOKEN: z.string().optional(),
  DATA_DIR: z.string().default('../data'),
  CORS_ALLOW_ORIGINS: z.string().optional(),
})

const parsed = envSchema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN,
  DATA_DIR: process.env.DATA_DIR,
})

if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.format())
  throw new Error('Failed to parse environment variables')
}

const raw = parsed.data

export const env = {
  ...raw,
  dataDir: resolve(process.cwd(), raw.DATA_DIR),
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
}

if (!raw.MAPBOX_ACCESS_TOKEN && !env.isTest) {
  console.warn('[config] MAPBOX_ACCESS_TOKEN is not set. Terrain fetches will fail until provided.')
}
