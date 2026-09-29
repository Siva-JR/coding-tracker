export class HttpError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Domain validation failure (as opposed to a malformed request): 422 by default, with every problem listed.
export class ValidationError extends HttpError {
  constructor(errors, { status = 422, code = 'VALIDATION_FAILED' } = {}) {
    super(status, code, errors.join('; '), { errors });
    this.errors = errors;
  }
}

export const bad = (message) => new HttpError(400, 'BAD_REQUEST', message);

export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function parseInteger(value, name, { min, max }) {
  if (!/^\d+$/.test(String(value))) throw bad(`${name} must be a whole number`);
  const n = Number(value);
  if (n < min || n > max) throw bad(`${name} must be between ${min} and ${max}`);
  return n;
}

// Validates a request body with a zod schema and returns the parsed value.
export function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw bad(result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return result.data;
}
