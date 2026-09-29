const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryable = (status) => status === 429 || status >= 500;

// Never throws. Resolves to { ok: true, status, data } or { ok: false, status, error, retryable }.
export async function requestJson(url, { method = 'GET', body, timeoutMs = 10000, retries = 2, backoffMs = 1000 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok) {
        try {
          return { ok: true, status: res.status, data: await res.json() };
        } catch {
          last = { ok: false, status: res.status, error: 'Response was not valid JSON', retryable: false };
          break;
        }
      }

      last = { ok: false, status: res.status, error: `HTTP ${res.status}`, retryable: isRetryable(res.status) };
      if (!last.retryable) break;
    } catch (err) {
      last = { ok: false, status: 0, error: err?.name === 'TimeoutError' ? 'Request timed out' : `Network error: ${err?.message}`, retryable: true };
    }
  }
  return last;
}
