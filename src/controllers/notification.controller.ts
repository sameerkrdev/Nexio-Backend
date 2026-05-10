import type { Request, Response } from 'express';
import { pushNotificationService, NotificationType } from '../services/push-notification.service';
import logger from '../config/logger.config';

export const registerPushToken = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { pushToken, platform, deviceId, deviceName } = req.body;

    if (!pushToken) {
      return res.status(400).json({ success: false, message: 'Push token is required' });
    }

    await pushNotificationService.registerToken(userId, pushToken, {
      platform,
      deviceId,
      deviceName,
    });

    return res.status(200).json({
      success: true,
      message: 'Push token registered successfully',
    });
  } catch (error) {
    logger.error('Failed to register push token', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      success: false,
      message: 'Failed to register push token',
    });
  }
};

export const unregisterPushToken = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { pushToken } = req.body;

    if (!pushToken) {
      return res.status(400).json({ success: false, message: 'Push token is required' });
    }

    await pushNotificationService.unregisterToken(userId, pushToken);

    return res.status(200).json({
      success: true,
      message: 'Push token unregistered successfully',
    });
  } catch (error) {
    logger.error('Failed to unregister push token', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      success: false,
      message: 'Failed to unregister push token',
    });
  }
};

export const sendTestNotification = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    await pushNotificationService.sendToUser({
      userId,
      type: 'promotional' as NotificationType,
      title: 'Test Notification',
      body: 'This is a test notification from Nexio',
      data: { test: true },
    });

    return res.status(200).json({
      success: true,
      message: 'Test notification sent',
    });
  } catch (error) {
    logger.error('Failed to send test notification', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      success: false,
      message: 'Failed to send test notification',
    });
  }
};
