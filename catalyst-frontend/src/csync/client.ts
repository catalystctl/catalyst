/**
 * Catalyst Sync — QueryClient
 *
 * Drop-in replacement for TanStack QueryClient with the subset Catalyst uses.
 * Adds first-class tag revalidation + patch helpers for SSE-driven UIs.
 */
import { reportSystemError } from '../services/api/systemErrors';
import { Scheduler } from './scheduler';
import {
  type DefaultOptions,
  type MutationOptions,
  type QueryCacheNotifyEvent,
  type QueryFilters,
  type QueryKey,
  type QueryOptions,
  type QueryState,
  hashQueryKey,
  matchQuery,
  partialMatchKey,
  Query as QueryClass,
} from './types';

export type { QueryKey, QueryFilters, QueryOptions, MutationOptions, QueryState, DefaultOptions };
export { hashQueryKey, matchQuery, partialMatchKey, QueryClass as Query };

type CacheListener = (event: QueryCacheNotifyEvent) => void;
type MutationGlobalListener = (args: {
  error: unknown;
  variables: unknown;
  context: unknown;
  mutation: { options: MutationOptions<any, any, any, any> };
}) => void;

export class QueryCache {
  private queries = new Map<string, QueryClass<unknown, unknown>>();
  private listeners = new Set<CacheListener>();
  getAll(): QueryClass<unknown, unknown>[] {
    return [...this.queries.values()];
  }

  find(filters: QueryFilters): QueryClass<unknown, unknown> | undefined {
    return this.getAll().find((q) => matchQuery(filters, q as unknown as import('./types').Query<unknown, unknown>));
  }

  findAll(filters: QueryFilters = {}): QueryClass<unknown, unknown>[] {
    return this.getAll().filter((q) => matchQuery(filters, q as unknown as import('./types').Query<unknown, unknown>));
  }

  get(queryHash: string): QueryClass<unknown, unknown> | undefined {
    return this.queries.get(queryHash);
  }

  build(_client: QueryClient, options: QueryOptions<unknown, unknown>): QueryClass<unknown, unknown> {
    const hash = hashQueryKey(options.queryKey);
    let query = this.queries.get(hash);
    if (!query) {
      query = new QueryClass(options.queryKey, options);
      this.queries.set(hash, query);
      this.notify({ type: 'added', query });
    } else {
      query.queryKey = options.queryKey;
      query.queryHash = hash;
      if (options.queryFn) {
        (query.options as { queryFn: unknown }).queryFn = options.queryFn;
        if (options.meta !== undefined) (query.options as { meta: unknown }).meta = options.meta;
      }
    }
    return query;
  }
  remove(query: QueryClass<unknown, unknown>) {
    if (this.queries.get(query.queryHash) === query) {
      this.queries.delete(query.queryHash);
      if (query.refetchTimer) {
        clearInterval(query.refetchTimer);
        query.refetchTimer = null;
      }
      if (query.gcTimer) {
        clearTimeout(query.gcTimer);
        query.gcTimer = null;
      }
      if (query.abortController) {
        try { query.abortController.abort(); } catch { /* abort is best-effort */ }
        query.abortController = null;
      }
      this.notify({ type: 'removed', query });
    }
  }

  clear() {
    for (const q of this.getAll()) this.remove(q);
  }

  subscribe(listener: CacheListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notify(event: QueryCacheNotifyEvent) {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* isolate */
      }
    }
  }
}

export class MutationCache {
  private listeners = new Set<MutationGlobalListener>();

  constructor(config?: { onError?: MutationGlobalListener }) {
    if (config?.onError) this.listeners.add(config.onError);
  }

