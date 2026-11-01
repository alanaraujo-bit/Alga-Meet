import { RegisterDeviceBody, UploadKeyPackagesBody, type ClaimedKeyPackages, type E2eeDevice, type KeyPackagesUploaded } from '@alga/shared'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../app.js'
import { idParam, parse } from '../errors.js'

/** E2EE devices and key packages (contract in packages/shared/src/api.ts; logic in src/e2ee.ts). */
export function e2eeRoutes(app: FastifyInstance, { e2ee }: Ctx): void {
  const limited = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

  app.post('/e2ee/devices', limited, async (req, reply): Promise<E2eeDevice> => {
    const body = parse(RegisterDeviceBody, req.body)
    const { device, created } = await e2ee.registerDevice(req.auth.user.id, req.auth.sessionId, body)
    reply.code(created ? 201 : 200)
    return device
  })

  app.post<{ Params: { id: string } }>('/e2ee/devices/:id/key-packages', limited, async (req): Promise<KeyPackagesUploaded> => {
    const deviceId = idParam(req.params.id)
    const { keyPackages } = parse(UploadKeyPackagesBody, req.body)
    return { keyPackages: await e2ee.uploadKeyPackages(req.auth.user.id, req.auth.sessionId, deviceId, keyPackages) }
  })

  app.get<{ Params: { userId: string } }>('/e2ee/users/:userId/key-packages', limited, async (req): Promise<ClaimedKeyPackages> =>
    e2ee.claimForUser(req.auth.user.id, idParam(req.params.userId)))

  app.delete<{ Params: { id: string } }>('/e2ee/devices/:id', limited, async (req, reply) => {
    await e2ee.deleteDevice(req.auth.user.id, idParam(req.params.id))
    reply.code(204)
  })
}
