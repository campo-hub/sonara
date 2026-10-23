import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post, put, upload } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';
import { formatDate } from '../lib/format.js';
import { COUNTIES } from '../lib/counties.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { useCartContext } from '../hooks/useCartContext.jsx';
import { useDebounce } from '../hooks/useDebounce.js';
import { useGeolocation } from '../hooks/useGeolocation.js';
import { useI18n } from '../hooks/useI18n.jsx';
import { phoneAuthEnabled, sendPhoneCode } from '../firebase.js';
import { ImageGallery } from '../components/ImageGallery.jsx';
import { ProductGrid } from '../components/ProductGrid.jsx';
import { FilterBar } from '../components/FilterBar.jsx';
import { PriceTag } from '../components/PriceTag.jsx';
import { QuantityInput } from '../components/QuantityInput.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { Skeletons } from '../components/Skeletons.jsx';

function ErrorMessage({ message }) {
  return message ? <p className="error-message" role="alert">{message}</p> : null;
}

function useProducts(path, dependencies = []) {
  const [state, setState] = useState({ products: [], loading: true, error: '' });
  const reload = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const result = await get(path);
      setState({ products: result.products || [], loading: false, error: '' });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message }));
    }
  }, dependencies);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

export function Home() {
  const { t } = useI18n();
  const { products, loading, error } = useProducts('/products?limit=12');
  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">{t('tagline')}</p>
        <h1>{t('heroTitle')}</h1>
        <p>{t('heroBody')}</p>
        <Link className="button button-primary" to="/browse">{t('browse')}</Link>
      </section>
      <section className="section">
        <div className="section-heading"><div><p className="eyebrow">{t('marketplace')}</p><h2>{t('browse')}</h2></div><Link to="/browse">{t('loadMore')} →</Link></div>
        {error ? <ErrorMessage message={error} /> : loading ? <Skeletons count={4} /> : <ProductGrid products={products} />}
      </section>
    </main>
  );
}

const emptyFilters = { q: '', category: '', county: '', minPrice: '', maxPrice: '', sort: 'newest' };

export function Browse() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState(() => ({
    ...emptyFilters,
    ...Object.fromEntries(Object.keys(emptyFilters).map((key) => [key, searchParams.get(key) || emptyFilters[key]]))
  }));
  const [coordinates, setCoordinates] = useState(() => {
    if (!searchParams.has('lat') || !searchParams.has('lng')) return null;
    const lat = Number(searchParams.get('lat'));
    const lng = Number(searchParams.get('lng'));
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  });
  const [products, setProducts] = useState([]);
  const [cursor, setCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [moreLoading, setMoreLoading] = useState(false);
  const { position, error: locationError, locate } = useGeolocation();
  const [nearbyRequested, setNearbyRequested] = useState(false);
  const debouncedQuery = useDebounce(filters.q, 300);
  useEffect(() => {
    if (position && nearbyRequested) {
      setCoordinates(position);
      setFilters((current) => ({ ...current, sort: 'nearest' }));
    }
  }, [position, nearbyRequested]);
  useEffect(() => { get('/categories').then((result) => setCategories(result.categories)).catch((err) => setError(err.message)); }, []);
  useEffect(() => {
    const next = { ...filters, q: debouncedQuery };
    const params = new URLSearchParams();
    Object.entries(next).forEach(([key, value]) => { if (value) params.set(key, value); });
    if (next.sort === 'nearest' && coordinates) {
      params.set('lat', String(coordinates.lat));
      params.set('lng', String(coordinates.lng));
    }
    setSearchParams(params, { replace: true });
    const query = params.toString();
    setLoading(true);
    setError('');
    get(`/products?${query}`).then((result) => {
      setProducts(result.products || []);
      setCursor(result.nextCursor || '');
      setLoading(false);
    }).catch((err) => { setError(err.message); setLoading(false); });
  }, [debouncedQuery, filters.category, filters.county, filters.minPrice, filters.maxPrice, filters.sort, coordinates, setSearchParams]);
  const change = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const loadMore = async () => {
    if (!cursor) return;
    setMoreLoading(true);
    try {
      const query = { ...filters, q: debouncedQuery, cursor };
      if (filters.sort === 'nearest' && coordinates) Object.assign(query, { lat: String(coordinates.lat), lng: String(coordinates.lng) });
      const params = new URLSearchParams(query);
      const result = await get(`/products?${params}`);
      setProducts((current) => [...current, ...(result.products || [])]);
      setCursor(result.nextCursor || '');
    } catch (err) { setError(err.message); }
    finally { setMoreLoading(false); }
  };
  return (
    <main className="page">
      <div className="page-heading"><p className="eyebrow">{t('inSeason')}</p><h1>{t('browse')}</h1></div>
      <details className="mobile-filter"><summary>{t('category')} &amp; {t('county')}</summary><FilterBar filters={filters} onChange={change} categories={categories} counties={COUNTIES} /></details>
      <div className="desktop-filter"><FilterBar filters={filters} onChange={change} categories={categories} counties={COUNTIES} /></div>
      <button className="button button-secondary" onClick={() => { setNearbyRequested(true); locate(); }}>{t('nearMe')}</button>
      <ErrorMessage message={locationError || error} />
      {loading ? <Skeletons /> : products.length ? <ProductGrid products={products} /> : <EmptyState title={t('emptyProducts')} />}
      {cursor && <div className="center"><button className="button button-secondary" onClick={loadMore} disabled={moreLoading}>{moreLoading ? t('loading') : t('loadMore')}</button></div>}
    </main>
  );
}