  subscribe(listener: MutationGlobalListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notifyError(args: Parameters<MutationGlobalListener>[0]) {
    for (const l of this.listeners) {
      try {
        l(args);
      } catch {
        /* isolate */
      }
    }
  }
}

export type QueryClientConfig = {
  defaultOptions?: DefaultOptions;
  mutationCache?: MutationCache;
  queryCache?: QueryCache;
};

type Updater<T> = T | ((old: any) => any);

function resolveUpdater<T>(updater: Updater<T>, old: T | undefined): T | undefined {
  return typeof updater === 'function' ? (updater as (o: T | undefined) => T | undefined)(old) : updater;
}

export class QueryClient {
  private queryCache: QueryCache;
  private mutationCache: MutationCache;
  private defaultOptions: DefaultOptions;
  private scheduler = new Scheduler();
  private mounted = false;
  private tagIndex = new Map<string, Set<string>>();
  private removeFocus?: () => void;
  private removeOnline?: () => void;

  constructor(config: QueryClientConfig = {}) {
    this.queryCache = config.queryCache ?? new QueryCache();
    this.mutationCache =
      config.mutationCache ??
      new MutationCache({
        onError: ({ error, mutation }) => {
          const mutationKey = String(mutation.options.mutationKey ?? 'unknown');
          const message =
            error instanceof Error
              ? error.message
              : (error as any)?.message ||
                (error as any)?.response?.data?.error ||
                (error as any)?.response?.data?.message ||
                String(error);
          reportSystemError({
            level: 'error',
            component: `Mutation:${mutationKey}`,
            message,
            metadata: { mutationKey },
          });
        },
      });
    this.defaultOptions = config.defaultOptions ?? {};
  }

  getQueryCache() {
    return this.queryCache;
  }

  getMutationCache() {
    return this.mutationCache;
  }

  getDefaultOptions() {
    return this.defaultOptions;
  }

  setDefaultOptions(options: DefaultOptions) {
    this.defaultOptions = {
      queries: { ...this.defaultOptions.queries, ...options.queries },
      mutations: { ...this.defaultOptions.mutations, ...options.mutations },
    };
  }

