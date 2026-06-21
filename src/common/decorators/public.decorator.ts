import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as reachable without passing the APISIX gateway check.
 * Use sparingly — e.g. liveness/readiness probes hit by the orchestrator,
 * not by clients coming through the gateway.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