export function ProductDetail() {
  const { id } = useParams();
  const { t } = useI18n();
  const { add } = useCartContext();
  const { user } = useAuth();
  const [product, setProduct] = useState(null);
  const [qty, setQty] = useState(1);
  const [error, setError] = useState('');
  const [reportStatus, setReportStatus] = useState('');
  const [reportReason, setReportReason] = useState('misleading');
  const [reportDetails, setReportDetails] = useState('');
  const [added, setAdded] = useState(false);
  useEffect(() => { get(`/products/${encodeURIComponent(id)}`).then(({ product: item }) => setProduct(item)).catch((err) => setError(err.message)); }, [id]);
  if (error) return <main className="page"><ErrorMessage message={error} /></main>;
  if (!product) return <main className="page"><Skeletons count={1} /></main>;
  const available = Math.max(0, product.quantityAvailable - (product.quantityReserved || 0));
  const addProduct = () => {
    if (qty < product.minOrder || qty > available) {
      setError(t('minimumQuantityError').replace('{min}', product.minOrder).replace('{max}', available));
      return;
    }
    add(product.id, qty);
    setError('');
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  };
  const submitReport = async (event) => {
    event.preventDefault();
    setError('');
    try {
      await post(`/products/${encodeURIComponent(product.id)}/reports`, { reason: reportReason, details: reportDetails });
      setReportStatus(t('reportSubmitted'));
      setReportDetails('');
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <main className="page product-detail">
      <div className="product-detail-grid">
        <ImageGallery images={product.images || []} title={product.title} />
        <section className="product-info">
          <p className="eyebrow">{product.category} · {product.location?.county}, {product.location?.town}</p>
          <h1>{product.title}</h1>
          <PriceTag amount={product.pricePerUnit} unit={product.unit} />
          <p>{product.description}</p>
          <p>{available} {product.unit} {t('available')}</p>
          {product.ratingCount > 0 && <p className="rating">★ {product.ratingAvg} ({product.ratingCount})</p>}
          <SellerLink uid={product.sellerUid} />
          {user && user.uid !== product.sellerUid && <details className="report-listing">
            <summary>{t('reportListing')}</summary>
            <form className="stack-form" onSubmit={submitReport}>
              <label>{t('reportReason')}<select value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
                <option value="unsafe">{t('reportUnsafe')}</option>
                <option value="misleading">{t('reportMisleading')}</option>
                <option value="prohibited">{t('reportProhibited')}</option>
                <option value="other">{t('reportOther')}</option>
              </select></label>
              <label>{t('reportDetails')}<textarea maxLength={500} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} /></label>
              <button className="button button-secondary">{t('submitReport')}</button>
              {reportStatus && <p role="status">{reportStatus}</p>}
            </form>
          </details>}
          {!user && <p><Link to="/sign-in">{t('signInToReport')}</Link></p>}
          <div className="buy-controls">
            <QuantityInput value={qty} min={product.minOrder} max={available} onChange={setQty} />
            <button className="button button-primary" onClick={addProduct}>{added ? t('addedToCart') : t('addToCart')}</button>
          </div>
          <ErrorMessage message={error} />
        </section>
      </div>
      <div className="sticky-buy"><PriceTag amount={product.pricePerUnit} unit={product.unit} /><button className="button button-primary" onClick={addProduct}>{t('addToCart')}</button></div>
    </main>
  );
}

