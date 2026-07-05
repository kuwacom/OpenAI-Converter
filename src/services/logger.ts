import { Logger } from 'tslog';
import { getAppConfig } from '@/configs/env';
import { APP_NAME } from '@/configs/constants';

const inspectCustomSymbol = Symbol.for('nodejs.util.inspect.custom');

const LOG_LEVEL_MAP = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
} as const;

const resolveMinLevel = (logLevel: string) => {
  const normalized = logLevel.toLowerCase() as keyof typeof LOG_LEVEL_MAP;
  return LOG_LEVEL_MAP[normalized] ?? LOG_LEVEL_MAP.info;
};

const serializeError = (value: Error) => {
  const serialized: Record<string, unknown> = {
    name: value.name,
    message: value.message,
  };

  if (value.stack) {
    serialized.stack = value.stack;
  }

  for (const [key, entry] of Object.entries(value)) {
    serialized[key] = entry;
  }

  return serialized;
};

const normalizeForLogging = (
  value: unknown,
  seen = new WeakSet<object>(),
): unknown => {
  if (value instanceof Error) {
    return serializeError(value);
  }

  if (typeof value === 'bigint') {
    return `${value}n`;
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForLogging(entry, seen));
  }

  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);

    const normalizedObject: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {
      normalizedObject[key] = normalizeForLogging(entry, seen);
    }

    if (inspectCustomSymbol in value) {
      normalizedObject.__customInspectRemoved = true;
    }

    return normalizedObject;
  }

  return value;
};

const createSafeLoggerFacade = (instance: Logger<unknown>) => ({
  silly: (message: string, details?: unknown) =>
    details === undefined
      ? instance.silly(message)
      : instance.silly(message, normalizeForLogging(details)),
  trace: (message: string, details?: unknown) =>
    details === undefined
      ? instance.trace(message)
      : instance.trace(message, normalizeForLogging(details)),
  debug: (message: string, details?: unknown) =>
    details === undefined
      ? instance.debug(message)
      : instance.debug(message, normalizeForLogging(details)),
  info: (message: string, details?: unknown) =>
    details === undefined
      ? instance.info(message)
      : instance.info(message, normalizeForLogging(details)),
  warn: (message: string, details?: unknown) =>
    details === undefined
      ? instance.warn(message)
      : instance.warn(message, normalizeForLogging(details)),
  error: (message: string, details?: unknown) =>
    details === undefined
      ? instance.error(message)
      : instance.error(message, normalizeForLogging(details)),
  fatal: (message: string, details?: unknown) =>
    details === undefined
      ? instance.fatal(message)
      : instance.fatal(message, normalizeForLogging(details)),
});

// appName は env 不要の固定値のため configs/config.ts を参照する
// logLevel のみ env 経由(getAppConfig)で解決する
const { logLevel } = getAppConfig();

const rootLogger = new Logger({
  name: APP_NAME,
  type: 'pretty',
  minLevel: resolveMinLevel(logLevel),
  prettyLogTimeZone: 'local',
  prettyLogTemplate:
    '{{yyyy}}-{{mm}}-{{dd}}T{{hh}}:{{MM}}:{{ss}}.{{ms}} {{logLevelName}}\t{{nameWithDelimiterPrefix}}',
  prettyLogStyles: {
    logLevelName: {
      '*': ['bold', 'whiteBright'],
      SILLY: ['bold', 'white'],
      TRACE: ['bold', 'gray'],
      DEBUG: ['bold', 'cyan'],
      INFO: ['bold', 'green'],
      WARN: ['bold', 'yellow'],
      ERROR: ['bold', 'red'],
      FATAL: ['bold', 'whiteBright', 'bgRedBright'],
    },
    nameWithDelimiterPrefix: ['white', 'bold'],
  },
  prettyInspectOptions: {
    colors: true,
    compact: false,
    depth: 5,
  },
});

export const serverLogger = createSafeLoggerFacade(
  rootLogger.getSubLogger({ name: 'Server' }),
);
export const httpLogger = createSafeLoggerFacade(
  rootLogger.getSubLogger({ name: 'HTTP' }),
);

const logger = createSafeLoggerFacade(rootLogger);

export default logger;
