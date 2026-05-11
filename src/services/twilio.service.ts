import twilio from 'twilio';
import env from '../config/dotenv.config';
import logger from '../config/logger.config';

const hasTwilioConfig = () =>
  Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER);

const getClient = () => {
  if (!hasTwilioConfig()) {
    return null;
  }
  return twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
};

const maskPhone = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  return `****${last4}`;
};

export const sendSms = async (to: string, body: string): Promise<void> => {
  const client = getClient();
  if (!client) {
    logger.warn('Twilio SMS skipped: configuration missing', {
      to: maskPhone(to),
    });
    return;
  }

  try {
    const result = await client.messages.create({
      body,
      from: env.TWILIO_PHONE_NUMBER,
      to,
    });
    logger.info('Twilio SMS sent', {
      to: maskPhone(to),
      messageId: result.sid,
    });
  } catch (error) {
    logger.warn('Twilio SMS failed', {
      to: maskPhone(to),
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
