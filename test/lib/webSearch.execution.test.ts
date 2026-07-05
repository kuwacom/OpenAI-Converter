import { describe, expect, it } from 'vitest';
import { executeWebSearch } from '@/lib/webSearch/execution';
import type { WebSearchConfig } from '@/types/env';

const buildDisabledWebSearchConfig = (): WebSearchConfig => ({
  searxngBaseUrl: '',
  searxngQueryUrl: '',
  language: 'ja-JP',
  clientIp: '',
  userAgent: 'test-agent',
  defaultLimit: 10,
  maxLimit: 25,
  fetchMaxPagesPerCall: 5,
  timeoutMs: 15000,
  fetchTimeoutMs: 20000,
  fetchMaxBytes: 1500000,
  extractCharLimit: 4000,
  defaultUserLocationType: '',
  defaultUserLocationCity: '',
  defaultUserLocationRegion: '',
  defaultUserLocationCountry: '',
  defaultUserLocationTimezone: '',
});

describe('lib/webSearch/execution stub fallback', () => {
  it('returns no-backend notice when SearXNG is not configured', async () => {
    const result = await executeWebSearch({
      callArguments: { action: 'search', query: 'latest news' },
      toolsConfigRaw: [{ type: 'web_search' }],
      registry: new Map(),
      params: { config: buildDisabledWebSearchConfig() },
    });

    expect(result.sources).toEqual([]);
    expect(result.modelInputText).toContain('No SearXNG backend configured');
    expect(result.action.type).toBe('search');
  });
});
