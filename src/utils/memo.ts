import bs58 from 'bs58';
import {
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';

export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

export interface HeliusInstruction {
  programId?: string;
  data?: string;
}

export const buildMemoInstruction = (paymentId: string): TransactionInstruction => {
  return new TransactionInstruction({
    keys: [],
    programId: new PublicKey(MEMO_PROGRAM_ID),
    data: Buffer.from(paymentId, 'utf8'),
  });
};

// Helius enhanced webhook payload encodes memo data as base58.
export const parseMemoFromHeliusPayload = (instructions: HeliusInstruction[]): string | null => {
  for (const instruction of instructions) {
    if (instruction.programId !== MEMO_PROGRAM_ID || !instruction.data) continue;
    try {
      return Buffer.from(bs58.decode(instruction.data)).toString('utf8');
    } catch {
      return null;
    }
  }
  return null;
};

// Parsed transaction fallback path already exposes memo text as UTF-8.
export const parseMemoFromRawTransaction = (tx: ParsedTransactionWithMeta): string | null => {
  const instructions = tx.transaction.message.instructions;
  for (const instruction of instructions) {
    if (!('parsed' in instruction)) continue;
    const parsedInstruction = instruction as ParsedInstruction;
    if (parsedInstruction.programId.toBase58() !== MEMO_PROGRAM_ID) continue;

    const parsed = parsedInstruction.parsed as { type?: string; info?: { memo?: string } };
    if (parsed.type === 'memo' && parsed.info?.memo) {
      return parsed.info.memo;
    }
  }

  return null;
};
