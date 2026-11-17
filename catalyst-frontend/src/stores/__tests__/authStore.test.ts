import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  reportSystemError: vi.fn(),
  loginGuard: { active: false, enter: vi.fn(), exit: vi.fn() },
}));

vi.mock('../../services/api/auth', () => ({
  authApi: {
    refresh: mocks.refresh,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    verifyTwoFactor: vi.fn(),
  },
}));
vi.mock('../../services/api/systemErrors', () => ({
  reportSystemError: mocks.reportSystemError,
}));
vi.mock('../../services/api/client', () => ({ loginGuard: mocks.loginGuard }));

import i18n from '../../i18n';
import { useAuthStore } from '../authStore';
import type { User } from '../../types/user';

const baseUser: User = {
  id: 'user-1',
  email: 'user@example.com',
  username: 'user',
  role: 'user',
  permissions: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function statusError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.reportSystemError.mockReset();
  mocks.loginGuard.active = false;
  useAuthStore.setState({
    user: null,
    token: null,
    rememberMe: false,
    isAuthenticated: false,
    isLoading: false,
    isReady: false,
    isRefreshing: false,
    sessionCheckFailed: false,
    error: null,
  });
});

describe('authStore session bootstrap', () => {
  it('does not mark auth ready until the session probe answers', async () => {
    const probe = deferred<{ user: User }>();
    mocks.refresh.mockReturnValueOnce(probe.promise);

    const initPromise = useAuthStore.getState().init();
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    // The reported bug: isReady flipped before the session question was answered.
    expect(useAuthStore.getState().isReady).toBe(false);

    probe.resolve({ user: baseUser });
    await initPromise;

    const state = useAuthStore.getState();
    expect(state.isReady).toBe(true);
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.id).toBe(baseUser.id);
  });

  it('never writes isReady from a background refresh()', async () => {
    mocks.refresh.mockResolvedValueOnce({ user: baseUser });

    await useAuthStore.getState().refresh();

    const state = useAuthStore.getState();
    expect(state.isReady).toBe(false);
    expect(state.isAuthenticated).toBe(true);
  });

  it('settles a 401 into a signed-out, ready state', async () => {
    mocks.refresh.mockRejectedValueOnce(statusError('Unauthorized', 401));

    await expect(useAuthStore.getState().init()).rejects.toThrow('Unauthorized');

    const state = useAuthStore.getState();
    expect(state.isReady).toBe(true);
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
  });

  it('keeps a live session and explains a transient failure after boot', async () => {
    useAuthStore.setState({ user: baseUser, isAuthenticated: true, isReady: true });
    mocks.refresh.mockRejectedValueOnce(statusError('Server error', 500));

    await expect(useAuthStore.getState().refresh()).rejects.toThrow('Server error');

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toEqual(baseUser);
    expect(state.isReady).toBe(true);
    expect(state.error).toBe(i18n.t('sessionCheck.failed'));
  });

  it('flags a transient boot-probe failure so App can offer a retry', async () => {
    mocks.refresh.mockRejectedValueOnce(statusError('Service unavailable', 503));

    await expect(useAuthStore.getState().init()).rejects.toThrow('Service unavailable');

    let state = useAuthStore.getState();
    expect(state.isReady).toBe(true);
    expect(state.isAuthenticated).toBe(false);
    expect(state.sessionCheckFailed).toBe(true);
    expect(state.error).toBe(i18n.t('sessionCheck.failed'));

    // A retry that fails the same way (429 from the cooldown short-circuit, say)
    // must keep the retry screen up rather than dismissing it into /login.
    mocks.refresh.mockRejectedValueOnce(statusError('Refresh cooldown active', 429));
    await expect(useAuthStore.getState().init()).rejects.toThrow('Refresh cooldown active');

    state = useAuthStore.getState();
    expect(state.sessionCheckFailed).toBe(true);
    expect(state.isAuthenticated).toBe(false);

    // A retry that answers clears the screen.
    mocks.refresh.mockResolvedValueOnce({ user: baseUser });
    await useAuthStore.getState().init();
    state = useAuthStore.getState();
    expect(state.sessionCheckFailed).toBe(false);
    expect(state.isAuthenticated).toBe(true);
  });

  it('answers the boot question once when init() and a background refresh overlap', async () => {
    const backgroundProbe = deferred<{ user: User }>();
    const bootProbe = deferred<{ user: User }>();
    mocks.refresh
      .mockReturnValueOnce(backgroundProbe.promise)
      .mockReturnValueOnce(bootProbe.promise);

    // The background refresh starts first, init() follows and joins the queue.
    const backgroundPromise = useAuthStore.getState().refresh();
    const initPromise = useAuthStore.getState().init();
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(2));
    expect(useAuthStore.getState().isReady).toBe(false);

    bootProbe.resolve({ user: { ...baseUser, username: 'boot' } });
    await initPromise;
    // The boot probe answered, so routing may proceed, but the background
    // probe is still in flight and owns the isRefreshing transition.
    expect(useAuthStore.getState().isReady).toBe(true);
    expect(useAuthStore.getState().isRefreshing).toBe(true);

    backgroundProbe.resolve({ user: { ...baseUser, username: 'background' } });
    await backgroundPromise;

    const state = useAuthStore.getState();
    expect(state.isRefreshing).toBe(false);
    expect(state.isReady).toBe(true);
    // Last settle wins.
    expect(state.user?.username).toBe('background');
  });

  it('leaves the session and readiness to login() while a login is in flight', async () => {
    mocks.loginGuard.active = true;
    useAuthStore.setState({ user: baseUser, isAuthenticated: true });

    await useAuthStore.getState().init();

    const state = useAuthStore.getState();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(state.isReady).toBe(false);
    expect(state.isAuthenticated).toBe(true);
  });
});