# Cosmos Pay — Payments Microservice

Payments microservice built with **NestJS 11** + **Prisma 6 (PostgreSQL)**.

It is a *separate* application from the Cosmos developer platform (`paydev`). The
dev platform only **issues** APISIX access tokens (consumers + `key-auth`
credentials) for downstream services. This service is one of those downstream
services: it sits **behind APISIX**, which load-balances and authenticates every
request before forwarding it here. The service therefore never sees raw API keys
— it only trusts what the gateway forwards.

## How "only APISIX" is enforced

A request is accepted only when **both** conditions hold (see
`src/common/guards/apisix.guard.ts`):

1. **Gateway shared secret.** The request carries `X-Gateway-Secret`, compared in
   constant time against `APISIX_GATEWAY_SECRET`. APISIX *injects* this header on
   every proxied request and *strips* any client-supplied copy, so a correct
   value can only originate from the gateway. (Defense in depth — pair it with
   network isolation so the service is not directly reachable.)
2. **Authenticated consumer.** APISIX's `key-auth` plugin, after validating the
   caller's API key, forwards `X-Consumer-Username` (and
   `X-Credential-Identifier`). The guard requires the consumer header to be
   present, proving the key was authenticated upstream.

Routes can opt out with `@Public()` (used by the health probes the orchestrator
hits directly). Local development can disable enforcement entirely with
`ENFORCE_GATEWAY=false`.

The pipeline:

```
request → ApisixContextMiddleware  (reads consumer headers → req.gatewayConsumer)
        → ApisixGuard (APP_GUARD)  (verifies secret + consumer, or @Public bypass)
        → ValidationPipe           (DTO validation)
        → Controller / Service     (@CurrentConsumer() gives the consumer)
```

## Project layout

```
src/
  main.ts                         bootstrap: helmet, global prefix /api, URI versioning, swagger
  app.module.ts                   wires config, prisma, guard (global) and middleware
  config/
    configuration.ts              typed config
    env.validation.ts             fail-fast env validation (secret required when enforcing)
  prisma/                         PrismaModule + PrismaService (global)
  common/
    guards/apisix.guard.ts        THE gateway gate
    middleware/apisix-context...  extracts consumer identity from gateway headers
    decorators/                   @Public(), @CurrentConsumer()
    filters/                      consistent error responses
    interceptors/                 structured access logging
    interfaces/                   GatewayConsumer + Express Request augmentation
    validators/                   IsStellarAddress (StrKey-based)
  payment-intents/                Stellar payment intents (controller, service, DTO)
  health/                         liveness/readiness probes (@Public)
prisma/schema.prisma              Consumer model (keyed to the APISIX consumer)
test/                             e2e suite proving the gateway gate
```

## API

All routes are versioned under `/api/v1` (URI versioning).

| Method | Path                          | Description                                  |
| ------ | ----------------------------- | -------------------------------------------- |
| POST   | `/api/v1/payment-intents`     | Create a Stellar payment intent (persisted)  |
| GET    | `/api/v1/payment-intents`     | List the consumer's intents (`?status&take&skip`) |
| GET    | `/api/v1/payment-intents/:id` | Get one intent by id                         |
| PATCH  | `/api/v1/payment-intents/:id` | Update status / txHash / reference           |
| DELETE | `/api/v1/payment-intents/:id` | Delete an intent                             |
| GET    | `/api/v1/health/liveness`     | Liveness (public)                            |
| GET    | `/api/v1/health/readiness`    | Readiness incl. DB (public)                  |

Every intent is **persisted** (`payment_intent` table) and scoped to the
authenticated APISIX consumer, so reads/updates/deletes only ever touch that
consumer's own records — full traceability of each intent's lifecycle
(`PENDING → SUBMITTED → SUCCEEDED/FAILED/CANCELLED/EXPIRED`).

### OpenAPI / Swagger

Live (non-production), served by the app:

- `GET /docs` — Swagger UI
- `GET /docs/json` — OpenAPI 3.0 spec (JSON)
- `GET /docs/yaml` — OpenAPI 3.0 spec (YAML)

Export the spec to files (so another server can host/consume it) — no database
required, runs in Nest preview mode:

```bash
npm run openapi:generate
# writes openapi/openapi.json and openapi/openapi.yaml
```

Paths in the spec already include the prefix + version (`/api/v1/...`). To stamp
a concrete gateway host into the spec's `servers`, set `OPENAPI_SERVER_URL`
before generating:

```bash
OPENAPI_SERVER_URL=https://gateway.example.com npm run openapi:generate
```

The Swagger config (`src/swagger.ts`) is shared by the running server and the
generator, so both stay in sync. The two APISIX headers (`X-Gateway-Secret`,
`X-Consumer-Username`) are documented as security schemes in the spec.

### POST /api/v1/payment-intents

Builds an **unsigned** XLM payment transaction that the customer signs in their
wallet. The service holds no keys — it only assembles the intent.

Request body:

```jsonc
{
  "source": "G...",        // customer's Stellar account (payer)
  "destination": "G...",   // merchant's Stellar account (payee)
  "amount": "25.5",         // XLM, decimal string (≤ 7 decimals)
  "memo": "123456789"       // optional numeric memo id (uint64 as string)
}
```

Response:

```jsonc
{
  "id": "clx...",                          // persisted intent id
  "status": "PENDING",
  "network": "testnet",
  "source": "G...",
  "destination": "G...",
  "amount": "25.5",
  "memo": "123456789",
  "xdr": "AAAA...",                       // unsigned transaction envelope
  "uri": "web+stellar:tx?xdr=...",        // SEP-7 deep link
  "qr": "data:image/png;base64,...",       // QR of the SEP-7 URI (derived from uri)
  "createdAt": "2026-...",
  "updatedAt": "2026-..."
}
```

Network/Horizon/fee/timeout are configured via `STELLAR_*` env vars
(see `.env.example`). Defaults to **testnet** for safety — set
`STELLAR_NETWORK=public` for mainnet (real funds).

## Getting started

```bash
cp .env.example .env          # set DATABASE_URL and a strong APISIX_GATEWAY_SECRET
npm install
npm run db:generate           # prisma generate
npm run db:migrate            # create the schema (needs a running Postgres)
npm run start:dev
```

Generate a secret:

```bash
openssl rand -hex 32
```

Run the tests (no DB needed — Prisma is mocked):

```bash
npm run test:e2e
```

## APISIX route configuration

The dev platform's route helper (`paydev/src/utils/apisix.ts`) already converts
`Authorization: Bearer <token>` into the `apikey` header, validates `key-auth`,
and strips credentials before proxying. To point a route at this service, add the
**gateway secret injection** to the `proxy-rewrite` plugin so the header arrives
here — and remove any client-supplied copy:

```jsonc
"proxy-rewrite": {
  "regex_uri": ["^/payments-api/(.*)", "/api/v1/$1"],
  "headers": {
    "set": {
      // must equal APISIX_GATEWAY_SECRET in this service's environment
      "X-Gateway-Secret": "<the-shared-secret>"
    },
    "remove": ["Authorization", "apikey", "X-API-KEY"]
  }
}
```

`key-auth` already forwards `X-Consumer-Username` / `X-Credential-Identifier`
to the upstream after a successful auth, which the guard relies on.

> Keep the service on a private network so the only reachable path is through
> APISIX; the shared secret is the second layer, not the only one.
