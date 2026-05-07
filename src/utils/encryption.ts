import crypto from 'crypto';
import env from '../config/dotenv.config';

interface EncryptedPayload {
  iv: string;
  authTag: string;
  content: string;
}

const isHex = (value: string) => /^[0-9a-fA-F]+$/.test(value);

const getEncryptionKeyBuffer = () => {
  const key = env.WALLET_ENCRYPTION_KEY.trim();
  if (key.length !== 64 || !isHex(key)) {
    throw new Error('WALLET_ENCRYPTION_KEY must be exactly 64 hex characters');
  }
  return Buffer.from(key, 'hex');
};

const ENCRYPTION_KEY_BUFFER = getEncryptionKeyBuffer();
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export const encryptAccountDetails = (details: Record<string, unknown>): string => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY_BUFFER, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(details), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    content: encrypted.toString('hex'),
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
};

export const decryptAccountDetails = (encrypted: string): Record<string, unknown> => {
  const rawPayload = Buffer.from(encrypted, 'base64').toString('utf8');
  const payload = JSON.parse(rawPayload) as EncryptedPayload;

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    ENCRYPTION_KEY_BUFFER,
    Buffer.from(payload.iv, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.content, 'hex')),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8')) as Record<string, unknown>;
};

export const validateWalletEncryptionSetup = () => {
  const testPayload = { probe: 'wallet-encryption', now: Date.now() };
  const encrypted = encryptAccountDetails(testPayload);
  const decrypted = decryptAccountDetails(encrypted);
  if (decrypted.probe !== testPayload.probe) {
    throw new Error('Wallet encryption round-trip validation failed');
  }
};
