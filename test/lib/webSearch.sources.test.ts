import { describe, expect, it } from 'vitest';
import {
  buildAnnotatedWebSearchText,
  createWebSearchSourceRegistry,
  registerSource,
} from '@/lib/webSearch/sources';

describe('lib/webSearch/sources annotation builder', () => {
  it('collects url_citation annotations from [S1] markers in text', () => {
    const registry = createWebSearchSourceRegistry();
    const source = registerSource(registry, {
      url: 'https://example.com/article',
      title: 'Example Article',
      snippet: 'A snippet here.',
      excerpt: '',
      siteName: null,
    });

    // マーカー[S1]から start/end index 抽出
    const result = buildAnnotatedWebSearchText(
      'See [S1] for details.',
      registry,
    );

    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]?.type).toBe('url_citation');
    expect(result.annotations[0]?.url).toBe(source.url);
    expect(result.annotations[0]?.title).toBe(source.title);
    // "See " の4文字の後ろに "[S1]" があるため start_index=4 end_index=8
    expect(result.annotations[0]?.start_index).toBe(4);
    expect(result.annotations[0]?.end_index).toBe(8);
  });

  it('falls back to URL match when no marker present', () => {
    const registry = createWebSearchSourceRegistry();
    registerSource(registry, {
      url: 'https://example.com/page',
      title: 'Page',
      snippet: '',
      excerpt: '',
      siteName: null,
    });

    const result = buildAnnotatedWebSearchText(
      'Visit https://example.com/page for more.',
      registry,
    );

    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]?.url).toBe('https://example.com/page');
  });

  it('appends Sources footer when neither marker nor URL present', () => {
    const registry = createWebSearchSourceRegistry();
    registerSource(registry, {
      url: 'https://example.com/no-cite',
      title: 'No Cite Source',
      snippet: '',
      excerpt: '',
      siteName: null,
    });

    const result = buildAnnotatedWebSearchText(
      'No references anywhere in this answer.',
      registry,
    );

    // フォールバック Sources 行付与後にマーカー再抽出される
    expect(result.text).toContain('Sources:');
    expect(result.text).toContain('[S1]');
    expect(result.annotations.length).toBeGreaterThan(0);
  });

  it('returns empty annotations when no sources are registered', () => {
    const registry = createWebSearchSourceRegistry();

    const result = buildAnnotatedWebSearchText('Plain text.', registry);

    expect(result.annotations).toEqual([]);
    expect(result.text).toBe('Plain text.');
  });
});
