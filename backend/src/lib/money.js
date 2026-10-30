const wholeShillingInput = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/;

function assertAmount(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError('Amount must be a non-negative safe integer number of KES.');
  }
  return amount;
}

export function parseMoney(value) {
  if (typeof value === 'number') return assertAmount(value);
  if (typeof value !== 'string') {
    throw new TypeError('Amount must be an integer or a whole-shilling string.');
  }

  const normalized = value.trim().replace(/^KES\s*/i, '');
  if (!wholeShillingInput.test(normalized)) {
    throw new TypeError('Amount must use whole shillings without decimals.');
  }
  const amount = Number(normalized.replaceAll(',', ''));
  return assertAmount(amount);
}

export function formatMoney(amount) {
  assertAmount(amount);
  return `KES ${new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 }).format(amount)}`;
}
