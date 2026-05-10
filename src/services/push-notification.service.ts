import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import logger from '../config/logger.config';
import prisma from '../config/prisma.config';

const expo = new Expo();

export enum NotificationType {
  PAYMENT_SENT = 'payment_sent',
  PAYMENT_RECEIVED = 'payment_received',
  PAYMENT_VERIFIED = 'payment_verified',
  FIAT_PAYOUT_COMPLETED = 'fiat_payout_completed',
  TRANSACTION_FAILED = 'transaction_failed',
  WALLET_CONNECTED = 'wallet_connected',
  KYC_APPROVED = 'kyc_approved',
  KYC_REJECTED = 'kyc_rejected',
  SECURITY_ALERT = 'security_alert',
  PROMOTIONAL = 'promotional',
}

interface NotificationPayload {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string | number | boolean>;
  sound?: 'default' | null;
  badge?: number;
  priority?: 'default' | 'normal' | 'high';
}

class PushNotificationService {
  /**
   * Send push notification to a user
   */
  async sendToUser(payload: NotificationPayload): Promise<void> {
    try {
      // Get user's push tokens
      const tokens = await this.getUserPushTokens(payload.userId);

      if (tokens.length === 0) {
        logger.warn('No push tokens found for user', { userId: payload.userId });
        return;
      }

      // Send notifications
      await this.sendPushNotifications(tokens, payload);
    } catch (error) {
      logger.error('Failed to send push notification', {
        userId: payload.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Send push notification to multiple users
   */
  async sendToMultipleUsers(
    userIds: string[],
    payload: Omit<NotificationPayload, 'userId'>,
  ): Promise<void> {
    try {
      const promises = userIds.map((userId) => this.sendToUser({ ...payload, userId }));
      await Promise.allSettled(promises);
    } catch (error) {
      logger.error('Failed to send push notifications to multiple users', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get user's push tokens from database
   */
  private async getUserPushTokens(userId: string): Promise<string[]> {
    try {
      const devices = await prisma.pushToken.findMany({
        where: {
          userId,
          isActive: true,
        },
        select: {
          token: true,
        },
      });

      return devices.map((d) => d.token).filter((token) => Expo.isExpoPushToken(token));
    } catch (error) {
      logger.error('Failed to get user push tokens', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Send push notifications via Expo
   */
  private async sendPushNotifications(
    tokens: string[],
    payload: NotificationPayload,
  ): Promise<void> {
    const messages: ExpoPushMessage[] = tokens.map((token) => ({
      to: token,
      sound: payload.sound ?? 'default',
      title: payload.title,
      body: payload.body,
      data: {
        ...payload.data,
        type: payload.type,
      },
      badge: payload.badge,
      priority: payload.priority ?? 'high',
      channelId: this.getChannelId(payload.type),
    }));

    // Send in chunks
    const chunks = expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        logger.error('Failed to send push notification chunk', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Log results
    tickets.forEach((ticket, index) => {
      if (ticket.status === 'error') {
        logger.error('Push notification error', {
          token: tokens[index],
          error: ticket.message,
          details: ticket.details,
        });
      }
    });
  }

  /**
   * Get Android notification channel based on type
   */
  private getChannelId(type: NotificationType): string {
    switch (type) {
      case NotificationType.PAYMENT_SENT:
      case NotificationType.PAYMENT_RECEIVED:
      case NotificationType.PAYMENT_VERIFIED:
      case NotificationType.FIAT_PAYOUT_COMPLETED:
        return 'payment';
      case NotificationType.SECURITY_ALERT:
      case NotificationType.KYC_REJECTED:
        return 'security';
      case NotificationType.PROMOTIONAL:
        return 'promotional';
      default:
        return 'general';
    }
  }

  /**
   * Register push token for a user
   */
  async registerToken(
    userId: string,
    token: string,
    deviceInfo?: {
      platform?: string;
      deviceId?: string;
      deviceName?: string;
    },
  ): Promise<void> {
    try {
      if (!Expo.isExpoPushToken(token)) {
        throw new Error('Invalid Expo push token');
      }

      await prisma.pushToken.upsert({
        where: {
          userId_token: {
            userId,
            token,
          },
        },
        create: {
          userId,
          token,
          platform: deviceInfo?.platform || 'unknown',
          deviceId: deviceInfo?.deviceId,
          deviceName: deviceInfo?.deviceName,
          isActive: true,
        },
        update: {
          isActive: true,
          platform: deviceInfo?.platform || 'unknown',
          deviceId: deviceInfo?.deviceId,
          deviceName: deviceInfo?.deviceName,
          updatedAt: new Date(),
        },
      });

      logger.info('Push token registered', { userId, token: token.substring(0, 20) + '...' });
    } catch (error) {
      logger.error('Failed to register push token', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Unregister push token
   */
  async unregisterToken(userId: string, token: string): Promise<void> {
    try {
      await prisma.pushToken.updateMany({
        where: {
          userId,
          token,
        },
        data: {
          isActive: false,
        },
      });

      logger.info('Push token unregistered', { userId });
    } catch (error) {
      logger.error('Failed to unregister push token', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Send payment received notification
   */
  async sendPaymentReceivedNotification(params: {
    userId: string;
    senderName: string;
    amount: string;
    currency: string;
    paymentId: string;
  }): Promise<void> {
    await this.sendToUser({
      userId: params.userId,
      type: NotificationType.PAYMENT_RECEIVED,
      title: 'Payment Received',
      body: `${params.senderName} sent you ${params.amount} ${params.currency}`,
      data: {
        paymentId: params.paymentId,
        amount: params.amount,
        currency: params.currency,
      },
      sound: 'default',
      priority: 'high',
    });
  }

  /**
   * Send payment sent notification
   */
  async sendPaymentSentNotification(params: {
    userId: string;
    recipientName: string;
    amount: string;
    currency: string;
    paymentId: string;
  }): Promise<void> {
    await this.sendToUser({
      userId: params.userId,
      type: NotificationType.PAYMENT_SENT,
      title: 'Payment Sent',
      body: `You sent ${params.amount} ${params.currency} to ${params.recipientName}`,
      data: {
        paymentId: params.paymentId,
        amount: params.amount,
        currency: params.currency,
      },
      sound: 'default',
      priority: 'high',
    });
  }
}

export const pushNotificationService = new PushNotificationService();
