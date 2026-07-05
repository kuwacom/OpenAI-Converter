import { describe, expect, it } from 'vitest';
import {
  isWebSearchToolType,
  normalizeWebSearchToolConfig,
  normalizeWebSearchCallPayload,
  clamp,
  isDomainAllowed,
} from '@/lib/webSearch/core';

describe('lib/webSearch/core', () => {
  describe('isWebSearchToolType', () => {
    it('accepts web_search and web_search_preview family types', () => {
      expect(isWebSearchToolType('web_search')).toBe(true);
      expect(isWebSearchToolType('web_search_preview')).toBe(true);
      expect(isWebSearchToolType('web_search_preview_2025_08_07')).toBe(true);
    });

    it('rejects unrelated tool types', () => {
      expect(isWebSearchToolType('function')).toBe(false);
      expect(isWebSearchToolType('custom')).toBe(false);
      expect(isWebSearchToolType(undefined)).toBe(false);
      expect(isWebSearchToolType(123)).toBe(false);
    });
  });

  describe('normalizeWebSearchToolConfig', () => {
    it('detects web_search builtin from request tools array', () => {
      const config = normalizeWebSearchToolConfig([
        { type: 'function', name: 'lookup' },
        { type: 'web_search', search_context_size: 'low', external_web_access: false },
      ]);

      expect(config).not.toBeNull();
      expect(config?.rawToolType).toBe('web_search');
      expect(config?.searchContextSize).toBe('low');
      expect(config?.externalWebAccess).toBe(false);
    });

    it('returns null when no web_search builtin is declared', () => {
      expect(
        normalizeWebSearchToolConfig([{ type: 'function', name: 'f' }]),
      ).toBeNull();
      expect(normalizeWebSearchToolConfig([])).toBeNull();
    });

    it('defaults search_context_size to medium when omitted', () => {
      const config = normalizeWebSearchToolConfig([{ type: 'web_search_preview' }]);
      expect(config?.searchContextSize).toBe('medium');
    });
  });

  describe('normalizeWebSearchCallPayload', () => {
    it('derives action search by default', () => {
      const payload = normalizeWebSearchCallPayload({ query: 'rust async runtime' });
      expect(payload.action).toBe('search');
      expect(payload.query).toBe('rust async runtime');
    });

    it('recognizes open_page action with url', () => {
      const payload = normalizeWebSearchCallPayload({
        action: { type: 'open_page' },
        url: 'https://example.com/article',
      });
      expect(payload.action).toBe('open_page');
      expect(payload.url).toBe('https://example.com/article');
    });
  });

  describe('domain guards', () => {
    it('isDomainAllowed accepts any host when no allow-list provided', () => {
      expect(isDomainAllowed('https://anywhere.example/page', [])).toBe(true);
    });

    it('isDomainAllowed honors suffix match on subdomains', () => {
      expect(
        isDomainAllowed('https://docs.example.com/a', ['example.com']),
      ).toBe(true);
      expect(
        isDomainAllowed('https://other.test/b', ['example.com']),
      ).toBe(false);
    });
  });

  it('clamp keeps numbers within bounds', () => {
    expect(clamp(50, 0, 10)).toBe(10);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});
