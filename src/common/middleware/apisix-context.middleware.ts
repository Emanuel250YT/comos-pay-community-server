import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { AppConfig } from '../../config/configuration';
import { GatewayConsumer } from '../interfaces/gateway-consumer.interface';

/**
 * Runs before any guard. It reads the consumer identity that APISIX forwards
 * (X-Consumer-Username / X-Credential-Identifier) and attaches it to the
 * request as `req.gatewayConsumer`. It does NOT decide whether the request is
 * allowed — that is ApisixGuard's job — it only normalizes the context so the
 * rest of the pipeline has a single source of truth.
 */
@Injectable()
export class ApisixContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ApisixContextMiddleware.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const { consumerHeader, credentialHeader } = this.config.get('apisix', {
      infer: true,
    });

    const username = this.firstHeader(req, consumerHeader);
    const credentialId = this.firstHeader(req, credentialHeader);

    if (username) {
      const consumer: GatewayConsumer = {
        username,
        credentialId: credentialId ?? null,
      };
      req.gatewayConsumer = consumer;
    }

    next();
  }

  /** Header values can arrive as string | string[]; collapse to the first string. */
  private firstHeader(req: Request, name: string): string | undefined {
    const raw = req.headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }
}
