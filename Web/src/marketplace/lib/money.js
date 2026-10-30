export function parseMoney(value) {
  const normalized = String(value ?? '').trim().replace(/^KES\s*/i, '').replaceAll(',', '');
  if (!/^\d+$/.test(normalized)) throw new TypeError('Amount must be a whole number of Kenyan shillings.');
  const amount = Number(normalized);
  if (!Number.isSafeInteger(amount)) throw new TypeError('Amount exceeds the supported range.');
  return amount;
}

export function formatMoney(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError('Money must be a non-negative integer.');
  return `KES ${new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 }).format(amount)}`;
}
