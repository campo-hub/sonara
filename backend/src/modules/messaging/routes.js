import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import { createUserRateLimiter } from '../../middleware/rateLimit.js';
import { requireRole } from '../../middleware/roles.js';
import { getProductById } from '../products/store.js';
import {
  getOrCreateConversation, getConversation, insertMessage, listConversations, listMessages,
  markConversationRead, insertMessageReport, listMessageReports, getMessageReport
} from './store.js';

const MAX_MESSAGE_LENGTH = 2000;
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function cleanMessage(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Message text is required.', 'INVALID_MESSAGE');
  const text = value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!text || text.length > MAX_MESSAGE_LENGTH) {
    throw new HttpError(400, `Message must contain 1-${MAX_MESSAGE_LENGTH} characters.`, 'INVALID_MESSAGE');
  }
  return text;
}

function encodeCursor(message) {
  return Buffer.from(JSON.stringify({ createdAt: new Date(message.createdAt).toISOString(), id: message.id })).toString('base64url');
}

function decodeCursor(cursor) {
  try {
    const result = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof result.id !== 'string' || Number.isNaN(Date.parse(result.createdAt))) throw new Error('Invalid cursor.');
    return result;
  } catch {
    throw new HttpError(400, 'Message cursor is invalid.', 'INVALID_CURSOR');
  }
}

export function createMessagingRouter({
  authMiddleware = requireAuth,
  rateLimiter = createUserRateLimiter({
    limit: 30,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many messages. Try again later.' } }
  }),
  getProduct = getProductById,
  createConversation = getOrCreateConversation,
  getConversationById = getConversation,
  createMessage = insertMessage,
  listForUser = listConversations,
  listForConversation = listMessages,
  markRead = markConversationRead,
  createReport = insertMessageReport,
  listReports = listMessageReports,
  getReport = getMessageReport,
  requireAdminMiddleware = requireRole('admin')
} = {}) {
  const router = Router();

  router.post('/conversations', authMiddleware, rateLimiter, asyncRoute(async (req, res) => {
    const productId = String(req.body?.productId || '');
    const product = await getProduct(productId);
    if (!product || product.status !== 'active') throw new HttpError(404, 'Listing not found.', 'PRODUCT_NOT_FOUND');
    if (product.sellerUid === req.user.uid) throw new HttpError(400, 'You cannot contact yourself about your listing.', 'INVALID_CONVERSATION');
    const now = new Date();
    const conversation = await createConversation({
      id: randomUUID(),
      productId: product.id,
      productTitle: product.title,
      participants: [req.user.uid, product.sellerUid],
      now
    });
    const message = {
      id: randomUUID(),
      conversationId: conversation.id,
      senderUid: req.user.uid,
      text: cleanMessage(req.body?.message),
      createdAt: now
    };
    await createMessage(message);
    res.set('Cache-Control', 'private, no-store').status(201).json({ conversation, message });
  }));

  router.get('/conversations', authMiddleware, asyncRoute(async (req, res) => {
    const conversations = await listForUser(req.user.uid);
    res.set('Cache-Control', 'private, no-store').json({ conversations });
  }));

  router.get('/conversations/:id/messages', authMiddleware, asyncRoute(async (req, res) => {
    const conversation = await getConversationById(req.params.id);
    if (!conversation || !conversation.participants.includes(req.user.uid)) {
      throw new HttpError(404, 'Conversation not found.', 'CONVERSATION_NOT_FOUND');
    }
    const rawLimit = req.query.limit == null ? 30 : Number(req.query.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
      throw new HttpError(400, 'limit must be between 1 and 100.', 'INVALID_QUERY');
    }
    const before = req.query.before ? decodeCursor(String(req.query.before)) : null;
    const rows = await listForConversation(conversation.id, { before, limit: rawLimit + 1 });
    const hasMore = rows.length > rawLimit;
    const messages = rows.slice(0, rawLimit).reverse();
    res.set('Cache-Control', 'private, no-store').json({
      conversation,
      messages,
      nextCursor: hasMore && messages.length ? encodeCursor(messages[0]) : null
    });
  }));

  router.post('/conversations/:id/messages', authMiddleware, rateLimiter, asyncRoute(async (req, res) => {
    const conversation = await getConversationById(req.params.id);
    if (!conversation || !conversation.participants.includes(req.user.uid)) {
      throw new HttpError(404, 'Conversation not found.', 'CONVERSATION_NOT_FOUND');
    }
    const message = {
      id: randomUUID(),
      conversationId: conversation.id,
      senderUid: req.user.uid,
      text: cleanMessage(req.body?.text),
      createdAt: new Date()
    };
    await createMessage(message);
    res.set('Cache-Control', 'private, no-store').status(201).json({ message });
  }));

  router.post('/conversations/:id/read', authMiddleware, asyncRoute(async (req, res) => {
    const conversation = await getConversationById(req.params.id);
    if (!conversation || !conversation.participants.includes(req.user.uid)) {
      throw new HttpError(404, 'Conversation not found.', 'CONVERSATION_NOT_FOUND');
    }
    const updated = await markRead(conversation.id, req.user.uid, new Date());
    res.set('Cache-Control', 'private, no-store').json({ conversation: updated });
  }));

  router.post('/conversations/:id/reports', authMiddleware, rateLimiter, asyncRoute(async (req, res) => {
    const conversation = await getConversationById(req.params.id);
    if (!conversation || !conversation.participants.includes(req.user.uid)) {
      throw new HttpError(404, 'Conversation not found.', 'CONVERSATION_NOT_FOUND');
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason || reason.length > 500) throw new HttpError(400, 'A report reason of at most 500 characters is required.', 'INVALID_REPORT');
    const report = {
      id: randomUUID(),
      conversationId: conversation.id,
      reporterUid: req.user.uid,
      reason,
      status: 'open',
      createdAt: new Date()
    };
    await createReport(report);
    res.set('Cache-Control', 'private, no-store').status(201).json({ report: { id: report.id, status: report.status } });
  }));

  router.get('/admin/message-reports', authMiddleware, requireAdminMiddleware, asyncRoute(async (req, res) => {
    const reports = await listReports(50);
    res.set('Cache-Control', 'private, no-store').json({ reports });
  }));

  router.get('/admin/message-reports/:id/messages', authMiddleware, requireAdminMiddleware, asyncRoute(async (req, res) => {
    const report = await getReport(req.params.id);
    if (!report) throw new HttpError(404, 'Open message report not found.', 'REPORT_NOT_FOUND');
    const conversation = await getConversationById(report.conversationId);
    const messages = await listForConversation(report.conversationId, { before: null, limit: 100 });
    res.set('Cache-Control', 'private, no-store').json({ report, conversation, messages: messages.reverse() });
  }));

  return router;
}
