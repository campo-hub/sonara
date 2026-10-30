import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth.jsx';
import { CartProvider } from './hooks/useCartContext.jsx';
import { I18nProvider, useI18n } from './hooks/useI18n.jsx';
import { Header } from './components/Header.jsx';
import { Footer } from './components/Footer.jsx';
import * as Pages from './pages/Pages.jsx';
import { CompareView } from './pages/PriceComparison.jsx';
import { AdminMessageReports, MessageInbox, MessageThread, NewConversation, NotificationFeed } from './pages/Communications.jsx';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <main className="page"><p role="status">Loading…</p></main>;
  return user ? children : <Navigate to="/sign-in" replace />;
}

function ServerBanner() {
  const { t } = useI18n();
  const { profileError } = useAuth();
  const [state, setState] = useState('checking');
  useEffect(() => {
    const check = () => fetch(`${import.meta.env.VITE_API_URL || ''}/health`, { cache: 'no-store' })
      .then((response) => setState(response.ok ? 'online' : 'offline'))
      .catch(() => setState('offline'));
    if (!import.meta.env.VITE_API_URL) { setState('offline'); return undefined; }
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  }, []);
  if (profileError) return <div className="server-banner" role="status">{profileError}</div>;
  return state === 'offline' ? <div className="server-banner" role="status">{t('serverSleeping')} <button onClick={() => location.reload()}>{t('tryAgain')}</button></div> : null;
}

function MarketplaceShell() {
  return <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Header /><ServerBanner /><Routes>
    <Route path="/" element={<Pages.Home />} />
    <Route path="/browse" element={<Pages.Browse />} />
    <Route path="/products/:id" element={<Pages.ProductDetail />} />
    <Route path="/compare/:id" element={<CompareView />} />
    <Route path="/sellers/:uid" element={<Pages.SellerProfilePublic />} />
    <Route path="/cart" element={<Pages.Cart />} />
    <Route path="/checkout" element={<Pages.Checkout />} />
    <Route path="/checkout/return" element={<RequireAuth><Pages.CheckoutReturn /></RequireAuth>} />
    <Route path="/orders" element={<RequireAuth><Pages.Orders /></RequireAuth>} />
    <Route path="/orders/:id" element={<RequireAuth><Pages.OrderDetail /></RequireAuth>} />
    <Route path="/seller" element={<RequireAuth><Pages.SellerDashboard /></RequireAuth>} />
    <Route path="/seller/products" element={<RequireAuth><Pages.SellerProducts /></RequireAuth>} />
    <Route path="/seller/products/new" element={<RequireAuth><Pages.ProductForm /></RequireAuth>} />
    <Route path="/seller/products/:id/edit" element={<RequireAuth><Pages.ProductForm /></RequireAuth>} />
    <Route path="/seller/orders" element={<RequireAuth><Pages.SellerOrders /></RequireAuth>} />
    <Route path="/seller/profile" element={<RequireAuth><Pages.SellerProfile /></RequireAuth>} />
    <Route path="/admin" element={<RequireAuth><Pages.AdminHome /></RequireAuth>} />
    <Route path="/admin/listings" element={<RequireAuth><Pages.AdminListings /></RequireAuth>} />
    <Route path="/admin/users" element={<RequireAuth><Pages.AdminUsers /></RequireAuth>} />
    <Route path="/admin/reports" element={<RequireAuth><Pages.AdminReports /></RequireAuth>} />
    <Route path="/admin/orders" element={<RequireAuth><Pages.AdminOrders /></RequireAuth>} />
    <Route path="/admin/categories" element={<RequireAuth><Pages.AdminCategories /></RequireAuth>} />
    <Route path="/admin/message-reports" element={<RequireAuth><AdminMessageReports /></RequireAuth>} />
    <Route path="/messages" element={<RequireAuth><MessageInbox /></RequireAuth>} />
    <Route path="/messages/new" element={<RequireAuth><NewConversation /></RequireAuth>} />
    <Route path="/messages/:id" element={<RequireAuth><MessageThread /></RequireAuth>} />
    <Route path="/notifications" element={<RequireAuth><NotificationFeed /></RequireAuth>} />
    <Route path="/sign-in" element={<Pages.SignIn />} />
    <Route path="/account" element={<RequireAuth><Pages.Account /></RequireAuth>} />
    <Route path="*" element={<Pages.NotFound />} />
  </Routes><Footer /></HashRouter>;
}

export default function App() {
  return <I18nProvider><AuthProvider><CartProvider><MarketplaceShell /></CartProvider></AuthProvider></I18nProvider>;
}
