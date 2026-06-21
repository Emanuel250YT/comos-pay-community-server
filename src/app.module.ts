import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { ApisixGuard } from './common/guards/apisix.guard';
import { ApisixContextMiddleware } from './common/middleware/apisix-context.middleware';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { PaymentIntentsModule } from './payment-intents/payment-intents.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
    }),
    PrismaModule,
    HealthModule,
    PaymentIntentsModule,
  ],
  providers: [
    // Enforce the "only APISIX" check on every route by default.
    // Routes opt out with @Public().
    {
      provide: APP_GUARD,
      useClass: ApisixGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Attach the gateway consumer context to every request before guards run.
    consumer.apply(ApisixContextMiddleware).forRoutes('*');
  }
}
