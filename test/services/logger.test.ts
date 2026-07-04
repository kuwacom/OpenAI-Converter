import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/configs/env', () => ({
  getAppConfig: () => ({
    host: '127.0.0.1',
    port: 3000,
    corsOrigin: '*',
    upstreamBaseUrl: 'https://api.openai.com/v1',
    upstreamModel: '',
    upstreamApiKey: '',
    defaultBackend: 'openai-compatible-chat-completions',
    logLevel: 'debug',
  }),
}));

import logger from '@/services/logger';

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('writes debug logs when LOG_LEVEL is debug', () => {
    expect(() => logger.debug('Debug message', { flag: true })).not.toThrow();
  });

  it('does not throw when custom inspect throws', () => {
    const problematicValue = {
      [Symbol.for('nodejs.util.inspect.custom')]: () => {
        throw new Error('inspect failed');
      },
      payload: 'example',
    };

    expect(() =>
      logger.error('Unhandled application error', problematicValue),
    ).not.toThrow();
  });
});
