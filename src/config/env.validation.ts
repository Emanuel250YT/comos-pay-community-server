import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

/**
 * Schema used by ConfigModule to fail fast at boot if the environment is
 * misconfigured. A missing APISIX_GATEWAY_SECRET while enforcement is on is a
 * hard error — the whole point of the service is to only trust the gateway.
 */
class EnvironmentVariables {
  @IsOptional()
  @IsString()
  NODE_ENV?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(65535)
  PORT?: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsOptional()
  @IsString()
  APISIX_GATEWAY_SECRET?: string;

  @IsOptional()
  @IsString()
  APISIX_GATEWAY_SECRET_HEADER?: string;

  @IsOptional()
  @IsString()
  APISIX_CONSUMER_HEADER?: string;

  @IsOptional()
  @IsString()
  APISIX_CREDENTIAL_HEADER?: string;

  // Parsed as a string ('true'/'false') to avoid implicit boolean coercion
  // (Boolean('false') === true). The effective flag is computed below.
  @IsOptional()
  @IsString()
  ENFORCE_GATEWAY?: string;

  @IsOptional()
  @IsIn(['public', 'testnet'])
  STELLAR_NETWORK?: string;

  @IsOptional()
  @IsString()
  STELLAR_HORIZON_URL?: string;

  @IsOptional()
  @IsString()
  STELLAR_BASE_FEE?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  STELLAR_TX_TIMEOUT?: number;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((e) => Object.values(e.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }

  const enforce =
    String(config.ENFORCE_GATEWAY ?? 'true').toLowerCase() !== 'false';

  if (enforce && !validated.APISIX_GATEWAY_SECRET) {
    throw new Error(
      'APISIX_GATEWAY_SECRET is required when ENFORCE_GATEWAY is enabled. ' +
        'Set a shared secret that APISIX injects, or set ENFORCE_GATEWAY=false for local dev.',
    );
  }

  return validated;
}
