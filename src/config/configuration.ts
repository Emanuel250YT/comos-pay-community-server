/**
 * Centralized, typed configuration loaded from environment variables.
 * Consumed via Nest's ConfigService<AppConfig, true>.
 */
export type StellarNetwork = 'public' | 'testnet';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  apisix: {
    gatewaySecret: string;
    gatewaySecretHeader: string;
    consumerHeader: string;
    credentialHeader: string;
    enforce: boolean;
  };
  stellar: {
    network: StellarNetwork;
    horizonUrl: string;
    baseFee: string;
    timeoutSeconds: number;
  };
}

const DEFAULT_HORIZON: Record<StellarNetwork, string> = {
  public: 'https://horizon.stellar.org',
  testnet: 'https://horizon-testnet.stellar.org',
};

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL ?? '',
  apisix: {
    gatewaySecret: process.env.APISIX_GATEWAY_SECRET ?? '',
    gatewaySecretHeader: (
      process.env.APISIX_GATEWAY_SECRET_HEADER ?? 'x-gateway-secret'
    ).toLowerCase(),
    consumerHeader: (
      process.env.APISIX_CONSUMER_HEADER ?? 'x-consumer-username'
    ).toLowerCase(),
    credentialHeader: (
      process.env.APISIX_CREDENTIAL_HEADER ?? 'x-credential-identifier'
    ).toLowerCase(),
    enforce: (process.env.ENFORCE_GATEWAY ?? 'true').toLowerCase() !== 'false',
  },
  stellar: (() => {
    const network: StellarNetwork =
      (process.env.STELLAR_NETWORK ?? 'testnet').toLowerCase() === 'public'
        ? 'public'
        : 'testnet';
    return {
      network,
      horizonUrl: process.env.STELLAR_HORIZON_URL ?? DEFAULT_HORIZON[network],
      baseFee: process.env.STELLAR_BASE_FEE ?? '100',
      timeoutSeconds: parseInt(process.env.STELLAR_TX_TIMEOUT ?? '300', 10),
    };
  })(),
});