  mount() {
    if (this.mounted || typeof window === 'undefined') return;
    this.mounted = true;
    const onFocus = () => this.refetchOnWindowFocus();
    const onOnline = () => this.refetchOnReconnect();
    window.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    this.removeFocus = () => {
      window.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
    this.removeOnline = () => window.removeEventListener('online', onOnline);
  }

  unmount() {
    this.mounted = false;
    this.removeFocus?.();
    this.removeOnline?.();
    this.removeFocus = undefined;
    this.removeOnline = undefined;
  }

  private mergeQueryOptions<TData, TError>(
    options: QueryOptions<TData, TError>,
  ): QueryOptions<TData, TError> {
    const d = this.defaultOptions.queries ?? {};
    return {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      retry: 2,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchIntervalInBackground: false,
      ...d,
      ...options,
      queryKey: options.queryKey,
    } as QueryOptions<TData, TError>;
  }

  ensureQuery<TData = unknown, TError = Error>(
    options: QueryOptions<TData, TError>,
  ): QueryClass<TData, TError> {
    const merged = this.mergeQueryOptions(options);
    return this.queryCache.build(this, merged as unknown as QueryOptions<unknown, unknown>) as unknown as QueryClass<TData, TError>;
  }

  getQueryData<TData = unknown>(queryKey: QueryKey): TData | undefined {
    const hash = hashQueryKey(queryKey);
    return this.queryCache.get(hash)?.state.data as TData | undefined;
  }

  getQueriesData<TData = unknown>(filters: QueryFilters): [QueryKey, TData | undefined][] {
    return this.queryCache
      .findAll(filters)
      .map((q) => [q.queryKey, q.state.data as TData | undefined]);
  }

  setQueryData<TData>(
    queryKey: QueryKey,
    updater: Updater<TData>,
  ): TData | undefined {
    const hash = hashQueryKey(queryKey);
    const existing = this.queryCache.get(hash) as unknown as QueryClass<TData, unknown> | undefined;
    const prev = existing?.state.data as TData | undefined;
    const data = resolveUpdater(updater, prev);
    if (typeof data === 'undefined') return prev;
    const query = this.ensureQuery<TData>({ queryKey }) as unknown as QueryClass<TData, unknown>;
    const resolved = data as TData;
    query.setState({
      data: resolved,
      status: 'success',
      error: null,
      dataUpdatedAt: Date.now(),
      fetchStatus: query.state.fetchStatus === 'fetching' ? 'fetching' : 'idle',
      isInvalidated: false,
      failureCount: 0,
      isPlaceholderData: false,
    });
    this.queryCache.notify({ type: 'updated', query: query as unknown as QueryClass<unknown, unknown> });
    this.indexTags(query as unknown as QueryClass<unknown, unknown>);
    this.scheduleGc(query as unknown as QueryClass<unknown, unknown>);
    return resolved;
  }

  setQueriesData<TData>(
    filters: QueryFilters,
    updater: Updater<TData>,
  ): [QueryKey, TData | undefined][] {
    const result: [QueryKey, TData | undefined][] = [];
    for (const query of this.queryCache.findAll(filters)) {
      const data = resolveUpdater(updater, query.state.data as TData | undefined);
      if (typeof data !== 'undefined') {
        query.setState({
          data,
          status: 'success',
          error: null,
          dataUpdatedAt: Date.now(),
          isInvalidated: false,
          failureCount: 0,
          isPlaceholderData: false,
        });
        this.queryCache.notify({ type: 'updated', query });
        this.indexTags(query);
        this.scheduleGc(query);
        result.push([query.queryKey, data]);
      } else {
        result.push([query.queryKey, query.state.data as TData | undefined]);
      }
    }
    return result;
  }

  /** SSE-friendly alias */
  patchQueriesData<TData>(filters: QueryFilters, patcher: (data: TData) => TData): void {
    this.setQueriesData<TData>(filters, (old) => {
      if (old === undefined || old === null) return old;
      return patcher(old as TData);
    });
  }

  removeQueries(filters: QueryFilters = {}) {
    for (const query of this.queryCache.findAll(filters)) {
      this.queryCache.remove(query);
      this.dropTags(query);
    }
  }

  async cancelQueries(filters: QueryFilters = {}): Promise<void> {
    for (const query of this.queryCache.findAll(filters)) {
      query.fetchId++;
      query.promise = null;
      if (query.abortController) {
        try {
          query.abortController.abort();
        } catch {
          // ignore abort errors
        }
        query.abortController = null;
      }
      if (query.state.fetchStatus === 'fetching') {
        query.setState({ fetchStatus: 'idle' });
        this.queryCache.notify({ type: 'updated', query });
      }
    }
  }

  async invalidateQueries(
    filters: QueryFilters = {},
    opts?: { refetchType?: 'active' | 'none' | 'all' },
  ): Promise<void> {
    const refetchType = opts?.refetchType ?? 'active';
    const matched = this.queryCache.findAll(filters);
    const fetches: Promise<unknown>[] = [];
    for (const query of matched) {
      query.setState({ isInvalidated: true });
      this.queryCache.notify({ type: 'updated', query });
      const shouldRefetch =
        refetchType === 'all' || (refetchType === 'active' && query.hasEnabledObserver());
      if (shouldRefetch && query.options.queryFn) {
        if (query.state.fetchStatus === 'fetching') {
          query.fetchId++;
          if (query.abortController) {
            try { query.abortController.abort(); } catch { /* abort is best-effort */ }
            query.abortController = null;
          }
          query.promise = null;
          query.setState({ fetchStatus: 'idle' });
          this.queryCache.notify({ type: 'updated', query });
        }
        const p = this.fetchQuery({ ...query.options, queryKey: query.queryKey, enabled: true } as unknown as QueryOptions<unknown, unknown>);
        fetches.push(p);
      }
    }
    await Promise.allSettled(fetches);
  }

  async revalidateTags(
    tags: string[],
    opts?: { refetchType?: 'active' | 'none' | 'all' },
  ): Promise<void> {
    const hashes = new Set<string>();
    for (const tag of tags) {
      const set = this.tagIndex.get(tag);
      if (set) for (const h of set) hashes.add(h);
    }
    for (const query of this.queryCache.getAll()) {
      if (typeof query.queryKey[0] === 'string' && tags.includes(query.queryKey[0] as string)) {
        hashes.add(query.queryHash);
      }
      const metaTags = (query.options.meta?.tags as string[] | undefined) ?? [];
      if (metaTags.some((t) => tags.includes(t))) hashes.add(query.queryHash);
    }
    await this.invalidateQueries({ predicate: (q) => hashes.has(q.queryHash) }, opts);
  }

  async fetchQuery<TData = unknown, TError = Error>(
    options: QueryOptions<TData, TError>,
  ): Promise<TData> {
    const query = this.ensureQuery(options);
    if ((options.enabled ?? true) === false) {
      if (query.state.data !== undefined) return query.state.data as TData;
      return Promise.reject(new Error(`Query disabled for ${query.queryHash}`));
    }
    const staleTime = query.options.staleTime ?? 60_000;
    const isStale =
      query.state.isInvalidated ||
      query.state.data === undefined ||
      query.state.dataUpdatedAt === 0 ||
      Date.now() - query.state.dataUpdatedAt >= (typeof staleTime === 'number' ? staleTime : 0);
    if (!isStale && query.state.data !== undefined) return query.state.data as TData;
    return this.executeFetch(query);
  }
  async prefetchQuery<TData = unknown, TError = Error>(
    options: QueryOptions<TData, TError>,
  ): Promise<void> {
    try {
      await this.fetchQuery(options);
    } catch {
      const q = this.queryCache.get(hashQueryKey(options.queryKey));
      if (q) this.scheduleGc(q);
    }
  }

  async ensureQueryData<TData = unknown, TError = Error>(
    options: QueryOptions<TData, TError>,
  ): Promise<TData> {
    const query = this.ensureQuery(options);
    const staleTime = options.staleTime ?? this.defaultOptions.queries?.staleTime ?? 60_000;
    if (query.state.data !== undefined) {
      const isStale =
        query.state.isInvalidated ||
        query.state.dataUpdatedAt === 0 ||
        Date.now() - query.state.dataUpdatedAt > (typeof staleTime === 'number' ? staleTime : 0);
      if (!isStale) return query.state.data as TData;
      if (query.options.queryFn) void this.executeFetch(query).catch(() => {});
      return query.state.data as TData;
    }
    return this.executeFetch(query);
  }

  private async executeFetch<TData, TError>(query: QueryClass<TData, TError>): Promise<TData> {
    if (query.promise && query.state.fetchStatus === 'fetching') return query.promise;
    const rawFn = query.options.queryFn;
    if (!rawFn) {
      return Promise.reject(new Error(`Missing queryFn for ${query.queryHash}`));
    }

    const fetchId = ++query.fetchId;
    const abortController = new AbortController();
    query.abortController = abortController;
    const hasData = query.state.data !== undefined;
    query.setState({
      fetchStatus: 'fetching',
      error: null,
      failureCount: 0,
      status: hasData ? query.state.status : 'pending',
      isPlaceholderData: false,
    });
    this.queryCache.notify({ type: 'updated', query: query as unknown as QueryClass<unknown, unknown> });

    const callQueryFn = (): Promise<TData> => {
      const fnWithSignal = rawFn as unknown as (ctx: { signal: AbortSignal; queryKey: QueryKey; meta?: Record<string, unknown> }) => Promise<TData>;
      // Support both legacy () => Promise and ({signal, queryKey}) signatures
      if (fnWithSignal.length === 0) {
        return (rawFn as unknown as () => Promise<TData>)();
      }
      return fnWithSignal({ signal: abortController.signal, queryKey: query.queryKey, meta: query.options.meta });
    };

    const run = async (): Promise<TData> => {
      const maxRetries = resolveRetry(
        query.options.retry ?? this.defaultOptions.queries?.retry ?? 2,
      );
      let failureCount = 0;
      for (;;) {
        if (abortController.signal.aborted || query.fetchId !== fetchId) {
          throw new DOMException('Query cancelled', 'AbortError');
        }
        try {
          const data = await callQueryFn();
          if (query.fetchId !== fetchId || abortController.signal.aborted) {
            throw new DOMException('Query cancelled', 'AbortError');
          }
          if (typeof data === 'undefined') {
            throw new Error('Query data cannot be undefined');
          }
          if (query.fetchId !== fetchId) throw new DOMException('Query cancelled', 'AbortError');
          query.setState({
            data,
            error: null,
            status: 'success',
            fetchStatus: 'idle',
            dataUpdatedAt: Date.now(),
            isInvalidated: false,
            failureCount: 0,
            isPlaceholderData: false,
          });
          this.queryCache.notify({ type: 'updated', query: query as unknown as QueryClass<unknown, unknown> });
          this.indexTags(query as unknown as QueryClass<unknown, unknown>);
          this.scheduleGc(query as unknown as QueryClass<unknown, unknown>);
          return data;
        } catch (err) {
          if (query.fetchId !== fetchId || abortController.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
            if (query.fetchId === fetchId) {
              query.setState({ fetchStatus: 'idle' });
              this.queryCache.notify({ type: 'updated', query: query as unknown as QueryClass<unknown, unknown> });
            }
            throw err;
          }
          const canRetry =
            typeof maxRetries === 'function'
              ? maxRetries(failureCount, err as TError)
              : (maxRetries as number) === Infinity
                ? true
                : failureCount < (maxRetries as number);
          if (!canRetry) {
            if (query.fetchId === fetchId) {
              query.setState({
                error: err as TError,
                status: hasData ? query.state.status : 'error',
                fetchStatus: 'idle',
                errorUpdatedAt: Date.now(),
                failureCount,
                isPlaceholderData: false,
              });
              this.queryCache.notify({ type: 'updated', query: query as unknown as QueryClass<unknown, unknown> });
              this.scheduleGc(query as unknown as QueryClass<unknown, unknown>);
            }
            throw err;
          }
          const delay = Math.min(1000 * 2 ** failureCount, 8000);
          failureCount++;
          if (query.fetchId === fetchId) {
            query.setState({ failureCount });
            this.queryCache.notify({ type: 'updated', query: query as unknown as QueryClass<unknown, unknown> });
          }
          await sleepWithSignal(delay, abortController.signal);
        }
      }
    };
    const p = run();
    // Attach catch immediately to prevent unhandledrejection if caller doesn't await
    p.catch(() => {});
    query.promise = p as Promise<TData>;
    const clearIfCurrent = (): void => {
      if (query.fetchId === fetchId) {
        query.promise = null;
        query.abortController = null;
      }
    };
    p.then(clearIfCurrent, clearIfCurrent);
    return query.promise;
  }

  isFetching(filters?: QueryFilters): number {
    return this.queryCache
      .findAll(filters ?? {})
      .filter((q) => q.state.fetchStatus === 'fetching').length;
  }

  clear() {
    this.queryCache.clear();
    this.tagIndex.clear();
  }

  private observerSeq = 0;

  subscribeQuery(query: QueryClass<unknown, unknown>, onStoreChange: () => void, observerOptions?: Record<string, unknown>): () => void {
    const obsId = ++this.observerSeq;
    if (observerOptions) {
      query.observerEntries.set(obsId, { id: obsId, options: observerOptions as unknown as QueryOptions<unknown, unknown> });
    }
    query.observers++;
    if (query.gcTimer) {
      clearTimeout(query.gcTimer);
      query.gcTimer = null;
    }
    this.queryCache.notify({ type: 'observerAdded', query: query as unknown as QueryClass<unknown, unknown> });
    // Only poll if any observer is enabled
    if (query.hasEnabledObserver()) {
      this.setupRefetchInterval(query as unknown as QueryClass<unknown, unknown>);
    }


    const hash = query.queryHash;
    const unsubCache = this.queryCache.subscribe((event) => {
      const relevant = event.query === query || event.query.queryHash === hash;
      if (relevant && (event.type === 'updated' || event.type === 'removed' || event.type === 'added')) {
        this.scheduler.schedule(onStoreChange);
      }
    });

    return () => {
      unsubCache();
      query.observerEntries.delete(obsId);
      query.observers = Math.max(0, query.observers - 1);
      this.queryCache.notify({ type: 'observerRemoved', query: query as unknown as QueryClass<unknown, unknown> });
      if (query.observers === 0) {
        if (query.refetchTimer) {
          clearInterval(query.refetchTimer);
          query.refetchTimer = null;
        }
        this.scheduleGc(query as unknown as QueryClass<unknown, unknown>);
      } else {
        const stillActive = query.hasEnabledObserver();
        if (!stillActive && query.refetchTimer) {
          clearInterval(query.refetchTimer);
          query.refetchTimer = null;
        } else if (stillActive) {
          this.setupRefetchInterval(query as unknown as QueryClass<unknown, unknown>);
        }
      }
    };
  }

  setupRefetchInterval(query: QueryClass<unknown, unknown>): void {
    if (query.refetchTimer) {
      clearInterval(query.refetchTimer);
      query.refetchTimer = null;
    }
    if (!query.hasEnabledObserver() && (query.options.enabled ?? true) === false) return;
    // Use per-observer effective interval
    const effective = query.effectiveRefetchInterval();
    if (effective === undefined || effective === false) {
      // Fallback to single-observer path if no per-observer interval
      if (query.observerEntries.size === 0) return;
      return;
    }
    // If we have an effective interval, handle it below; otherwise fall through to raw handling
    if (query.observerEntries.size > 0 && typeof effective === 'number') {
      const ms = effective;
      query.refetchTimer = setInterval(() => {
        if (query.observers <= 0) return;
        const inBg = (() => {
          for (const e of query.observerEntries.values()) {
            if ((e.options.enabled ?? true) !== false && (e.options as unknown as Record<string, unknown>).refetchIntervalInBackground) return false;
          }
          return typeof document !== 'undefined' && document.visibilityState === 'hidden';
        })();
        if (inBg) return;
        if (query.options.queryFn) {
          void this.fetchQuery({ ...query.options, queryKey: query.queryKey, enabled: true } as unknown as QueryOptions<unknown, unknown>).catch(() => {});
        }
      }, ms);
      return;
    }
    const raw = query.options.refetchInterval;
    if (raw === undefined || raw === false) return;

    const resolveMs = (): number | false | undefined => {
      if (typeof raw === 'function') return raw(query);
      return raw;
    };

    const shouldSkipBackground = () => {
      const inBg = query.options.refetchIntervalInBackground ?? false;
      return !inBg && typeof document !== 'undefined' && document.visibilityState === 'hidden';
    };

    if (typeof raw === 'number' && raw > 0) {
      query.refetchTimer = setInterval(() => {
        if (query.observers <= 0) return;
        if (!query.hasEnabledObserver()) return;
        if (shouldSkipBackground()) return;
        if (query.options.queryFn) {
          void this.fetchQuery({ ...query.options, queryKey: query.queryKey, enabled: true } as unknown as QueryOptions<unknown, unknown>).catch(() => {});
        }
      }, raw);
      return;
    }

    if (typeof raw === 'function') {
      let last = Date.now();
      query.refetchTimer = setInterval(() => {
        if (query.observers <= 0) return;
        if (!query.hasEnabledObserver()) return;
        if (shouldSkipBackground()) return;
        const ms = resolveMs();
        if (ms === false || ms === undefined || ms <= 0) return;
        const now = Date.now();
        if (now - last >= ms) {
          last = now;
          if (query.options.queryFn) {
            void this.fetchQuery({ ...query.options, queryKey: query.queryKey, enabled: true } as unknown as QueryOptions<unknown, unknown>).catch(() => {});
          }
        }
      }, 500);
    }
  }

  updateRefetchInterval(query: QueryClass<unknown, unknown>): void {
    if (!query.hasEnabledObserver() && query.observers > 0) {
      if (query.refetchTimer) {
        clearInterval(query.refetchTimer);
        query.refetchTimer = null;
      }
      return;
    }
    if (query.observers <= 0) {
      if (query.refetchTimer) {
        clearInterval(query.refetchTimer);
        query.refetchTimer = null;
      }
      return;
    }
    this.setupRefetchInterval(query);
  }

  private scheduleGc(query: QueryClass<unknown, unknown>): void {
    if (query.observers > 0) return;
    if (query.state.fetchStatus === 'fetching') return;
    if (query.gcTimer) clearTimeout(query.gcTimer);
    const gcTime = query.options.gcTime ?? this.defaultOptions.queries?.gcTime ?? 10 * 60_000;
    if (gcTime === Infinity) return;
    query.gcTimer = setTimeout(
      () => {
        if (query.observers === 0 && query.state.fetchStatus !== 'fetching') {
          this.queryCache.remove(query);
          this.dropTags(query);
        }
      },
      typeof gcTime === 'number' ? gcTime : 10 * 60_000,
    );
  }

  private refetchOnWindowFocus(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    for (const query of this.queryCache.getAll()) {
      if (query.observers <= 0) continue;
      if (!query.hasEnabledObserver()) continue;
      const flag = query.options.refetchOnWindowFocus ?? false;
      if (!flag) continue;
      const staleTime = query.options.staleTime ?? 60_000;
      const stale =
        flag === 'always' ||
        query.state.isInvalidated ||
        Date.now() - query.state.dataUpdatedAt >= (typeof staleTime === 'number' ? staleTime : 0);
      if (stale && query.options.queryFn) {
        void this.fetchQuery({ ...query.options, queryKey: query.queryKey, enabled: true } as unknown as QueryOptions<unknown, unknown>).catch(() => {});
      }
    }
  }

  private refetchOnReconnect(): void {
    for (const query of this.queryCache.getAll()) {
      if (query.observers <= 0) continue;
      if (!query.hasEnabledObserver()) continue;
      const flag = query.options.refetchOnReconnect ?? true;
      if (!flag) continue;
      const staleTime = query.options.staleTime ?? 60_000;
      const stale =
        flag === 'always' ||
        query.state.isInvalidated ||
        Date.now() - query.state.dataUpdatedAt >= (typeof staleTime === 'number' ? staleTime : 0);
      if (stale && query.options.queryFn) {
        void this.fetchQuery({ ...query.options, queryKey: query.queryKey, enabled: true } as unknown as QueryOptions<unknown, unknown>).catch(() => {});
      }
    }
  }

  private indexTags(query: QueryClass<any, any>) {
    this.dropTags(query);
    const tags = new Set<string>();
    if (typeof query.queryKey[0] === 'string') tags.add(query.queryKey[0]);
    const metaTags = (query.options.meta?.tags as string[] | undefined) ?? [];
    for (const t of metaTags) tags.add(t);
    for (const t of tags) {
      let set = this.tagIndex.get(t);
      if (!set) {
        set = new Set();
        this.tagIndex.set(t, set);
      }
      set.add(query.queryHash);
    }
    (query as any).__tags = tags;
  }

  private dropTags(query: QueryClass<any, any>) {
    const tags: Set<string> | undefined = (query as any).__tags;
    if (!tags) return;
    for (const t of tags) {
      const set = this.tagIndex.get(t);
      if (set) {
        set.delete(query.queryHash);
        if (set.size === 0) this.tagIndex.delete(t);
      }
    }
    (query as any).__tags = undefined;
  }

  /** Test helper — flush coalesced subscriber notifications */
  flush() {
    this.scheduler.flush();
  }
}

function resolveRetry(
  retry: number | boolean | ((failureCount: number, error: any) => boolean) | undefined,
): number | ((failureCount: number, error: any) => boolean) {
  if (retry === false) return 0;
  if (retry === true) return Infinity;
  if (typeof retry === 'number' || typeof retry === 'function') return retry;
  return 2;
}

function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  const timer = setTimeout(resolve, ms);
  const onAbort = (): void => {
    clearTimeout(timer);
    resolve();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  void promise.finally(() => signal.removeEventListener('abort', onAbort));
  return promise;
}
