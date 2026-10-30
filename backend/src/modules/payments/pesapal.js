import { config } from '../../config.js';
import { HttpError } from '../../middleware/errors.js';

const BASE_URLS = Object.freeze({
  sandbox: 'https://cybqa.pesapal.com/pesapalv3',
  live: 'https://pay.pesapal.com/v3'
});

export function createPesapalClient({
  pesapalConfig = config.pesapal,
  fetchImpl = fetch,
  now = () => Date.now()
} = {}) {
  let tokenValue = '';
  let tokenExpiresAt = 0;

  async function request(path, { method = 'GET', body, token } = {}) {
    const response = await fetchImpl(`${BASE_URLS[pesapalConfig.environment]}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000)
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new HttpError(502, 'Payment provider returned an unreadable response.', 'PAYMENT_PROVIDER_ERROR');
    }
    if (!response.ok || payload?.error) {
      throw new HttpError(502, 'Payment provider request failed.', 'PAYMENT_PROVIDER_ERROR');
    }
    return payload;
  }

  async function getAccessToken() {
    if (!pesapalConfig.consumerKey || !pesapalConfig.consumerSecret) {
      throw new HttpError(503, 'Online payments are not configured.', 'PAYMENTS_NOT_CONFIGURED');
    }
    if (tokenValue && tokenExpiresAt > now() + 30_000) return tokenValue;
    const payload = await request('/api/Auth/RequestToken', {
      method: 'POST',
      body: {
        consumer_key: pesapalConfig.consumerKey,
        consumer_secret: pesapalConfig.consumerSecret
      }
    });
    if (typeof payload.token !== 'string' || !payload.token) {
      throw new HttpError(502, 'Payment provider did not issue an access token.', 'PAYMENT_PROVIDER_ERROR');
    }
    const expiry = Date.parse(payload.expiryDate || '');
    tokenValue = payload.token;
    tokenExpiresAt = Number.isFinite(expiry) ? expiry : now() + 4 * 60 * 1000;
    return tokenValue;
  }

  async function getIpnId() {
    if (pesapalConfig.ipnId) return pesapalConfig.ipnId;
    throw new HttpError(503, 'Online payments are not configured with a registered notification ID.', 'PAYMENTS_NOT_CONFIGURED');
  }

  async function registerIpnUrl() {
    if (!pesapalConfig.ipnUrl) {
      throw new HttpError(503, 'PESAPAL_IPN_URL is required to register the payment notification URL.', 'PAYMENTS_NOT_CONFIGURED');
    }
    const token = await getAccessToken();
    const payload = await request('/api/URLSetup/RegisterIPN', {
      method: 'POST',
      token,
      body: {
        url: pesapalConfig.ipnUrl,
        ipn_notification_type: 'GET'
      }
    });
    if (typeof payload.ipn_id !== 'string' || !payload.ipn_id) {
      throw new HttpError(502, 'Payment provider did not register the payment notification URL.', 'PAYMENT_PROVIDER_ERROR');
    }
    return payload.ipn_id;
  }

  async function submitOrderRequest({
    id,
    merchantReference,
    amount,
    description,
    billingAddress
  }) {
    if (!pesapalConfig.callbackUrl) {
      throw new HttpError(503, 'Online payments are not configured.', 'PAYMENTS_NOT_CONFIGURED');
    }
    const token = await getAccessToken();
    const notificationId = await getIpnId();
    const payload = await request('/api/Transactions/SubmitOrderRequest', {
      method: 'POST',
      token,
      body: {
        id,
        currency: 'KES',
        amount,
        description,
        callback_url: pesapalConfig.callbackUrl,
        notification_id: notificationId,
        billing_address: billingAddress
      }
    });
    if (payload.merchant_reference !== merchantReference
      || typeof payload.order_tracking_id !== 'string'
      || typeof payload.redirect_url !== 'string') {
      throw new HttpError(502, 'Payment provider returned an invalid checkout response.', 'PAYMENT_PROVIDER_ERROR');
    }
    let redirectUrl;
    try {
      redirectUrl = new URL(payload.redirect_url);
    } catch {
      throw new HttpError(502, 'Payment provider returned an invalid checkout URL.', 'PAYMENT_PROVIDER_ERROR');
    }
    if (redirectUrl.protocol !== 'https:' || redirectUrl.hostname !== new URL(BASE_URLS[pesapalConfig.environment]).hostname) {
      throw new HttpError(502, 'Payment provider returned an invalid checkout URL.', 'PAYMENT_PROVIDER_ERROR');
    }
    return {
      orderTrackingId: payload.order_tracking_id,
      merchantReference: payload.merchant_reference,
      redirectUrl: redirectUrl.toString()
    };
  }

  async function getTransactionStatus(orderTrackingId) {
    const token = await getAccessToken();
    return request(`/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`, { token });
  }

  return { getAccessToken, getIpnId, registerIpnUrl, submitOrderRequest, getTransactionStatus };
}

export const pesapalClient = createPesapalClient();
