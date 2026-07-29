export function formatViNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatViPercent(value: number, fractionDigits = 1): string {
  return `${formatViNumber(value, fractionDigits)}%`;
}

export function formatViFlexiblePercent(value: number): string {
  return formatViPercent(value, Number.isInteger(value) ? 0 : 1);
}

export function localizePercentagesInText(value: string): string {
  return value.replace(/(\d+)\.(\d+)%/g, "$1,$2%");
}
