/** Catalyst Sync — shared types (RQ-compatible surface for migration). */

export type QueryKey = readonly unknown[];

export type QueryStatus = 'pending' | 'error' | 'success';
export type FetchStatus = 'fetching' | 'paused' | 'idle';

export type QueryFilters = {
  queryKey?: QueryKey;
  predicate?: (query: Query<unknown, unknown>) => boolean;
  exact?: boolean;
  type?: 'active' | 'inactive' | 'all';
};

export type QueryState<TData = unknown, TError = Error> = {
  data: TData | undefined;
  error: TError | null;
  status: QueryStatus;
  fetchStatus: FetchStatus;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
  isInvalidated: boolean;
  failureCount: number;
  isPlaceholderData: boolean;
};

export type QueryOptions<TData = unknown, TError = Error> = {
  queryKey: QueryKey;
  queryFn?: (context: { signal: AbortSignal; queryKey: QueryKey; meta?: Record<string, unknown> }) => Promise<TData>;
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
  retry?: number | boolean | ((failureCount: number, error: TError) => boolean);
  refetchInterval?:
    | number
    | false
    | ((query: Query<TData, TError>) => number | false | undefined);
  refetchIntervalInBackground?: boolean;
  refetchOnWindowFocus?: boolean | 'always';
  refetchOnReconnect?: boolean | 'always';
  placeholderData?: TData | ((previousData: TData | undefined) => TData | undefined);
  select?: (data: TData) => TData;
  meta?: Record<string, unknown>;
};

export type MutationOptions<TData = unknown, TError = Error, TVariables = void, TContext = unknown> = {
  mutationFn?: (variables: TVariables) => Promise<TData>;
  mutationKey?: QueryKey;
  onMutate?: (variables: TVariables) => Promise<TContext> | TContext;
  onSuccess?: (data: TData, variables: TVariables, context: TContext | undefined) => unknown;
  onError?: (error: TError, variables: TVariables, context: TContext | undefined) => unknown;
  onSettled?: (
    data: TData | undefined,
    error: TError | null,
    variables: TVariables,
    context: TContext | undefined,
  ) => unknown;
  retry?: number | boolean | ((failureCount: number, error: TError) => boolean);
  meta?: Record<string, unknown>;
};

export type DefaultOptions = {
  queries?: Partial<Omit<QueryOptions, 'queryKey' | 'queryFn'>>;
  mutations?: Partial<MutationOptions>;
};

/** Per-observer configuration. Query owns shared cache/fetch state; Observer owns enabled/select/placeholder/stale/interval. */
export type ObserverOptions<TData = unknown, TError = Error> = QueryOptions<TData, TError>;

/** Minimal observer handle for polling/enabled ownership */
export type QueryObserverEntry = {
  id: number;
  options: ObserverOptions<unknown, unknown>;
};

export class Query<TData = unknown, TError = Error> {
  queryKey: QueryKey;
  queryHash: string;
  state: QueryState<TData, TError>;
  options: QueryOptions<TData, TError>;
  observers = 0;
  /** Per-observer entries for interval/enabled ownership */
  observerEntries: Map<number, QueryObserverEntry> = new Map();
  promise: Promise<TData> | null = null;
  abortController: AbortController | null = null;
  fetchId = 0;
  gcTimer: ReturnType<typeof setTimeout> | null = null;
  refetchTimer: ReturnType<typeof setInterval> | null = null;

  constructor(queryKey: QueryKey, options: QueryOptions<TData, TError> = { queryKey }) {
    this.queryKey = queryKey;
    this.queryHash = hashQueryKey(queryKey);
    this.options = options;
    this.state = {
      data: undefined,
      error: null,
      status: 'pending',
      fetchStatus: 'idle',
      dataUpdatedAt: 0,
      errorUpdatedAt: 0,
      isInvalidated: false,
      failureCount: 0,
      isPlaceholderData: false,
    };
  }

  setState(partial: Partial<QueryState<TData, TError>>): void {
    this.state = { ...this.state, ...partial };
  }

  /** True if any observer is enabled */
  hasEnabledObserver(): boolean {
    if (this.observers === 0) return false;
    if (this.observerEntries.size === 0) return (this.options.enabled ?? true) !== false;
    for (const e of this.observerEntries.values()) {
      if ((e.options.enabled ?? true) !== false) return true;
    }
    return false;
  }

  /** Resolve effective refetchInterval from enabled observers */
  effectiveRefetchInterval(): number | false | undefined {
    if (this.observerEntries.size === 0) {
      const raw = this.options.refetchInterval;
      if (raw === undefined || raw === false) return raw as false | undefined;
      if (typeof raw === 'function') return (raw as (q: Query<unknown, unknown>) => number | false | undefined)(this as unknown as Query<unknown, unknown>);
      return raw as number | false | undefined;
    }
    let best: number | false | undefined = undefined;
    for (const e of this.observerEntries.values()) {
      if ((e.options.enabled ?? true) === false) continue;
      const raw = (e.options as unknown as QueryOptions<unknown, unknown>).refetchInterval;
      if (raw === undefined || raw === false) continue;
      const ms = typeof raw === 'function' ? (raw as (q: Query<unknown, unknown>) => number | false | undefined)(this as unknown as Query<unknown, unknown>) : (raw as number);
      if (ms === false || ms === undefined || ms <= 0) continue;
      if (best === undefined || (typeof ms === 'number' && typeof best === 'number' && ms < best)) {
        best = ms;
      }
    }
    return best;
  }
}

export type QueryCacheNotifyEvent =
  | { type: 'added'; query: Query<unknown, unknown> }
  | { type: 'removed'; query: Query<unknown, unknown> }
  | { type: 'updated'; query: Query<unknown, unknown> }
  | { type: 'observerAdded'; query: Query<unknown, unknown> }
  | { type: 'observerRemoved'; query: Query<unknown, unknown> };

export function hashQueryKey(queryKey: QueryKey): string {
  return JSON.stringify(queryKey, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as object)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (v as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return v;
  });
}

/** v5-style partial key match: filter key is a prefix of query key. Object segments use subset semantics. */
export function partialMatchKey(queryKey: QueryKey, filterKey: QueryKey): boolean {
  if (filterKey.length > queryKey.length) return false;
  for (let i = 0; i < filterKey.length; i++) {
    if (!isSubsetEqual(queryKey[i], filterKey[i])) return false;
  }
  return true;
}

function isSubsetEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => isSubsetEqual(v, (b as unknown[])[i]));
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    for (const k of Object.keys(bObj)) {
      if (!(k in aObj)) return false;
      if (!isSubsetEqual(aObj[k], bObj[k])) return false;
    }
    return true;
  }
  return false;
}

export function matchQuery(filters: QueryFilters, query: Query<unknown, unknown>): boolean {
  const { queryKey, exact, predicate, type } = filters;
  if (type && type !== 'all') {
    const isActive = query.observers > 0;
    if (type === 'active' && !isActive) return false;
    if (type === 'inactive' && isActive) return false;
  }
  if (queryKey !== undefined) {
    if (exact) {
      if (hashQueryKey(query.queryKey) !== hashQueryKey(queryKey)) return false;
    } else if (!partialMatchKey(query.queryKey, queryKey)) {
      return false;
    }
  }
  if (predicate && !predicate(query)) return false;
  return true;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => deepEqual(v, (b as unknown[])[i]));
    }
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}
