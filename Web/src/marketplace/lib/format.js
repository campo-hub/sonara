export function formatDate(value, locale = 'en-KE') {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}
