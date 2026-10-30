import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useCartContext } from '../hooks/useCartContext.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { get } from '../lib/api.js';
import { unreadBadgeText } from '../lib/featureUtils.js';

export function Header() {
  const { user, profile, signOut } = useAuth();
  const { items } = useCartContext();
  const { language, changeLanguage, t } = useI18n();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationError, setNotificationError] = useState('');
  useEffect(() => {
    if (!user) { setUnreadCount(0); setNotificationError(''); return undefined; }
    let active = true;
    const refresh = () => get('/notifications?limit=1')
      .then((result) => { if (active) { setUnreadCount(result.unreadCount || 0); setNotificationError(''); } })
      .catch((error) => { if (active) setNotificationError(error.message); });
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [user]);
  return (
    <header className="site-header">
      <Link className="brand" to="/" aria-label={t('brand')}><span className="brand-mark" aria-hidden="true">🌿</span>{t('brand')}</Link>
      <nav aria-label="Main navigation">
        <NavLink to="/browse">{t('browse')}</NavLink>
        <NavLink to="/cart">{t('cart')} <span className="cart-count">{items.length}</span></NavLink>
        {user && <NavLink to="/orders">{t('orders')}</NavLink>}
        {user && <NavLink to="/messages">{t('messages')}</NavLink>}
        {user && <NavLink to="/notifications" aria-label={`${t('notifications')}, ${unreadCount} unread`}>{t('notifications')} {unreadCount > 0 && <span className="cart-count">{unreadBadgeText(unreadCount)}</span>}</NavLink>}
        {profile?.roles?.includes('seller') && <NavLink to="/seller">{t('sellerDashboard')}</NavLink>}
        {profile?.roles?.includes('admin') && <NavLink to="/admin">{t('admin')}</NavLink>}
      </nav>
      <div className="header-actions">
        {notificationError && <span role="status" className="notification-error">{t('notificationUnavailable')}</span>}
        <label className="language-picker">
          <span className="sr-only">{t('language')}</span>
          <select value={language} onChange={(event) => changeLanguage(event.target.value)}>
            <option value="en">{t('english')}</option><option value="sw">{t('swahili')}</option>
          </select>
        </label>
        {user
          ? <button className="button button-quiet" onClick={() => signOut()}>{t('signOut')}</button>
          : <Link className="button button-quiet" to="/sign-in">{t('signIn')}</Link>}
      </div>
    </header>
  );
}
