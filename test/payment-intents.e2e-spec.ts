import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Account, Horizon, Keypair } from '@stellar/stellar-sdk';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Full CRUD for Stellar payment intents behind the APISIX gate. Horizon and
 * Prisma are mocked so no real network or database is required; the Prisma mock
 * keeps a tiny in-memory store so create→read→update→delete stays consistent.
 */
describe('Payment intents CRUD (e2e)', () => {
  let app: INestApplication;

  const source = Keypair.random().publicKey();
  const destination = Keypair.random().publicKey();

  // Minimal in-memory store keyed by id.
  const store = new Map<string, any>();
  let seq = 0;

  const prismaMock = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    consumer: {
      upsert: jest.fn().mockResolvedValue({ id: 'c1', apisixUsername: 'cosmos_u1' }),
    },
    paymentIntent: {
      create: jest.fn(({ data }: any) => {
        const row = {
          id: `pi_${++seq}`,
          txHash: null,
          reference: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        store.set(row.id, row);
        return Promise.resolve(row);
      }),
      findMany: jest.fn(() => Promise.resolve([...store.values()])),
      count: jest.fn(() => Promise.resolve(store.size)),
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(store.get(where.id) ?? null),
      ),
      update: jest.fn(({ where, data }: any) => {
        const row = { ...store.get(where.id), ...data, updatedAt: new Date() };
        store.set(where.id, row);
        return Promise.resolve(row);
      }),
      delete: jest.fn(({ where }: any) => {
        const row = store.get(where.id);
        store.delete(where.id);
        return Promise.resolve(row);
      }),
    },
  };

  beforeAll(async () => {
    jest
      .spyOn(Horizon.Server.prototype, 'loadAccount')
      .mockResolvedValue(new Account(source, '123456789') as never);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => app.getHttpServer();
  const route = '/api/v1/payment-intents';
  const gw = (r: request.Test) =>
    r.set('x-gateway-secret', 'topsecret').set('x-consumer-username', 'cosmos_u1');

  let createdId: string;

  it('rejects creation without the gateway secret (403)', () =>
    request(http()).post(route).send({ source, destination, amount: '25.5' }).expect(403));

  it('rejects an invalid Stellar address (400)', () =>
    gw(request(http()).post(route).send({ source: 'bad', destination, amount: '1' })).expect(400));

  it('creates a payment intent (201) and persists it', async () => {
    const res = await gw(
      request(http()).post(route).send({ source, destination, amount: '25.5', memo: '123456789' }),
    ).expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('PENDING');
    expect(res.body.network).toBe('testnet');
    expect(res.body.uri).toContain('web+stellar:tx?xdr=');
    expect(res.body.qr).toContain('data:image/png;base64,');
    createdId = res.body.id;
  });

  it('lists the consumer payment intents (200)', async () => {
    const res = await gw(request(http()).get(route)).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('gets one by id (200)', async () => {
    const res = await gw(request(http()).get(`${route}/${createdId}`)).expect(200);
    expect(res.body.id).toBe(createdId);
    expect(res.body.qr).toContain('data:image/png;base64,');
  });

  it('updates status + txHash (200)', async () => {
    const res = await gw(
      request(http())
        .patch(`${route}/${createdId}`)
        .send({ status: 'SUBMITTED', txHash: 'abc123' }),
    ).expect(200);
    expect(res.body.status).toBe('SUBMITTED');
    expect(res.body.txHash).toBe('abc123');
  });

  it('404s an update on an unknown id', () =>
    gw(request(http()).patch(`${route}/nope`).send({ status: 'FAILED' })).expect(404));

  it('deletes one (200) and then 404s on read', async () => {
    await gw(request(http()).delete(`${route}/${createdId}`)).expect(200);
    await gw(request(http()).get(`${route}/${createdId}`)).expect(404);
  });
});
