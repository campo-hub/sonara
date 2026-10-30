import { useI18n } from '../hooks/useI18n.jsx';

export function FilterBar({ filters, onChange, categories, counties }) {
  const { t } = useI18n();
  return (
    <form className="filter-bar" onSubmit={(event) => event.preventDefault()}>
      <label>
        <span>{t('search')}</span>
        <input value={filters.q} onChange={(event) => onChange('q', event.target.value)} placeholder={t('searchPlaceholder')} />
      </label>
      <label>
        <span>{t('category')}</span>
        <select value={filters.category} onChange={(event) => onChange('category', event.target.value)}>
          <option value="">{t('allCategories')}</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
      <label>
        <span>{t('county')}</span>
        <select value={filters.county} onChange={(event) => onChange('county', event.target.value)}>
          <option value="">{t('allCounties')}</option>
          {counties.map((county) => <option key={county}>{county}</option>)}
        </select>
      </label>
      <label><span>{t('minPrice')}</span><input inputMode="numeric" value={filters.minPrice} onChange={(event) => onChange('minPrice', event.target.value)} /></label>
      <label><span>{t('maxPrice')}</span><input inputMode="numeric" value={filters.maxPrice} onChange={(event) => onChange('maxPrice', event.target.value)} /></label>
      <label>
        <span>{t('sort')}</span>
        <select value={filters.sort} onChange={(event) => onChange('sort', event.target.value)}>
          <option value="newest">{t('newest')}</option>
          <option value="price_asc">{t('priceAsc')}</option>
          <option value="price_desc">{t('priceDesc')}</option>
          <option value="top_rated">{t('topRated')}</option>
        </select>
      </label>
    </form>
  );
}
