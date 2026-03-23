export type LogLevel =
  | 'silly'
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal';

export type AppConfig = {
  appName: string;
  port: number;
  llamaCppBaseUrl: string;
  llamaCppModel: string;
  openAICompatibleBaseUrl?: string;
  openAICompatibleModel?: string;
  defaultBackend: string;
  logLevel: LogLevel;
};
