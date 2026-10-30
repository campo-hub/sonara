import { formatMoney } from '../lib/money.js';

export function PriceTag({ amount, unit }) {
  return <span className="price-tag">{formatMoney(amount)}{unit ? <small> / {unit}</small> : null}</span>;
}
