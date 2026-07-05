import logger from '@/services/logger';
import {
  buildSearchContextFetchPages,
  buildSearchContextLimits,
  clamp,
  isDomainAllowed,
  normalizeWebSearchCallPayload,
  normalizeWebSearchToolConfig,
  resolveDefaultUserLocationFromConfig,
} from '@/lib/webSearch/core';
import {
  excerptAround,
  fetchPage,
  findInPageExcerpts,
  querySearx,
  buildSearchQuery,
  type FetchPageResult,
  type WebSearchParamsBase,
} from '@/lib/webSearch/pageProcessing';
import {
  buildActionSources,
  registerSource,
  renderSearchOutput,
} from '@/lib/webSearch/sources';
import type {
  WebSearchCallPayload,
  WebSearchExecutionResult,
  WebSearchSourceRecord,
  WebSearchToolConfig,
} from '@/types/webSearch';

/**
 * ### executeWebSearch
 * model 出力 function_call 引数(parsed payload)を受け取り search/open_page/find_in_page のいずれかへ正規化して実行する。
 *
 * env 未設定時 searxngBaseUrl 空文字なら stub フォールバックテキストを返しプロセス停止を回避する。
 * リクエスト明示 user_location 優先、無ければ AppConfig.webSearch 既定値を採用する(検索語補強のみ影響)
 */
export const executeWebSearch = async ({
  callArguments,
  toolsConfigRaw,
  registry,
  params,
  signal,
}: {
  callArguments: unknown;
  toolsConfigRaw: readonly unknown[];
  registry: Map<string, WebSearchSourceRecord>;
  params: WebSearchParamsBase;
  signal?: AbortSignal;
}): Promise<WebSearchExecutionResult> => {
  const baseConfig = normalizeWebSearchToolConfig(toolsConfigRaw);
  if (!baseConfig) {
    throw new Error('web_search tool is not configured for this request');
  }

  // env 既定 user_location を統合。request 明示優先で双方無ければ null(location 補強なし)
  const fallbackLocation =
    resolveDefaultUserLocationFromConfig(params.config) ?? null;
  const config: WebSearchToolConfig = {
    ...baseConfig,
    userLocation: baseConfig.userLocation ?? fallbackLocation,
    userLocationSource:
      baseConfig.userLocationSource ?? (fallbackLocation ? 'default' : null),
  };

  const payload = normalizeWebSearchCallPayload(callArguments);

  logger.debug(
    `[web_search] config=${JSON.stringify(config)} payload=${JSON.stringify(
      payload,
    )}`,
  );

  const isEnabled =
    Boolean(params.config.searxngBaseUrl) ||
    Boolean(params.config.searxngQueryUrl);

  if (!isEnabled) {
    return {
      action: {
        type: payload.action,
        query: payload.query ?? null,
        queries: payload.queries ?? null,
        url: payload.url ?? null,
        sources: [],
      },
      modelInputText:
        '<web_search_output action="' +
        payload.action +
        '">\nNo SearXNG backend configured. Set WEB_SEARCH_SEARXNG_BASE_URL to enable web_search.\n</web_search_output>',
      sources: [],
    };
  }

  if (payload.action === 'open_page') {
    return executeOpenPageAction({ payload, config, registry, params, signal });
  }

  if (payload.action === 'find_in_page') {
    return executeFindInPageAction({
      payload,
      config,
      registry,
      params,
      signal,
    });
  }

  return executeSearchAction({ payload, config, registry, params, signal });
};
/**
 * ### executeSearchAction
 * web_search の search アクションを実行する。
 *
 * SearXNG クエリ→domain フィルタ→上位件数取得(上限)→上位ページ分 fetchPage 補強 の順で行う
 */
const executeSearchAction = async ({
  payload,
  config,
  registry,
  params,
  signal,
}: {
  payload: WebSearchCallPayload;
  config: WebSearchToolConfig;
  registry: Map<string, WebSearchSourceRecord>;
  params: WebSearchParamsBase;
  signal?: AbortSignal;
}): Promise<WebSearchExecutionResult> => {
  const query = buildSearchQuery(payload, config);
  if (!query) {
    return {
      action: { type: 'search', query: null, queries: null, sources: [] },
      modelInputText:
        '<web_search_output action="search">\nNo query was provided.\n</web_search_output>',
      sources: [],
    };
  }

  const limitsMap = buildSearchContextLimits(params.config.defaultLimit);
  const limit = clamp(limitsMap[config.searchContextSize], 1, params.config.maxLimit);

  const rawResults = await querySearx(query, params, signal);
  const filteredResults = rawResults
    .filter((result) => isDomainAllowed(result.url, config.allowedDomains))
    .slice(0, clamp(limit, 1, params.config.maxLimit));

  const fetchPagesMap = buildSearchContextFetchPages(
    params.config.fetchMaxPagesPerCall,
  );
  const pageFetchLimit = config.externalWebAccess
    ? fetchPagesMap[config.searchContextSize]
    : 0;

  const fetchedPages: (FetchPageResult | null)[] = pageFetchLimit
    ? await Promise.all(
        filteredResults
          .slice(0, pageFetchLimit)
          .map((result) => fetchPage(result.url, params, signal)),
      )
    : [];

  const pageMap = new Map<string, FetchPageResult>(
    fetchedPages
      .filter((page): page is FetchPageResult => Boolean(page))
      .map((page) => [page.url, page]),
  );

  const sources = filteredResults.map((result) =>
    registerSource(registry, {
      url: result.url,
      title: pageMap.get(result.url)?.title ?? result.title,
      snippet: result.snippet,
      excerpt:
        pageMap.get(result.url)?.excerpt ??
        excerptAround(result.snippet, payload.query ?? query),
      siteName: result.siteName,
    }),
  );

  return {
    action: {
      type: 'search',
      query: payload.query ?? query,
      queries: payload.queries ?? [query],
      sources: buildActionSources(sources),
    },
    modelInputText: renderSearchOutput(
      {
        ...payload,
        action: 'search',
        query: payload.query ?? query,
        queries: payload.queries ?? [query],
      },
      sources,
    ),
    sources,
  };
};

