import { prisma } from '../db.js'
import pino from 'pino'

let wsGatewayRef: any = null

export function setErrorLoggerGateway(gateway: any) {
  wsGatewayRef = gateway
}

export interface CaptureOpts {
  level?: 'error' | 'warn' | 'critical'
  component: string
  message: string
  stack?: string
  metadata?: any
  requestId?: string
  userId?: string
}

const logger = pino(
  process.env.NODE_ENV === 'production'
    ? { level: process.env.LOG_LEVEL || 'info' }
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }
).child({ component: 'SystemErrorLogger' })

export async function captureSystemError(opts: CaptureOpts) {
  const level = opts.level || 'error'
  try {
    const record = await prisma.systemError.create({
      data: {
        level,
        component: opts.component,
        message: opts.message,
        stack: opts.stack || null,
        metadata: opts.metadata || null,
        requestId: opts.requestId || null,
        userId: opts.userId || null,
      },
    })

    if (wsGatewayRef?.pushToAdminSubscribers) {
      wsGatewayRef.pushToAdminSubscribers('system_error', {
        type: 'system_error',
        error: record,
        timestamp: new Date().toISOString(),
      })
    }

    return record
  } catch (err) {
    // Intentionally not calling captureSystemError here to avoid infinite loop
    logger.error({ err, opts }, 'Failed to capture system error')
  }
}

export async function wrapAsync<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (error: any) {
    await captureSystemError({
      level: 'error',
      component: name,
      message: error?.message || String(error),
      stack: error?.stack,
    })
    return undefined
  }
}
