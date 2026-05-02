import { cleanEnv, str, port, makeValidator } from 'envalid';

const env = cleanEnv(process.env, {
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

  REDIS_URL: str(),

  JWT_PRIVATE_KEY: str(),
  JWT_PUBLIC_KEY: str(),
  JWT_ACCESS_EXPIRY: str({ default: '15m' }),
  JWT_REFRESH_EXPIRY_DAYS: str({ default: '30' }),

  TWILIO_ACCOUNT_SID: str(),
  TWILIO_AUTH_TOKEN: str(),
  TWILIO_PHONE_NUMBER: str(),
});

export default env;
