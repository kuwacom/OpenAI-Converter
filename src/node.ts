import 'dotenv/config';
import { serve } from '@hono/node-server';
import app from '@/app';
import { getAppConfig } from '@/configs/env';
import { APP_NAME } from '@/configs/constants';
import { serverLogger } from '@/services/logger';

// クライアント切断等で SSE ストリーム cancel -> upstream fetch 中断時に
// AbortError が未捕捉 Promise として飛ぶことがある。プロセス全体を落とさないよう最終防護する
process.on('unhandledRejection', (error) => {
  const name = error instanceof Error ? error.name : 'Unknown';
  // AbortController 由来の中止は正常系。他の予期せぬ拒絶のみ error 扱いで残す
  if (name === 'AbortError') {
    return;
  }
  serverLogger.error('Unhandled promise rejection', {
    name,
    message: error instanceof Error ? error.message : String(error),
  });
});

process.on('uncaughtException', (error) => {
  serverLogger.error('Uncaught exception', {
    name: error.name,
    message: error.message,
    stack: error.stack,
  });
});

const { host, port, logLevel } = getAppConfig();

serve(
  {
    fetch: app.fetch,
    hostname: host,
    port,
  },
  (info) => {
    serverLogger.info('Server started', {
      appName: APP_NAME,
      url: `http://${host}:${info.port}`,
      logLevel,
      runtime: 'node',
    });
  },
);

