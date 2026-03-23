import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/configs/env', () => ({
  getAppConfig: () => ({
    appName: 'OpenAI-Converter',
    port: 3000,
    llamaCppBaseUrl: 'http://127.0.0.1:8080',
    llamaCppModel: 'qwen3.5',
    openAICompatibleBaseUrl: undefined,
    openAICompatibleModel: 'gpt-4.1-mini',
    defaultBackend: 'llamacpp-qwen-chatml',
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
