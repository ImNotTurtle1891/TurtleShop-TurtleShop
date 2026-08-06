const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
});

const COUNT_FORMATTER = new Intl.NumberFormat('en-US');

export function formatUsd(amount: number): string {
  return USD_FORMATTER.format(amount);
}

export function formatPrice(amount: number, currency: string): string {
  return currency === 'USD' ? `$${amount.toFixed(2)}` : `${amount.toFixed(2)} ${currency}`;
}

export function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}\u2026`;
}

export function formatCount(count: number): string {
  return COUNT_FORMATTER.format(count);
}

/**
 * Percentage change vs the previous period. The API's own *Change fields are
 * unusable when the previous period is zero, so it is computed here instead.
 */
export function formatChange(current: number, previous: number): string {
  if (previous === 0) {
    return current === 0 ? 'no change' : 'new';
  }
  const percent = ((current - previous) / previous) * 100;
  const arrow = percent >= 0 ? '\u25B2' : '\u25BC';
  return `${arrow} ${Math.abs(percent).toFixed(1)}%`;
}

/**
 * Masks an email for display in Discord: keeps the first two characters of
 * the local part and the full domain, e.g. "jo****@gmail.com".
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) {
    return '***';
  }
  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  const visible = localPart.slice(0, Math.min(2, localPart.length));
  return `${visible}${'*'.repeat(Math.max(localPart.length - visible.length, 2))}${domain}`;
}
