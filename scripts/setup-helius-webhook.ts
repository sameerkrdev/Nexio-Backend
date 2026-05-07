/**
 * Script to set up Helius webhook for payment notifications
 *
 * This script creates a webhook that monitors transactions to the Nexio wallet
 * and sends notifications to your backend when payments are received.
 *
 * Usage:
 *   bun run scripts/setup-helius-webhook.ts <webhook-url>
 *
 * Example:
 *   bun run scripts/setup-helius-webhook.ts https://cb65fn7x-3000.inc1.devtunnels.ms/api/v1/webhooks/helius
 */

import env from '../src/config/dotenv.config';

const HELIUS_API_KEY = env.HELIUS_API_KEY;
const NEXIO_WALLET = env.NEXIO_WALLET;
const WEBHOOK_SECRET = env.HELIUS_WEBHOOK_SECRET;
const NETWORK = env.SOLANA_NETWORK;

async function listWebhooks() {
  const response = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${HELIUS_API_KEY}`);
  const data = await response.json();
  console.log('\n📋 Existing Helius Webhooks:');
  console.log(JSON.stringify(data, null, 2));
  return data;
}

async function createWebhook(webhookUrl: string) {
  console.log('\n🔧 Creating Helius webhook...');
  console.log('Webhook URL:', webhookUrl);
  console.log('Nexio Wallet:', NEXIO_WALLET);
  console.log('Network:', NETWORK);

  const response = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${HELIUS_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      webhookURL: webhookUrl,
      transactionTypes: ['TRANSFER'],
      accountAddresses: [NEXIO_WALLET],
      webhookType: 'enhanced',
      authHeader: WEBHOOK_SECRET,
      txnStatus: 'all', // Get both success and failed transactions
      encoding: 'jsonParsed',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create webhook: ${response.status} ${error}`);
  }

  const data = await response.json();
  console.log('\n✅ Webhook created successfully!');
  console.log(JSON.stringify(data, null, 2));
  return data;
}

async function deleteWebhook(webhookId: string) {
  console.log(`\n🗑️  Deleting webhook: ${webhookId}`);
  const response = await fetch(
    `https://api.helius.xyz/v0/webhooks/${webhookId}?api-key=${HELIUS_API_KEY}`,
    {
      method: 'DELETE',
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to delete webhook: ${response.status} ${error}`);
  }

  console.log('✅ Webhook deleted successfully!');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'list') {
    await listWebhooks();
    return;
  }

  if (command === 'delete') {
    const webhookId = args[1];
    if (!webhookId) {
      console.error('❌ Please provide webhook ID to delete');
      console.log('Usage: bun run scripts/setup-helius-webhook.ts delete <webhook-id>');
      process.exit(1);
    }
    await deleteWebhook(webhookId);
    return;
  }

  if (command === 'create') {
    const webhookUrl = args[1];
    if (!webhookUrl) {
      console.error('❌ Please provide webhook URL');
      console.log('Usage: bun run scripts/setup-helius-webhook.ts create <webhook-url>');
      console.log(
        'Example: bun run scripts/setup-helius-webhook.ts create https://cb65fn7x-3000.inc1.devtunnels.ms/api/v1/webhooks/helius',
      );
      process.exit(1);
    }
    await createWebhook(webhookUrl);
    return;
  }

  // Default: list webhooks
  console.log('📋 Helius Webhook Manager');
  console.log('\nCommands:');
  console.log('  list                     - List all webhooks');
  console.log('  create <webhook-url>     - Create a new webhook');
  console.log('  delete <webhook-id>      - Delete a webhook');
  console.log('\nExample:');
  console.log('  bun run scripts/setup-helius-webhook.ts list');
  console.log(
    '  bun run scripts/setup-helius-webhook.ts create https://your-url.com/api/v1/webhooks/helius',
  );

  await listWebhooks();
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
