import { Link } from 'react-router-dom';
import { PriceTag } from './PriceTag.jsx';

export function ProductCard({ product }) {
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
      </div>
    </article>
  );
}
