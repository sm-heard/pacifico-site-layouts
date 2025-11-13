import { env } from './env.js'

const defaultOrigins = ['http://localhost:5173']

export function allowedOrigins() {
  const fromEnv = env.CORS_ALLOW_ORIGINS
  if (!fromEnv) return defaultOrigins
  return fromEnv.split(',').map((origin) => origin.trim()).filter(Boolean)
}