function SellerLink({ uid }) {
  const { t } = useI18n();
  const [seller, setSeller] = useState(null);
  useEffect(() => { get(`/sellers/${encodeURIComponent(uid)}`).then((data) => setSeller(data.seller)).catch(() => {}); }, [uid]);
  return seller ? <p className="seller-link"><Link to={`/sellers/${encodeURIComponent(uid)}`}>{seller.displayName}</Link>{seller.verified && <span className="verified-badge">✓ {t('verifiedSeller')}</span>}</p> : null;
}

export function SellerProfilePublic() {
  const { uid } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { get(`/sellers/${encodeURIComponent(uid)}`).then(setData).catch((err) => setError(err.message)); }, [uid]);
  const { t } = useI18n();
  if (error) return <main className="page"><ErrorMessage message={error} /></main>;
  if (!data) return <main className="page"><Skeletons /></main>;
  return <main className="page"><div className="seller-heading"><p className="eyebrow">{data.seller.county}, {data.seller.town}</p><h1>{data.seller.displayName}</h1>{data.seller.verified && <span className="verified-badge">✓ {t('verifiedSeller')}</span>}<p>{data.seller.bio}</p></div><ProductGrid products={data.products} /></main>;
}

export function Cart() {
  const { t } = useI18n();
  const cart = useCartContext();
  const [products, setProducts] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all(cart.items.map(({ productId }) => get(`/products/${encodeURIComponent(productId)}`).then((result) => result.product)))
      .then(setProducts).catch((err) => setError(err.message));
  }, [cart.items]);
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const total = cart.items.reduce((sum, item) => sum + (productMap.get(item.productId)?.pricePerUnit || 0) * item.qty, 0);
  return (
    <main className="page">
      <h1>{t('cart')}</h1><ErrorMessage message={error} />
      {!cart.items.length ? <EmptyState title={t('cartEmpty')} action={<Link className="button button-primary" to="/browse">{t('continueShopping')}</Link>} /> : (
        <>
          <div className="cart-list">{cart.items.map((item) => {
            const product = productMap.get(item.productId);
            return <article className="cart-row" key={item.productId}>
              <div><h2>{product?.title || item.productId}</h2><PriceTag amount={product?.pricePerUnit || 0} unit={product?.unit} /></div>
              <QuantityInput value={item.qty} min={product?.minOrder || 0.1} max={product?.quantityAvailable} onChange={(qty) => cart.setQuantity(item.productId, qty)} />
              <button className="text-button" onClick={() => cart.remove(item.productId)}>{t('remove')}</button>
            </article>;
          })}</div>
          <div className="cart-total"><strong>{t('orderSummary')}</strong><PriceTag amount={Math.round(total)} /><Link className="button button-primary" to="/checkout">{t('checkout')}</Link></div>
        </>
      )}
    </main>
  );
}

const phonePattern = /^(?:\+254|254|0)?[17]\d{8}$/;

