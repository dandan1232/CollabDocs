export class RequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

export type RequestJsonOptions = RequestInit & {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
};

function retryAfterMilliseconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function responseMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || !("error" in data)) return undefined;
  const error = data.error;
  if (!error || typeof error !== "object" || !("message" in error)) {
    return undefined;
  }
  return typeof error.message === "string" ? error.message : undefined;
}

async function parseResponse(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body) return undefined;

  try {
    return JSON.parse(body) as unknown;
  } catch {
    if (!response.ok) return undefined;
    throw new RequestError("服务器返回了无法识别的响应，请稍后重试。", 502);
  }
}

export function isRetriableRequestError(error: unknown): boolean {
  if (error instanceof RequestError) {
    return (
      error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500
    );
  }

  return (
    error instanceof TypeError ||
    (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

function normalizeRequestError(error: unknown): unknown {
  if (error instanceof RequestError) return error;
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return new RequestError("请求超时，请检查网络后重试。", 408);
  }
  if (error instanceof TypeError) {
    return new RequestError("网络连接失败，请检查网络后重试。", 503);
  }
  return error;
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export async function requestJson<T>(
  url: string,
  options: RequestJsonOptions = {},
): Promise<T> {
  const {
    timeoutMs = 10_000,
    retries = 0,
    retryDelayMs = 350,
    ...requestInit
  } = options;
  const headers = new Headers(requestInit.headers);
  if (requestInit.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = requestInit.signal
        ? AbortSignal.any([requestInit.signal, timeoutSignal])
        : timeoutSignal;
      const response = await fetch(url, {
        ...requestInit,
        headers,
        signal,
      });
      const data = await parseResponse(response);

      if (!response.ok) {
        throw new RequestError(
          responseMessage(data) ??
            `请求失败（HTTP ${response.status}），请稍后重试。`,
          response.status,
          retryAfterMilliseconds(response),
        );
      }

      return data as T;
    } catch (error) {
      if (requestInit.signal?.aborted) {
        throw error;
      }
      if (attempt >= retries || !isRetriableRequestError(error)) {
        throw normalizeRequestError(error);
      }

      const retryAfter =
        error instanceof RequestError ? error.retryAfterMs : undefined;
      await wait(
        Math.max(retryDelayMs * 2 ** attempt, retryAfter ?? 0),
        requestInit.signal ?? undefined,
      );
    }
  }
}
