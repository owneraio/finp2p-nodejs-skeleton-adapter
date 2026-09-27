import express, { Application } from 'express'
import { Server } from 'http'
import axios from 'axios'
import { register } from '../../src/routes'
import {
  CommonService, EscrowService, HealthService, PaymentService, PlanApprovalService, TokenService,
} from '../../src/models'

// Express 4, installed under an alias: the adapter creates the app, and some adapters still create it with 4.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const express4: typeof express = require('express4')

/**
 * The routes are bare async handlers. Express 5 hands a rejection to the
 * error handler; Express 4 does not, and the unhandled rejection ended the
 * process, so one failing request took an adapter on Express 4 down. The
 * same routes must answer with an error on either.
 */
describe.each([
  ['Express 4', express4],
  ['Express 5', express],
])('route errors on %s', (_name, createExpress) => {
  let server: Server
  let base: string

  beforeAll(async () => {
    const tokenService = {
      getBalance: async () => { throw new Error('ledger unreachable') },
    } as unknown as TokenService
    const healthService: HealthService = { liveness: async () => undefined, readiness: async () => undefined }
    const app: Application = createExpress()
    app.use(createExpress.json())
    register(app, tokenService, {} as EscrowService, {} as CommonService, healthService, {} as PaymentService, {} as PlanApprovalService)
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address()
        base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>(r => server.close(() => r()))
  })

  // validateStatus keeps 4xx/5xx as ordinary responses; the timeout turns a hung request into a failure.
  const call = (method: string, url: string, data?: unknown) =>
    axios.request({ method, url: `${base}${url}`, data, timeout: 5000, validateStatus: () => true } as any)

  it('answers a service that throws with 500 and keeps serving', async () => {
    const res = await call('post', '/api/assets/getBalance', { owner: { finId: 'f', asset: { type: 'finp2p', resourceId: 'bank-x:102:asset-1' } } })
    expect(res.status).toBe(500)
    expect(res.data).toEqual({ error: 'Internal Server Error' })

    expect((await call('get', '/health')).status).toBe(200)
  })

  it('answers a route the skeleton always refuses with 501', async () => {
    const res = await call('post', '/api/accounts/any/proof')
    expect(res.status).toBe(501)
    expect(res.data).toEqual({ errors: [{ code: 0, message: expect.stringContaining('not supported') }] })
  })
})
