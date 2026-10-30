import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { insertNotification } from '../modules/notifications/store.js';
import { getUserProfile } from '../userStore.js';

const messageFor = (template, data) => ({
  title: `AgriStore: ${template.replaceAll('_', ' ')}`,
  body: data?.productTitle || data?.orderId || data?.productId || 'You have a marketplace update.'
});

async function postJson(url, token, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Notification provider returned HTTP ${response.status}.`);
}

async function sendAfricaTalkingSms(notification, profile, data) {
  const drivers = config.notificationDrivers;
  const phone = data?.phone || profile?.phone || profile?.sellerProfile?.payoutPhone;
  if (!drivers.africaTalkingApiKey || !phone) return;
  const endpoint = drivers.africaTalkingEnvironment === 'production'
    ? 'https://api.africastalking.com/version1/messaging'
    : 'https://api.sandbox.africastalking.com/version1/messaging';
  const form = new URLSearchParams({
    username: drivers.africaTalkingUsername,
    to: phone,
    message: `${messageFor(notification.template, data).title}: ${messageFor(notification.template, data).body}`,
    ...(drivers.africaTalkingSenderId ? { from: drivers.africaTalkingSenderId } : {})
  });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { apiKey: drivers.africaTalkingApiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`SMS provider returned HTTP ${response.status}.`);
  const result = await response.json();
  if (result.SMSMessageData?.Recipients?.some((recipient) => recipient.status !== 'Success')) {
    throw new Error('SMS provider reported unsuccessful delivery to one or more recipients.');
  }
}

async function sendExternal(notification, profile, data) {
  const { title, body } = messageFor(notification.template, data);
  const drivers = config.notificationDrivers;
  if (drivers.emailUrl && profile?.email) {
    await postJson(drivers.emailUrl, drivers.emailToken, { to: profile.email, subject: title, text: body });
  }
  await sendAfricaTalkingSms(notification, profile, data);
}

export async function notify({ to, template, data = {} }) {
  if (!to || !template) throw new TypeError('Notification recipient and template are required.');
  const notification = {
    id: randomUUID(),
    uid: to,
    template,
    title: messageFor(template, data).title,
    body: messageFor(template, data).body,
    data,
    eventKey: `${template}:${data.orderId || data.productId || data.payoutId || notificationId()}:${to}`,
    createdAt: new Date(),
    readAt: null
  };
  const stored = await insertNotification(notification);
  if (config.notificationDrivers.emailUrl || config.notificationDrivers.africaTalkingApiKey) {
    try {
      const profile = await getUserProfile(to);
      await sendExternal(stored, profile, data);
    } catch (error) {
      console.error(`External notification delivery failed for ${template}; the in-app notification remains available.`, error);
    }
  }
  return stored;
}

function notificationId() { return randomUUID(); }