/**
 * ### executeOpenPageAction
 * web_search の open_page アクションを実行する。
 *
 * URL 取得→可読テキスト化→source 登録→`<web_search_output action="open_page">` 形式で返す
 */
const executeOpenPageAction = async ({
  payload,
  config,
  registry,
  params,
  signal,
}: {
  payload: WebSearchCallPayload;
  config: WebSearchToolConfig;
  registry: Map<string, WebSearchSourceRecord>;
  params: WebSearchParamsBase;
  signal?: AbortSignal;
}): Promise<WebSearchExecutionResult> => {
  if (
    !payload.url ||
    !isDomainAllowed(payload.url, config.allowedDomains)
  ) {
    return {
      action: { type: 'open_page', url: payload.url, sources: [] },
      modelInputText:
        '<web_search_output action="open_page">\nThe requested URL is missing or not allowed by the active domain filters.\n</web_search_output>',
      sources: [],
    };
  }

  const page = await fetchPage(payload.url, params, signal);
  if (!page) {
    return {
      action: { type: 'open_page', url: payload.url, sources: [] },
      modelInputText:
        '<web_search_output action="open_page">\nFailed to fetch ' +
        payload.url +
        '.\n</web_search_output>',
      sources: [],
    };
  }

  const source = registerSource(registry, {
    url: page.url,
    title: page.title,
    snippet: '',
    excerpt: page.excerpt,
    siteName: null,
  });

  return {
    action: {
      type: 'open_page',
      url: payload.url,
      sources: buildActionSources([source]),
    },
    modelInputText: renderSearchOutput(payload, [source]),
    sources: [source],
  };
};

/**
 * ### executeFindInPageAction
 * web_search の find_in_page アクションを実行する。
 *
 * 指定 URL を取得しページ内で query 出現箇所の抜粋(最大5件)を返す
 */
const executeFindInPageAction = async ({
  payload,
  config,
  registry,
  params,
  signal,
}: {
  payload: WebSearchCallPayload;
  config: WebSearchToolConfig;
  registry: Map<string, WebSearchSourceRecord>;
  params: WebSearchParamsBase;
  signal?: AbortSignal;
}): Promise<WebSearchExecutionResult> => {
  if (
    !payload.url ||
    !isDomainAllowed(payload.url, config.allowedDomains)
  ) {
    return {
      action: {
        type: 'find_in_page',
        url: payload.url,
        query: payload.query,
        sources: [],
      },
      modelInputText:
        '<web_search_output action="find_in_page">\nThe requested URL is missing or not allowed by the active domain filters.\n</web_search_output>',
      sources: [],
    };
  }

  const page = await fetchPage(payload.url, params, signal);
  if (!page) {
    return {
      action: {
        type: 'find_in_page',
        url: payload.url,
        query: payload.query,
        sources: [],
      },
      modelInputText:
        '<web_search_output action="find_in_page">\nFailed to fetch ' +
        payload.url +
        '.\n</web_search_output>',
      sources: [],
    };
  }

  const excerpts = findInPageExcerpts(page.text, payload.query ?? '');
  const source = registerSource(registry, {
    url: page.url,
    title: page.title,
    snippet: '',
    excerpt: excerpts[0] ?? page.excerpt,
    siteName: null,
  });

  const lines = [
    '<web_search_output action="find_in_page">',
    `URL: ${payload.url}`,
    `Query: ${payload.query ?? ''}`,
    'Use only the source below for page-grounded claims. Cite it inline with markers like [S1].',
    '',
    `[${source.id}] ${source.title}`,
    `URL: ${source.url}`,
  ];

  if (excerpts.length === 0) {
    lines.push('No matches were found in the fetched page.');
  } else {
    excerpts.forEach((excerpt, index) => {
      lines.push(`Match ${index + 1}: ${excerpt}`);
    });
  }

  lines.push('</web_search_output>');

  return {
    action: {
      type: 'find_in_page',
      url: payload.url,
      query: payload.query,
      sources: buildActionSources([source]),
    },
    modelInputText: lines.join('\n'),
    sources: [source],
  };
};
