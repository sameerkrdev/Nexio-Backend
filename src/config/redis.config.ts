import Redis from 'ioredis';
import env from './dotenv.config';
import logger from './logger.config';

const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('ready', () => {
  logger.info('Redis ready');
});

redis.on('error', (err: Error) => {
  logger.error('Redis error', { message: err.message });
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

export default redis;
