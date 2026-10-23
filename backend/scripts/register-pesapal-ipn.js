import { pesapalClient } from '../src/modules/payments/pesapal.js';

try {
  const ipnId = await pesapalClient.registerIpnUrl();
  console.log(`PESAPAL_IPN_ID=${ipnId}`);
  console.log('Add this value to the backend environment, then restart the API.');
} catch {
  console.error('PesaPal IPN registration failed. Check the backend payment settings and provider connectivity.');
  process.exitCode = 1;
}
