import { cleanEnv, str, port } from 'envalid';

export const env = cleanEnv(process.env, {
  NODE_ENV: str({
    choices: ['development', 'production', 'test'],
    default: 'development',
  }),

  PORT: port({ default: 3000 }),

  LOG_LEVEL: str({ default: 'info' }),

  DATABASE_URL: str(),

  POSTGRES_DATABASE_URL: str({
    requiredWhen() {
      if (process.env.NODE_ENV === 'development') {
        return true;
      }
      return false;
    },
  }),
});