export function Checkout() {
  const { t } = useI18n();
  const { user } = useAuth();
  const cart = useCartContext();
  const navigate = useNavigate();
  const [form, setForm] = useState({ method: 'pickup', county: '', town: '', phone: '', notes: '' });
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState('');
  const [products, setProducts] = useState([]);
  useEffect(() => {
    Promise.all(cart.items.map(({ productId }) => get(`/products/${encodeURIComponent(productId)}`).then((result) => result.product)))
      .then(setProducts).catch((err) => setError(err.message));
  }, [cart.items]);
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    if (!user) { navigate('/sign-in'); return; }
    if (!phonePattern.test(form.phone.replace(/[\s()-]/g, ''))) {
      setError(t('validKenyanPhone'));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await post('/orders', {
        items: cart.items.map(({ productId, qty }) => ({ productId, qty })),
        delivery: form
      });
      setOrders(result.orders || []);
      cart.clear();
    } catch (err) { setError(err.message); }
    finally { setSubmitting(false); }
  };
  const startPayment = async (order) => {
    setPaymentLoading(order.id);
    setError('');
    try {
      const result = await post(`/orders/${encodeURIComponent(order.id)}/payment`, {});
      localStorage.setItem('agristore.pending-order', order.id);
      window.location.assign(result.redirectUrl);
    } catch (err) { setError(err.message); setPaymentLoading(''); }
  };
  if (orders.length) return <main className="page"><h1>{t('orderSummary')}</h1><p>{t('eachSellerOrder')}</p><ErrorMessage message={error} />{orders.map((order) => <article className="order-card" key={order.id}><h2>{order.items.map((item) => item.titleSnapshot).join(', ')}</h2><PriceTag amount={order.total} /><StatusBadge status={order.status} /><button className="button button-primary" disabled={paymentLoading === order.id} onClick={() => startPayment(order)}>{paymentLoading === order.id ? t('loading') : t('pay')}</button></article>)}</main>;
  const total = products.reduce((sum, product) => {
    const item = cart.items.find((entry) => entry.productId === product.id);
    return sum + Math.round(product.pricePerUnit * (item?.qty || 0));
  }, 0);
  return (
    <main className="page checkout-grid">
      <section><h1>{t('checkout')}</h1><ErrorMessage message={error} />
        <form className="stack-form" onSubmit={submit}>
          <label>{t('deliveryMethod')}<select value={form.method} onChange={update('method')}><option value="pickup">{t('pickup')}</option><option value="seller_delivery">{t('sellerDelivery')}</option></select></label>
          <label>{t('county')}<select required value={form.county} onChange={update('county')}><option value="">—</option>{COUNTIES.map((county) => <option key={county}>{county}</option>)}</select></label>
          <label>{t('town')}<input required value={form.town} onChange={update('town')} /></label>
          <label>{t('phone')}<input required inputMode="tel" autoComplete="tel" value={form.phone} onChange={update('phone')} /></label>
          <label>{t('deliveryNotes')}<textarea value={form.notes} onChange={update('notes')} maxLength={500} /></label>
          <button className="button button-primary" disabled={submitting || !cart.items.length}>{submitting ? t('loading') : t('placeOrder')}</button>
        </form>
      </section>
      <aside className="summary-panel"><h2>{t('orderSummary')}</h2>{products.map((product) => {
        const item = cart.items.find((entry) => entry.productId === product.id);
        return <p key={product.id}>{product.title} × {item?.qty}: {formatMoney(Math.round(product.pricePerUnit * (item?.qty || 0)))}</p>;
      })}<strong>{formatMoney(total)}</strong><p>{t('finalServerCalculation')}</p></aside>
    </main>
  );
}

export function CheckoutReturn() {
  const { t } = useI18n();
  const [orderId] = useState(() => {
    try { return localStorage.getItem('agristore.pending-order') || new URLSearchParams(location.search).get('orderId') || ''; }
    catch { return ''; }
  });
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!orderId) return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const result = await get(`/orders/${encodeURIComponent(orderId)}`);
        if (!active) return;
        setOrder(result.order);
        if (result.order.status === 'paid') localStorage.removeItem('agristore.pending-order');
      } catch (err) { if (active) setError(err.message); }
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [orderId]);
  if (!orderId) return <main className="page"><h1>{t('paymentPending')}</h1><p>{t('returnOrders')}</p><Link to="/orders">{t('orders')}</Link></main>;
  return <main className="page payment-return" aria-live="polite"><h1>{order?.status === 'paid' ? t('paymentPaid') : t('paymentConfirming')}</h1><ErrorMessage message={error} />{order && <><StatusBadge status={order.status} /><PriceTag amount={order.total} /><Link to={`/orders/${encodeURIComponent(order.id)}`}>{t('orders')}</Link></>}</main>;
}

export function Orders() {
  const { t } = useI18n();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { get('/orders').then((result) => setOrders(result.orders)).catch((err) => setError(err.message)); }, []);
  return <main className="page"><h1>{t('orders')}</h1><ErrorMessage message={error} />{orders.map((order) => <OrderCard key={order.id} order={order} />)}{!orders.length && !error && <EmptyState title={t('orders')} />}</main>;
}

function OrderCard({ order }) {
  const { t } = useI18n();
  return <article className="order-card"><div><p className="eyebrow">{formatDate(order.createdAt)}</p><h2>{order.items.map((item) => item.titleSnapshot).join(', ')}</h2></div><PriceTag amount={order.total} /><StatusBadge status={order.status} /><Link className="button button-secondary" to={`/orders/${encodeURIComponent(order.id)}`}>{t('view')}</Link></article>;
}

