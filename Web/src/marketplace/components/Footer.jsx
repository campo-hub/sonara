import { Link } from 'react-router-dom';
import { useI18n } from '../hooks/useI18n.jsx';

export function Footer() {
  const { t } = useI18n();
  return <footer className="site-footer"><span>© {new Date().getFullYear()} {t('brand')}</span><Link to="/seller/profile">{t('sellerProfile')}</Link></footer>;
}
