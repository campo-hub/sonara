import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { newConversationRequest } from '../lib/featureUtils.js';
import { ErrorMessage } from './Shared.jsx';
import { useI18n } from '../hooks/useI18n.jsx';

export function MessageInbox() {
  const { t } = useI18n();
  const [conversations, setConversations] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    get('/conversations').then((result) => setConversations(result.conversations || [])).catch((err) => setError(err.message));
  }, []);
  return <main className="page narrow-page">
    <h1>{t('messages')}</h1>
    <p className="tradeoff-note">{t('pollingNote')}</p>
    <ErrorMessage message={error} />
    <ul className="conversation-list">{conversations.map((conversation) => (
      <li key={conversation.id}><Link to={`/messages/${encodeURIComponent(conversation.id)}`}>
        <strong>{conversation.productTitle}</strong><span>{conversation.lastMessage || 'Conversation started'}</span>
      </Link></li>
    ))}</ul>
    {!conversations.length && !error && <p>{t('noConversations')}</p>}
  </main>;
}

export function NewConversation() {
  const { t } = useI18n();
  const [search] = useSearchParams();
  const productId = search.get('productId') || '';
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const navigate = useNavigate();
  const submit = async (event) => {
    event.preventDefault();
    setSending(true);
    setError('');
    try {
      const { conversation } = await post('/conversations', newConversationRequest(productId, text));
      navigate(`/messages/${encodeURIComponent(conversation.id)}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };
  return <main className="page narrow-page">
    <h1>{t('contactFarmer')}</h1>
    {!productId && <ErrorMessage message={t('chooseListingFirst')} />}
    <form className="stack-form" onSubmit={submit}>
      <label>{t('firstMessage')}<textarea required maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} /></label>
      <ErrorMessage message={error} />
      <button className="button button-primary" disabled={!productId || sending}>{sending ? t('sending') : t('sendMessage')}</button>
    </form>
  </main>;
}

export function MessageThread() {
  const { t } = useI18n();
  const { id } = useParams();
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [text, setText] = useState('');
  const [reportReason, setReportReason] = useState('');
  const [error, setError] = useState('');
  const load = async (before) => {
    const query = before ? `?before=${encodeURIComponent(before)}` : '';
    const result = await get(`/conversations/${encodeURIComponent(id)}/messages${query}`);
    setConversation(result.conversation);
    setMessages((current) => before ? [...result.messages, ...current] : result.messages);
    setNextCursor(result.nextCursor);
    await post(`/conversations/${encodeURIComponent(id)}/read`, {});
  };
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = await get(`/conversations/${encodeURIComponent(id)}/messages`);
        if (!active) return;
        setConversation(result.conversation);
        setMessages(result.messages || []);
        setNextCursor(result.nextCursor);
        await post(`/conversations/${encodeURIComponent(id)}/read`, {});
        setError('');
      } catch (err) {
        if (active) setError(err.message);
      }
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [id]);
  const send = async (event) => {
    event.preventDefault();
    try {
      const { message } = await post(`/conversations/${encodeURIComponent(id)}/messages`, { text });
      setMessages((current) => [...current, message]);
      setText('');
      setError('');
    } catch (err) { setError(err.message); }
  };
  const report = async (event) => {
    event.preventDefault();
    try {
      await post(`/conversations/${encodeURIComponent(id)}/reports`, { reason: reportReason });
      setReportReason('');
      setError(t('reportedForReview'));
    } catch (err) { setError(err.message); }
  };
  return <main className="page narrow-page">
    <p><Link to="/messages">← {t('inbox')}</Link></p>
    <h1>{conversation?.productTitle || t('conversation')}</h1>
    <p className="tradeoff-note">{t('threadPollingNote')}</p>
    <ErrorMessage message={error} />
    {nextCursor && <button className="button button-secondary" onClick={() => load(nextCursor)}>{t('loadOlderMessages')}</button>}
    <ol className="message-list">{messages.map((message) => <li key={message.id} className={message.senderUid === user?.uid ? 'message-own' : ''}>
      <p>{message.text}</p><time dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleString()}</time>
    </li>)}</ol>
    <form className="stack-form" onSubmit={send}>
      <label>{t('message')}<textarea required maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} /></label>
      <button className="button button-primary">{t('send')}</button>
    </form>
    <details className="report-listing"><summary>{t('reportConversation')}</summary><form className="stack-form" onSubmit={report}>
      <label>{t('reportReason')}<textarea required maxLength={500} value={reportReason} onChange={(event) => setReportReason(event.target.value)} /></label>
      <button className="button button-secondary">{t('sendReport')}</button>
    </form></details>
  </main>;
}

export function NotificationFeed() {
  const { t } = useI18n();
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState('');
  const reload = () => get('/notifications?limit=100').then((result) => setNotifications(result.notifications || [])).catch((err) => setError(err.message));
  useEffect(() => { reload(); }, []);
  const markRead = async (id) => {
    try {
      await post(`/notifications/${encodeURIComponent(id)}/read`, {});
      setNotifications((current) => current.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item));
    } catch (err) { setError(err.message); }
  };
  const markAllRead = async () => {
    try {
      await post('/notifications/read-all', {});
      setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
    } catch (err) { setError(err.message); }
  };
  return <main className="page narrow-page">
    <div className="section-heading"><h1>{t('notifications')}</h1><button className="button button-secondary" onClick={markAllRead}>{t('markAllRead')}</button></div>
    <ErrorMessage message={error} />
    <ul className="notification-list">{notifications.map((item) => <li key={item.id} className={item.readAt ? '' : 'notification-unread'}>
      <strong>{t(`notification_${item.template}`) === `notification_${item.template}` ? item.title : t(`notification_${item.template}`)}</strong><p>{item.body}</p><time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString()}</time>
      {!item.readAt && <button className="text-button" onClick={() => markRead(item.id)}>{t('markRead')}</button>}
    </li>)}</ul>
    {!notifications.length && !error && <p>{t('noNotifications')}</p>}
  </main>;
}

export function AdminMessageReports() {
  const { t } = useI18n();
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    get('/admin/message-reports').then((result) => setReports(result.reports || [])).catch((err) => setError(err.message));
  }, []);
  const inspect = async (report) => {
    try {
      setSelected(await get(`/admin/message-reports/${encodeURIComponent(report.id)}/messages`));
      setError('');
    } catch (err) { setError(err.message); }
  };
  return <main className="page"><h1>{t('reportedConversations')}</h1><ErrorMessage message={error} />
    {reports.map((report) => <article className="order-card" key={report.id}>
      <div><strong>{report.reason}</strong><p>Reported {new Date(report.createdAt).toLocaleString()}</p></div>
      <button className="button button-secondary" onClick={() => inspect(report)}>{t('readReportedMessages')}</button>
    </article>)}
    {selected && <section className="message-report"><h2>{selected.conversation?.productTitle || 'Conversation'}</h2><ol className="message-list">{selected.messages.map((message) => <li key={message.id}><strong>{message.senderUid}</strong><p>{message.text}</p><time>{new Date(message.createdAt).toLocaleString()}</time></li>)}</ol></section>}
    {!reports.length && !error && <p>{t('noOpenConversationReports')}</p>}
  </main>;
}