export function OrderDetail() {
  const { id } = useParams();
  const { t } = useI18n();
  const { user } = useAuth();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [review, setReview] = useState({ rating: 5, comment: '' });
  const [message, setMessage] = useState('');
  const refresh = () => get(`/orders/${encodeURIComponent(id)}`).then((result) => setOrder(result.order)).catch((err) => setError(err.message));
  useEffect(() => { refresh(); }, [id]);
  const action = async (name) => {
    try { await post(`/orders/${encodeURIComponent(id)}/${name}`, {}); await refresh(); }
    catch (err) { setError(err.message); }
  };
  const submitReview = async (productId) => {
    try {
      await post(`/products/${encodeURIComponent(productId)}/reviews`, { orderId: id, ...review });
      setMessage('Review submitted.');
    } catch (err) { setError(err.message); }
  };
  if (!order) return <main className="page"><ErrorMessage message={error} /><Skeletons count={1} /></main>;
  const isBuyer = order.buyerUid === user?.uid;
  return <main className="page"><div className="page-heading"><h1>Order {order.id.slice(0, 8)}</h1><StatusBadge status={order.status} /></div><ErrorMessage message={error} /><p>{order.delivery.method} · {order.delivery.town}, {order.delivery.county}</p>{order.items.map((item) => <article className="order-line" key={item.productId}><span>{item.titleSnapshot} × {item.qty} {item.unit}</span><PriceTag amount={item.lineTotal} />{order.status === 'completed' && isBuyer && <form className="review-form" onSubmit={(event) => { event.preventDefault(); submitReview(item.productId); }}><label>{t('rating')}<select value={review.rating} onChange={(event) => setReview({ ...review, rating: Number(event.target.value) })}>{[5,4,3,2,1].map((rating) => <option key={rating}>{rating}</option>)}</select></label><label>{t('comment')}<textarea maxLength={500} value={review.comment} onChange={(event) => setReview({ ...review, comment: event.target.value })} /></label><button className="button button-secondary">{t('submitReview')}</button></form>}</article>)}<div className="action-row">{order.status === 'paid' && <button className="button button-primary" onClick={() => action('confirm')}>Confirm order</button>}{order.status === 'confirmed' && <button className="button button-primary" onClick={() => action('dispatch')}>Mark dispatched</button>}{order.status === 'dispatched' && <button className="button button-primary" onClick={() => action('deliver')}>Mark delivered</button>}{order.status === 'delivered' && isBuyer && <button className="button button-primary" onClick={() => action('complete')}>Mark received</button>}</div><p aria-live="polite">{message}</p></main>;
}

export function SellerDashboard() {
  const { t } = useI18n();
  const { products, loading, error } = useProducts('/me/products');
  const [orders, setOrders] = useState([]);
  useEffect(() => { get('/seller/orders').then((result) => setOrders(result.orders)).catch(() => {}); }, []);
  return <main className="page"><div className="section-heading"><h1>{t('sellerDashboard')}</h1><Link className="button button-primary" to="/seller/products/new">{t('newProduct')}</Link></div><ErrorMessage message={error} /><div className="dashboard-grid"><Link className="dashboard-tile" to="/seller/products"><strong>{products.length}</strong>{t('myProducts')}</Link><Link className="dashboard-tile" to="/seller/orders"><strong>{orders.length}</strong>{t('sellerOrders')}</Link><Link className="dashboard-tile" to="/seller/profile">{t('sellerProfile')}</Link></div>{loading ? <Skeletons /> : <ProductGrid products={products} />}</main>;
}

export function SellerProducts() {
  const { t } = useI18n();
  const { products, loading, error } = useProducts('/me/products');
  return <main className="page"><div className="section-heading"><h1>{t('myProducts')}</h1><Link className="button button-primary" to="/seller/products/new">{t('newProduct')}</Link></div><ErrorMessage message={error} />{loading ? <Skeletons /> : <div className="product-grid">{products.map((product) => <article className="product-card" key={product.id}><ProductSummary product={product} /><Link className="button button-secondary" to={`/seller/products/${encodeURIComponent(product.id)}/edit`}>{t('editProduct')}</Link></article>)}</div>}</main>;
}

function ProductSummary({ product }) {
  return <div className="product-card-body"><p className="eyebrow">{product.category}</p><h2>{product.title}</h2><PriceTag amount={product.pricePerUnit} unit={product.unit} /><StatusBadge status={product.status} /><p>{product.quantityAvailable} available</p></div>;
}

async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, 1200 / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image compression is not available in this browser.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not compress this image.')), 'image/webp', 0.82));
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp' });
}

