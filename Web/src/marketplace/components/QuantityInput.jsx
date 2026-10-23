import { useI18n } from '../hooks/useI18n.jsx';

export function QuantityInput({ value, onChange, min = 0.1, max, label }) {
  const { t } = useI18n();
  return (
    <label className="quantity-input">
      <span>{label || t('quantity')}</span>
      <input type="number" min={min} max={max} step="any" value={value}
        onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
