import twilio from 'twilio';
import { env } from './dotenv.config';
import logger from './logger.config';

const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

const maskPhone = (phone: string): string => phone.replace(/(\+\d{1,3})\d+(\d{4})$/, '$1****$2');

/**
 * Send a 6-digit OTP to the given E.164 phone number via Twilio SMS.
 */
export const sendSmsOtp = async (phoneNumber: string, otp: string): Promise<void> => {
  try {
    await client.messages.create({
      body: `[Nexio] Your verification code is: ${otp}. Valid for 5 minutes. Do not share it.`,
      from: env.TWILIO_PHONE_NUMBER,
      to: phoneNumber,
    });

    logger.info('OTP SMS sent', { phone: maskPhone(phoneNumber) });
  } catch (err) {
    logger.error('Failed to send OTP SMS', {
      phone: maskPhone(phoneNumber),
      error: err instanceof Error ? err.message : err,
    });
    throw err;
  }
};
