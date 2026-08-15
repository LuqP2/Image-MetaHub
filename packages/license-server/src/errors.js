export class LicenseError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'LicenseError';
    this.code = code;
    this.status = status;
  }
}

export function requireValue(condition, code, message, status = 400) {
  if (!condition) {
    throw new LicenseError(code, message, status);
  }
}
