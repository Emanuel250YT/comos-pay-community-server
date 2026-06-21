import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Structured per-request access log, including the resolved gateway consumer
 * (when present) so payment activity is traceable to an APISIX consumer.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const { method, url } = request;
    const startedAt = process.hrtime.bigint();
    const consumer = request.gatewayConsumer?.username ?? 'anonymous';

    return next.handle().pipe(
      tap(() => {
        const elapsedMs =
          Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        this.logger.log(
          `${method} ${url} ${response.statusCode} ${elapsedMs.toFixed(1)}ms consumer=${consumer}`,
        );
      }),
    );
  }
}
