import pino from 'pino'
import { env } from '../config/env.js'

const level = env.isProduction ? 'info' : 'debug'

export const logger = pino({
  level,
  transport: env.isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
})
