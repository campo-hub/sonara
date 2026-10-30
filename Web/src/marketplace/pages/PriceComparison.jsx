import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';
import { ErrorMessage } from './Shared.jsx';
import { priceComparisonPath } from '../lib/featureUtils.js';
import { useI18n } from '../hooks/useI18n.jsx';

export function PriceComparisonPanel({ product }) {
  const { t } = useI18n();
  const [countyOnly, setCountyOnly] = useState(false);
  const [comparisons, setComparisons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const county = countyOnly ? product.location?.county || '' : '';
    setLoading(true);
    get(priceComparisonPath(product.id, county))
      .then((result) => { if (active) setComparisons(result.comparisons || []); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [product.id, countyOnly, product.location?.county]);
  return (
    <section className="comparison-panel" aria-labelledby="comparison-title">
      <div className="section-heading">
        <h2 id="comparison-title">{t('comparePrices')}</h2>
        <label className="inline-control"><input type="checkbox" checked={countyOnly} onChange={(event) => setCountyOnly(event.target.checked)} /> {t('sameCounty')}</label>
      </div>
      <p>{t('comparisonDescription')} {product.category}, {t('sortedByUnit')} {product.unit}.</p>
      <p className="comparison-current"><strong>{t('thisListing')}</strong> · {product.location?.county} · {formatMoney(product.pricePerUnit)} / {product.unit}</p>
      {error && <ErrorMessage message={error} />}
      {loading ? <p role="status">{t('comparisonLoading')}</p> : comparisons.length ? (
        <ul className="comparison-list">{comparisons.map(({ product: item, seller }) => (
          <li key={item.id}>
            <Link to={`/products/${encodeURIComponent(item.id)}`}>{item.title}</Link>
            <span>{formatMoney(item.pricePerUnit)} / {item.unit}</span>
            <span>{seller?.displayName || t('farmer')} · {item.location?.town}, {item.location?.county}</span>
            <span>{item.ratingCount ? `★ ${item.ratingAvg} (${item.ratingCount})` : t('notRated')}</span>
          </li>
        ))}</ul>
      ) : <p>{t('noSimilarListings')}</p>}
    </section>
  );
}

export function CompareView() {
  const { t } = useI18n();
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    get(`/products/${encodeURIComponent(id)}`).then(({ product: item }) => setProduct(item)).catch((err) => setError(err.message));
  }, [id]);
  return <main className="page">
    <p className="eyebrow"><Link to="/browse">{t('browse')}</Link></p>
    <h1>{t('comparePrices')}</h1>
    {error ? <ErrorMessage message={error} /> : product ? <PriceComparisonPanel product={product} /> : <p role="status">{t('loading')}</p>}
  </main>;
}
