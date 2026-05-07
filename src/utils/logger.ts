import { pino, type Logger } from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const level = process.env.REACTLENS_LOG_LEVEL ?? 'info';

export const logger: Logger = pino(
  isDev
    ? {
        level,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : { level },
);
