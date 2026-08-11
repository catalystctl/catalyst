/** Catalyst Sync — shared types (RQ-compatible surface for migration). */

export type QueryKey = readonly unknown[];

export type QueryStatus = 'pending' | 'error' | 'success';
export type FetchStatus = 'fetching' | 'paused' | 'idle';

export type QueryFilters = {
  queryKey?: QueryKey;
  predicate?: (query: Query) => boolean;
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
};

export type QueryOptions<TData = unknown, TError = Error> = {
  queryKey: QueryKey;
  queryFn?: () => Promise<TData>;
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
  /**
   * Transform cached data on every read (RQ-compatible).
   * Use this when cache writers (SSE/setQueryData) may store a different shape
   * than consumers expect — e.g. normalize `{ tasks: [] }` → `Task[]`.
   */
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
  retry?: number | boolean;
  meta?: Record<string, unknown>;
};

export type DefaultOptions = {
  queries?: Partial<Omit<QueryOptions, 'queryKey' | 'queryFn'>>;
  mutations?: Partial<MutationOptions>;
};

/** Lightweight query handle used by predicates and cache subscribers. */
export class Query<TData = unknown, TError = Error> {
  queryKey: QueryKey;
  queryHash: string;
  state: QueryState<TData, TError>;
  options: QueryOptions<TData, TError>;
  /** Active observer count */
  observers = 0;
  /** In-flight promise (dedupe) */
  promise: Promise<TData> | null = null;
  /** Cancel flag for in-flight fetch */
  cancelled = false;
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
    };
  }

  setState( partial: Partial<QueryState<TData, TError>>) {
    this.state = { ...this.state, ...partial };
  }
}

export type QueryCacheNotifyEvent =
  | { type: 'added'; query: Query }
  | { type: 'removed'; query: Query }
  | { type: 'updated'; query: Query }
  | { type: 'observerAdded'; query: Query }
  | { type: 'observerRemoved'; query: Query };

export function hashQueryKey(queryKey: QueryKey): string {
  return JSON.stringify(queryKey, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      // stable object key order
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

/** v5-style partial key match: filter key is a prefix of query key (deep equal per segment). */
export function partialMatchKey(queryKey: QueryKey, filterKey: QueryKey): boolean {
  if (filterKey.length > queryKey.length) return false;
  for (let i = 0; i < filterKey.length; i++) {
    if (!deepEqual(queryKey[i], filterKey[i])) return false;
  }
  return true;
}

export function matchQuery(filters: QueryFilters, query: Query): boolean {
  const { queryKey, exact, predicate } = filters;
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

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => deepEqual(v, b[i]));
    }
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual((a as any)[k], (b as any)[k]));
  }
  return false;
}
