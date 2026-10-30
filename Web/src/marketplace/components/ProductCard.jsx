import { Link } from 'react-router-dom';
import { PriceTag } from './PriceTag.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useI18n } from '../hooks/useI18n.jsx';

export function ProductCard({ product }) {
  const { user } = useAuth();
  const { t } = useI18n();
  return (
    <article className="product-card">
      <Link to={`/products/${encodeURIComponent(product.id)}`} className="product-card-image">
        {product.thumbUrl
          ? <img src={product.thumbUrl} alt="" loading="lazy" width="480" height="360" />
          : <span className="image-placeholder" aria-hidden="true">🌱</span>}
      </Link>
      <div className="product-card-body">
        <p className="eyebrow">{product.category} · {product.location?.county || ''}</p>
        <h2><Link to={`/products/${encodeURIComponent(product.id)}`}>{product.title}</Link></h2>
        <PriceTag amount={product.pricePerUnit} unit={product.unit} />
        {product.ratingCount > 0 && <span className="rating">★ {product.ratingAvg} ({product.ratingCount})</span>}
        <Link className="text-button" to={`/compare/${encodeURIComponent(product.id)}`}>{t('comparePrices')}</Link>
        {user?.uid !== product.sellerUid && <Link className="button button-secondary" to={`/messages/new?productId=${encodeURIComponent(product.id)}`}>{t('contactFarmer')}</Link>}
      </div>
    </article>
  );
}
