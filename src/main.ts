import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });
  const logger = new Logger('Bootstrap');
  const config = app.get(ConfigService<AppConfig, true>);

  // Security headers. The service sits behind APISIX, but defense in depth.
  app.use(helmet());

  // We trust the gateway's X-Forwarded-* headers for client IP / proto.
  app.set('trust proxy', 1);

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // OpenAPI docs + raw spec (/docs, /docs/json, /docs/yaml).
  // Handy in dev; lock down or disable in prod as needed.
  if (config.get('nodeEnv', { infer: true }) !== 'production') {
    setupSwagger(app);
  }

  app.enableShutdownHooks();

  const port = config.get('port', { infer: true });
  await app.listen(port);
  logger.log(`Cosmos Pay payments service listening on port ${port}`);
}

void bootstrap();
