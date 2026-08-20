import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushErrorReporterForTests,
  initErrorReporter,
  reportClientError,
  reportReactError,
  resetErrorReporterForTests,
} from '../error-reporter';

function jsonResponse(status: number, body: unknown = { success: true }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('error-reporter', () => {
  beforeEach(() => {
    resetErrorReporterForTests();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    resetErrorReporterForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('POSTs to /api/client-errors with message, stack, url, and userAgent', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(200));

    reportClientError({
      message: 'boom',
      stack: 'Error: boom\n    at foo',
      component: 'Test',
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('/api/client-errors');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
    });
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.message).toBe('boom');
    expect(body.stack).toBe('Error: boom\n    at foo');
    expect(body.component).toBe('Test');
    expect(body.url).toBe(window.location.href);
    expect(body.userAgent).toBe(navigator.userAgent);
  });

  it('falls back to /api/system-errors/report when /api/client-errors is missing', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(404, { error: 'Not Found' }))
      .mockResolvedValueOnce(jsonResponse(200));

    reportClientError({ message: 'missing endpoint', component: 'Test' });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/client-errors');
    expect(String(fetchMock.mock.calls[1]![0])).toBe('/api/system-errors/report');
    const body = JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body));
    expect(body).toMatchObject({
      level: 'error',
      component: 'Test',
      message: 'missing endpoint',
    });
    expect(body.metadata.url).toBe(window.location.href);
  });

  it('logs to console when neither endpoint is available', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(404))
      .mockResolvedValueOnce(jsonResponse(404));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    reportClientError({ message: 'nowhere to go', component: 'Test' });

    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(errorSpy.mock.calls[0]![0]).toBe('[client-error]');
    expect(errorSpy.mock.calls[0]![1]).toMatchObject({ message: 'nowhere to go' });
  });

  it('deduplicates identical errors within the window', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(200));

    reportClientError({ message: 'repeat', component: 'Test' });
    reportClientError({ message: 'repeat', component: 'Test' });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reportReactError includes componentStack', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(200));

    reportReactError(new Error('render failed'), { componentStack: '\n    in Foo' });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.component).toBe('ReactErrorBoundary');
    expect(body.message).toBe('render failed');
    expect(body.componentStack).toBe('\n    in Foo');
  });

  it('initErrorReporter captures window error and unhandledrejection', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(200));
    initErrorReporter();

    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'script boom',
        filename: 'app.js',
        lineno: 10,
        colno: 4,
        error: new Error('script boom'),
      }),
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const first = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(first.component).toBe('GlobalWindowError');
    expect(first.message).toBe('script boom');
    expect(first.metadata).toMatchObject({ filename: 'app.js', lineno: 10, colno: 4 });

    fetchMock.mockClear();
    const addSpy = vi.spyOn(window, 'addEventListener');
    resetErrorReporterForTests();
    initErrorReporter();
    const rejectionHandler = addSpy.mock.calls.find(([type]) => type === 'unhandledrejection')?.[1] as
      | ((event: { reason?: unknown }) => void)
      | undefined;
    expect(rejectionHandler).toEqual(expect.any(Function));
    rejectionHandler!({ reason: new Error('no await') });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const second = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(second.component).toBe('UnhandledRejection');
    expect(second.message).toBe('no await');
  });

  it('queues failed posts and flushes when back online', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new TypeError('network'));
    fetchMock.mockResolvedValue(jsonResponse(200));
    reportClientError({ message: 'offline', component: 'Test' });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await flushErrorReporterForTests();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toBe('/api/client-errors');
  });
});
