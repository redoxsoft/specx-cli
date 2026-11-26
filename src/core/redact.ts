const SECRET_KEY_REGEX = /authorization|token|secret|password|api[-_]?key/i;

export function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  // Null prototype so a "__proto__" key cannot change this object's prototype.
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'headers' || key === 'http_headers') {
      result[key] = '<redacted>';
    } else if (SECRET_KEY_REGEX.test(key) && typeof val === 'string') {
      result[key] = '<redacted>';
    } else {
      result[key] = redact(val);
    }
  }
  return result;
}
