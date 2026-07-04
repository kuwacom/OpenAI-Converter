import type { CanonicalRequest } from '@/models/canonical/response';
import { HttpError } from '@/types/errors';
import { backendRegistry } from '@/services/backends/registry';

export const resolveBackend = (
  request: CanonicalRequest,
  backendId: string,
) => {
  const backend = backendRegistry.find((entry) => entry.id === backendId);

  if (!backend) {
    throw new HttpError(500, `Unknown backend: ${backendId}`, {
      requestedModel: request.model,
    });
  }

  return backend;
};