export function ProductForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { t } = useI18n();
  const navigate = useNavigate();
  const { position, error: locationError, locate } = useGeolocation();
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', category: 'vegetables', unit: 'kg', pricePerUnit: '', minOrder: '1', quantityAvailable: '', county: '', town: '', latitude: '', longitude: '' });
  const [files, setFiles] = useState([]);
  const [existingImages, setExistingImages] = useState([]);
  const [removedImageKeys, setRemovedImageKeys] = useState([]);
  const [filePreviews, setFilePreviews] = useState([]);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    get('/categories').then((result) => setCategories(result.categories)).catch((err) => setError(err.message));
    if (editing) get(`/products/${encodeURIComponent(id)}`).then(({ product }) => {
      setForm((current) => ({ ...current, ...product, county: product.location?.county || '', town: product.location?.town || '' }));
      setExistingImages(product.images || []);
    }).catch((err) => setError(err.message));
  }, [id]);
  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setFilePreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);
  useEffect(() => {
    if (position) setForm((current) => ({ ...current, latitude: position.lat, longitude: position.lng }));
  }, [position]);
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const chooseFiles = async (event) => {
    const capacity = Math.max(0, 5 - existingImages.length - files.length);
    const selected = [...event.target.files].slice(0, capacity);
    const compressed = [];
    const errors = [];
    for (const file of selected) {
      try { compressed.push(await compressImage(file)); }
      catch (err) { errors.push(`${file.name}: ${err.message}`); }
    }
    setFiles((current) => [...current, ...compressed].slice(0, 5));
    setError(errors.join(' '));
    event.target.value = '';
  };
  const save = async (event) => {
    event.preventDefault();
    if (!form.title.trim() || !form.description.trim() || !form.county || !form.town
      || Number(form.pricePerUnit) < 1 || Number(form.quantityAvailable) <= 0) {
      setError('Complete the required fields with a positive price and quantity.');
      return;
    }
    if (!editing && !files.length) { setError(t('imageRequired')); return; }
    const data = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (value !== '' && ['title', 'description', 'category', 'unit', 'pricePerUnit', 'minOrder', 'quantityAvailable', 'county', 'town', 'latitude', 'longitude'].includes(key)) data.append(key, value);
    });
    if (editing) {
      data.append('imageOrder', JSON.stringify(existingImages.map((image) => image.key)));
      data.append('removeImageKeys', JSON.stringify(removedImageKeys));
    }
    files.forEach((file) => data.append('images', file));
    setSaving(true);
    setError('');
    try {
      const result = await upload(editing ? `/products/${encodeURIComponent(id)}` : '/products', data, setProgress, editing ? 'PATCH' : 'POST');
      navigate('/seller/products');
      return result;
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };
  return <main className="page narrow-page"><h1>{editing ? t('editProduct') : t('newProduct')}</h1><form className="stack-form" onSubmit={save}>
    <label>{t('title')}<input required maxLength={160} value={form.title} onChange={update('title')} /></label>
    <label>{t('description')}<textarea required maxLength={5000} value={form.description} onChange={update('description')} /></label>
    <label>{t('category')}<select value={form.category} onChange={update('category')}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
    <label>{t('unit')}<select value={form.unit} onChange={update('unit')}>{['kg','g','bag','crate','bunch','piece','litre','tray'].map((unit) => <option key={unit}>{unit}</option>)}</select></label>
    <label>{t('price')}<input type="number" min="1" step="1" required value={form.pricePerUnit} onChange={update('pricePerUnit')} /></label>
    <label>{t('stock')}<input type="number" min="0.001" step="any" required value={form.quantityAvailable} onChange={update('quantityAvailable')} /></label>
    <label>{t('minimum')}<input type="number" min="0.001" step="any" required value={form.minOrder} onChange={update('minOrder')} /></label>
    <label>{t('county')}<select required value={form.county} onChange={update('county')}><option value="">—</option>{COUNTIES.map((county) => <option key={county}>{county}</option>)}</select></label>
    <label>{t('town')}<input required value={form.town} onChange={update('town')} /></label>
    <button type="button" className="button button-secondary" onClick={locate}>{t('useLocation')}</button><small>{t('locationPrivacy')}</small><ErrorMessage message={locationError} />
    <label>{t('photos')}<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={chooseFiles} /></label>
    <div className="image-reorder">{existingImages.map((image, index) => <div key={image.key}><img src={image.thumbUrl} alt="" width="72" height="72" /><button type="button" aria-label="Move image earlier" disabled={!index} onClick={() => setExistingImages((items) => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>↑</button><button type="button" aria-label="Move image later" disabled={index === existingImages.length - 1} onClick={() => setExistingImages((items) => { const next = [...items]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}>↓</button><button type="button" aria-label="Remove image" onClick={() => { setRemovedImageKeys((keys) => [...keys, image.key]); setExistingImages((items) => items.filter((entry) => entry.key !== image.key)); }}>×</button></div>)}
      {files.map((file, index) => <div key={`${file.name}-${index}`}><img src={filePreviews[index]} alt={file.name} width="72" height="72" /><button type="button" aria-label="Remove new image" onClick={() => setFiles((items) => items.filter((_entry, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>
    {saving && <progress max="100" value={progress} aria-label={t('uploading')} />}
    <ErrorMessage message={error} /><button className="button button-primary" disabled={saving}>{saving ? `${t('uploading')} ${progress}%` : t('save')}</button>
  </form></main>;
}

export function SellerOrders() {
  const { t } = useI18n();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { get('/seller/orders').then((result) => setOrders(result.orders)).catch((err) => setError(err.message)); }, []);
  return <main className="page"><h1>{t('sellerOrders')}</h1><ErrorMessage message={error} />{orders.map((order) => <OrderCard key={order.id} order={order} />)}{!orders.length && !error && <EmptyState title={t('sellerOrders')} />}</main>;
}

export function SellerProfile() {
  const { t } = useI18n();
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const current = profile?.sellerProfile || {};
  const [form, setForm] = useState({ displayName: current.displayName || '', bio: current.bio || '', county: current.county || '', town: current.town || '' });
  const [error, setError] = useState('');
  const save = async (event) => {
    event.preventDefault();
    try {
      await put('/me/seller-profile', form);
      await refreshProfile();
      navigate('/seller');
    } catch (err) { setError(err.message); }
  };
  const update = (key) => (event) => setForm((value) => ({ ...value, [key]: event.target.value }));
  return <main className="page narrow-page"><h1>{t('sellerProfile')}</h1><form className="stack-form" onSubmit={save}><label>{t('displayName')}<input required maxLength={100} value={form.displayName} onChange={update('displayName')} /></label><label>{t('bio')}<textarea maxLength={1000} value={form.bio} onChange={update('bio')} /></label><label>{t('county')}<select required value={form.county} onChange={update('county')}><option value="">—</option>{COUNTIES.map((county) => <option key={county}>{county}</option>)}</select></label><label>{t('town')}<input required value={form.town} onChange={update('town')} /></label><ErrorMessage message={error} /><button className="button button-primary">{t('createSellerProfile')}</button></form></main>;
}

export function AdminHome() {
  const { t } = useI18n();
  return <main className="page"><h1>{t('admin')}</h1><div className="dashboard-grid"><Link className="dashboard-tile" to="/admin/listings">{t('adminListings')}</Link><Link className="dashboard-tile" to="/admin/reports">{t('listingReports')}</Link><Link className="dashboard-tile" to="/admin/orders">{t('adminOrders')}</Link></div></main>;
}

export function AdminReports() {
  const { t } = useI18n();
  const [reports, setReports] = useState([]);
  const [reasons, setReasons] = useState({});
  const [error, setError] = useState('');
  const load = () => get('/admin/reports').then((result) => setReports(result.reports)).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);
  const takeDown = async (report) => {
    try {
      await post(`/admin/reports/${encodeURIComponent(report.id)}/takedown`, { reason: reasons[report.id] || '' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };
  return <main className="page"><h1>{t('listingReports')}</h1><ErrorMessage message={error} />
    {reports.map((report) => <article className="order-card" key={report.id}>
      <p><Link to={`/products/${encodeURIComponent(report.productId)}`}>{report.productId}</Link> · {t(`report_${report.reason}`)}</p>
      {report.details && <p>{report.details}</p>}
      <label>{t('takedownReason')}<input value={reasons[report.id] || ''} maxLength={300} onChange={(event) => setReasons((current) => ({ ...current, [report.id]: event.target.value }))} /></label>
      <button className="button button-secondary" disabled={!(reasons[report.id] || '').trim()} onClick={() => takeDown(report)}>{t('takeDownListing')}</button>
    </article>)}
    {!reports.length && !error && <EmptyState title={t('noListingReports')} />}
  </main>;
}

export function AdminListings() {
  const { t } = useI18n();
  const [products, setProducts] = useState([]);
  const [error, setError] = useState('');
  const load = () => get('/admin/listings').then((result) => setProducts(result.products)).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);
  const moderate = async (id, action) => {
    try { await post(`/admin/listings/${encodeURIComponent(id)}/${action}`, {}); await load(); }
    catch (err) { setError(err.message); }
  };
  return <main className="page"><h1>{t('adminListings')}</h1><ErrorMessage message={error} />{products.map((product) => <article className="order-card" key={product.id}><ProductSummary product={product} /><button className="button button-primary" onClick={() => moderate(product.id, 'approve')}>{t('approve')}</button><button className="button button-secondary" onClick={() => moderate(product.id, 'reject')}>{t('reject')}</button></article>)}</main>;
}

export function AdminOrders() {
  const { t } = useI18n();
  const [orders, setOrders] = useState([]);
  const [payments, setPayments] = useState([]);
  const [error, setError] = useState('');
  const exportOrders = async () => {
    try {
      const csv = await get('/admin/orders.csv');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'agristore-orders.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err.message); }
  };
  useEffect(() => {
    Promise.all([get('/admin/orders'), get('/admin/payments')])
      .then(([orderResult, paymentResult]) => { setOrders(orderResult.orders); setPayments(paymentResult.payments); })
      .catch((err) => setError(err.message));
  }, []);
  return <main className="page"><div className="section-heading"><h1>{t('adminOrders')}</h1><button className="button button-secondary" onClick={exportOrders}>{t('exportCsv')}</button></div><ErrorMessage message={error} /><h2>{t('orders')}</h2>{orders.map((order) => <OrderCard key={order.id} order={order} />)}<h2>Payments</h2>{payments.map((payment) => <article className="order-card" key={payment.id}><span>{payment.orderId}</span><PriceTag amount={payment.amount} /><StatusBadge status={payment.status} /></article>)}</main>;
}

export function SignIn() {
  const { t } = useI18n();
  const { signIn, signInGoogle, createAccount } = useAuth();
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [phone, setPhone] = useState('');
  const [verification, setVerification] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const action = async (callback) => {
    setError('');
    try { await callback(); navigate('/account'); }
    catch (err) { setError(err.message); }
  };
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return <main className="page narrow-page"><h1>{t('signIn')}</h1><form className="stack-form" onSubmit={(event) => { event.preventDefault(); action(() => creating ? createAccount(form.email, form.password, form.name) : signIn(form.email, form.password)); }}><label>{t('email')}<input type="email" autoComplete="email" required value={form.email} onChange={update('email')} /></label>{creating && <label>{t('displayName')}<input value={form.name} onChange={update('name')} /></label>}<label>{t('password')}<input type="password" autoComplete={creating ? 'new-password' : 'current-password'} required minLength="6" value={form.password} onChange={update('password')} /></label><button className="button button-primary">{creating ? t('createAccount') : t('signIn')}</button></form><button className="button button-secondary full-width" onClick={() => action(signInGoogle)}>{t('googleSignIn')}</button><button className="text-button" onClick={() => setCreating((value) => !value)}>{creating ? t('signIn') : t('createAccount')}</button>{phoneAuthEnabled && <section className="phone-auth"><h2>{t('phoneSignIn')}</h2><label>{t('phone')}<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label><div id="phone-recaptcha" /><button className="button button-secondary" onClick={async () => { try { setVerification(await sendPhoneCode(phone, 'phone-recaptcha')); setMessage('Verification code sent.'); } catch (err) { setError(err.message); } }}>Send code</button>{verification && <><label>Code<input value={code} onChange={(event) => setCode(event.target.value)} /></label><button className="button button-primary" onClick={() => action(() => verification.confirm(code))}>Verify</button></>}</section>}<ErrorMessage message={error} /><p aria-live="polite">{message}</p></main>;
}

export function Account() {
  const { t } = useI18n();
  const { user, profile } = useAuth();
  if (!user) return <Navigate to="/sign-in" replace />;
  return <main className="page"><h1>{t('account')}</h1><p>{user.displayName || user.email}</p><p>{profile?.username || user.uid}</p><div className="action-row"><Link className="button button-secondary" to="/seller/profile">{t('sellerProfile')}</Link><Link className="button button-secondary" to="/orders">{t('orders')}</Link></div></main>;
}

export function NotFound() {
  const { t } = useI18n();
  return <main className="page"><EmptyState title={t('notFound')} action={<Link to="/">{t('home')}</Link>} /></main>;
}

export { phonePattern };
