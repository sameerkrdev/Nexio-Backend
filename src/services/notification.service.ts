import twilio from 'twilio';
import env from '../config/dotenv.config';
import logger from '../config/logger.config';

const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

const maskPhone = (phone: string): string => phone.replace(/(\+\d{1,3})\d+(\d{4})$/, '$1****$2');

interface PaymentNotificationParams {
  recipientPhone: string;
  senderName: string;
  amount: string;
  currency: string;
  cryptoAmount: string;
  cryptoType: string;
}

/**
 * Send a payment received notification via Twilio SMS.
 */
export const sendPaymentReceivedNotification = async (
  params: PaymentNotificationParams,
): Promise<void> => {
  try {
    const message = `[NexaPay] Payment Received! ${params.senderName} sent you ${params.amount} ${params.currency} (${params.cryptoAmount} ${params.cryptoType}). Check your wallet for details.`;

    await client.messages.create({
      body: message,
      from: env.TWILIO_PHONE_NUMBER,
      to: params.recipientPhone,
    });

    logger.info('Payment notification SMS sent', {
      phone: maskPhone(params.recipientPhone),
      amount: params.amount,
      currency: params.currency,
    });
  } catch (err) {
    logger.error('Failed to send payment notification SMS', {
      phone: maskPhone(params.recipientPhone),
      error: err instanceof Error ? err.message : String(err),
    });
    // Don't throw - we don't want notification failures to break payment processing
  }
};
