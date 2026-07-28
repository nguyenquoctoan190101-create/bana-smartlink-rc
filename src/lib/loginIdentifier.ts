const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STAFF_PHONE_PATTERN = /^(?:\+84|0)\d{9,10}$/;

export function resolveStaffLoginEmail(value: string): string | null {
  const identifier = value.trim();
  if (identifier.includes("@")) {
    return BASIC_EMAIL_PATTERN.test(identifier)
      ? identifier.toLocaleLowerCase("vi-VN")
      : null;
  }
  const compactPhone = identifier.replace(/[\s().-]/g, "");
  const normalizedPhone = compactPhone.startsWith("+84")
    ? `0${compactPhone.slice(3)}`
    : compactPhone;
  return STAFF_PHONE_PATTERN.test(normalizedPhone)
    ? `${normalizedPhone}@bana.local`
    : null;
}
