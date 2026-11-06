export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response;
  try {
    response = await fetch('/api' + path, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Не удалось связаться с сервером. Проверьте, что API запущен.');
  }

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload.detail === 'string'
        ? payload.detail
        : 'Не удалось выполнить запрос. Попробуйте ещё раз.';
    throw new ApiError(response.status, message);
  }
  return payload;
}
