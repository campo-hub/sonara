import { useI18n } from '../hooks/useI18n.jsx';

export function StatusBadge({ status }) {
  const { t } = useI18n();
  return <span className={`status-badge status-${String(status).replaceAll('_', '-')}`}>{t(`status_${status}`)}</span>;
}
