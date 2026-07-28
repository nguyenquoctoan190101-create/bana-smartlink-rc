export function formatViNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatViPercent(value: number, fractionDigits = 1): string {
  return `${formatViNumber(value, fractionDigits)}%`;
}
