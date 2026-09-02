/**
 * Catalyst Sync — React bindings (useSyncExternalStore).
 * API mirrors the former TanStack Query hooks Catalyst actually uses.
 */
import {
  useCallback,
  useDebugValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import {
  QueryClient,
  type MutationOptions,
  type QueryOptions,
} from './client';
import type { Query } from './types';

const SyncClientContext = createContext<QueryClient | null>(null);

/** Optional fallback when hooks run outside provider (tests / rare bootstrap). */
let fallbackClient: QueryClient | null = null;

/** Sequence for auto-generated mutation labels when no owner name is derivable. */
let autoMutationSeq = 0;

export function setFallbackQueryClient(client: QueryClient | null) {
  fallbackClient = client;
}

export function SyncProvider({
  client,
  children,
}: {
  client: QueryClient;
  children: ReactNode;
}) {
  useEffect(() => {
    client.mount();
    return () => client.unmount();
  }, [client]);

  return <SyncClientContext.Provider value={client}>{children}</SyncClientContext.Provider>;
}

/** RQ-compatible alias */
export function QueryClientProvider({
  client,
  children,
}: {
  client: QueryClient;
  children: ReactNode;
}) {
  return <SyncProvider client={client}>{children}</SyncProvider>;
}

export function useQueryClient(): QueryClient {
  const ctx = useContext(SyncClientContext);
  if (ctx) return ctx;
  if (fallbackClient) return fallbackClient;
  throw new Error('useQueryClient must be used within SyncProvider / QueryClientProvider');
}

export type UseQueryResult<TData = unknown, TError = Error> = {
  data: TData | undefined;
  error: TError | null;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  isFetched: boolean;
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
  refetch: () => Promise<TData>;
  failureCount: number;
};

export function useQuery<TData = unknown, TError = Error>(
  options: QueryOptions<TData, TError>,
): UseQueryResult<TData, TError> {
  const client = useQueryClient();
  const enabled = options.enabled ?? true;
  const queryKey = options.queryKey;
  const queryKeyHash = stableHash(queryKey);
  const refetchInterval = options.refetchInterval;

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const query = useMemo(() => {
    return client.ensureQuery({
      ...optionsRef.current,
      queryKey: optionsRef.current.queryKey,
    });
    // queryKeyHash is the stable identity of queryKey (inline arrays change every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hashed key, not array identity
  }, [client, queryKeyHash]);

  // Per-observer ownership: share queryFn/meta via query.options, keep enabled/interval/select/placeholder
  // on the observer entry so two hooks on same key don't clobber. Never write enabled/interval to shared query.
  (query.options as { queryFn: unknown }).queryFn = options.queryFn;
  (query.options as { meta: unknown }).meta = options.meta;

  const observerOptionsRef = useRef<QueryOptions<TData, TError>>(options as QueryOptions<TData, TError>);
  observerOptionsRef.current = {
    ...client.getDefaultOptions().queries,
    ...options,
    queryKey,
  } as QueryOptions<TData, TError>;

  // Keep observer entry in sync when enabled/interval changes
  const observerIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (observerIdRef.current != null) {
      const live = (client.getQueryCache().get(query.queryHash) as unknown as Query | undefined) ?? query;
      const entry = (live as unknown as { observerEntries: Map<number, { options: unknown }> }).observerEntries.get(observerIdRef.current);
      if (entry) {
        entry.options = observerOptionsRef.current as unknown as Record<string, unknown>;
        (client as unknown as { updateRefetchInterval: (q: unknown) => void }).updateRefetchInterval(live as unknown as Query);
      }
    }
  }, [client, query, enabled, refetchInterval]);
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const current = (client.getQueryCache().get(query.queryHash) as unknown as Query | undefined) ?? query;
      const unsub = (client as unknown as { subscribeQuery: (q: unknown, cb: () => void, opts?: unknown) => () => void }).subscribeQuery(
        current as unknown as Query,
        onStoreChange,
        observerOptionsRef.current as unknown as Record<string, unknown>,
      );
      const qAny = current as unknown as { observerEntries: Map<number, unknown> };
      let maxId = 0;
      for (const k of qAny.observerEntries.keys()) if (k > maxId) maxId = k;
      observerIdRef.current = maxId;
      let resubscribed = false;
      const maybeResubscribe = (event: { type: string; query: { queryHash: string } }): void => {
        if (resubscribed) return;
        if (event.type !== 'added' && event.type !== 'removed') return;
        if (event.query.queryHash !== query.queryHash) return;
        const fresh = client.getQueryCache().get(query.queryHash) as unknown as Query | undefined;
        if (!fresh || fresh === current) return;
        resubscribed = true;
        // Migrate observer to fresh instance and re-notify
        const oldEntry = (current as unknown as { observerEntries: Map<number, { options: unknown }> }).observerEntries.get(maxId);
        if (oldEntry) {
          (fresh as unknown as { observerEntries: Map<number, { options: unknown }> }).observerEntries.set(maxId, oldEntry);
          (current as unknown as { observerEntries: Map<number, unknown> }).observerEntries.delete(maxId);
        }
        fresh.observers = Math.max(fresh.observers, 1);
        (current as unknown as { observers: number }).observers = Math.max(0, current.observers - 1);
        (client as unknown as { setupRefetchInterval: (q: unknown) => void }).setupRefetchInterval(fresh as unknown as Query);
        onStoreChange();
      };
      const cacheUnsub = client.getQueryCache().subscribe(maybeResubscribe as unknown as (e: import('./types').QueryCacheNotifyEvent) => void);
      return () => {
        observerIdRef.current = null;
        cacheUnsub();
        unsub();
      };
    },
    [client, query],
  );

  const getSnapshot = useCallback(() => {
    const current = client.getQueryCache().get(query.queryHash) as unknown as Query | undefined;
    return (current ?? query).state;
  }, [client, query]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    if (!optionsRef.current.queryFn) return;

    const current = (client.getQueryCache().get(query.queryHash) as unknown as Query | undefined) ?? query;
    if (current.state.fetchStatus === 'fetching') return;

    const staleTime =
      optionsRef.current.staleTime ?? client.getDefaultOptions().queries?.staleTime ?? 60_000;
    const hasData = current.state.data !== undefined;
    const isStale =
      current.state.isInvalidated ||
      !hasData ||
      Date.now() - current.state.dataUpdatedAt >= (typeof staleTime === 'number' ? staleTime : 0);

    if (isStale) {
      void client.fetchQuery({ ...optionsRef.current, queryKey: optionsRef.current.queryKey }).catch(() => {});
    }
  }, [client, query, enabled, queryKeyHash, state.isInvalidated]);

  const placeholder = options.placeholderData;
  const select = options.select;
  let data = state.data as TData | undefined;
  let isPlaceholderData = false;
  const prevDataRef = useRef<TData | undefined>(undefined);
  if (state.data !== undefined) {
    prevDataRef.current = state.data as TData;
  }
  if (data === undefined && placeholder !== undefined) {
    data =
      typeof placeholder === 'function'
        ? (placeholder as (p: TData | undefined) => TData | undefined)(prevDataRef.current)
        : (placeholder as TData);
    if (data !== undefined) isPlaceholderData = true;
  }
  const selectInputRef = useRef<TData | undefined>(undefined);
  const selectOutputRef = useRef<TData | undefined>(undefined);
  const selectFnRef = useRef<typeof select>(undefined);
  if (data !== undefined && typeof select === 'function') {
    if (selectInputRef.current !== data || selectFnRef.current !== select) {
      selectInputRef.current = data;
      selectFnRef.current = select;
      selectOutputRef.current = select(data);
    }
    data = selectOutputRef.current;
  } else {
    selectInputRef.current = undefined;
    selectOutputRef.current = undefined;
    selectFnRef.current = undefined;
  }

  // isLoading: pending with no data, irrespective of isPlaceholderData
  const isPending = enabled && state.data === undefined && !isPlaceholderData && state.status === 'pending';
  const isFetching = state.fetchStatus === 'fetching';
  // Initial isLoading should be true for empty enabled query before fetch starts (fix first-render false)
  const isLoading = Boolean(isPending && (isFetching || state.data === undefined));
  // If placeholder data is present, treat as success for derived flags (TanStack placeholder semantics)
  const effectiveStatus = isPlaceholderData ? 'success' as const : state.status;
  const isError = !isPlaceholderData && state.status === 'error' && state.error !== null;
  const isSuccess = isPlaceholderData || (state.data !== undefined && state.error === null && effectiveStatus === 'success');

  const refetch = useCallback(() => {
    return client.fetchQuery({ ...optionsRef.current, queryKey: optionsRef.current.queryKey });
  }, [client]);

  const resultRef = useRef<UseQueryResult<TData, TError> | null>(null);
  const next: UseQueryResult<TData, TError> = {
    data,
    error: state.error as TError | null,
    isLoading,
    isPending: Boolean(isPending),
    isFetching,
    isError,
    isSuccess,
    isFetched: state.dataUpdatedAt > 0 || state.errorUpdatedAt > 0,
    status: isPlaceholderData ? 'success' : state.status,
    fetchStatus: state.fetchStatus,
    refetch,
    failureCount: state.failureCount,
  };
  const prev = resultRef.current;
  const result =
    prev &&
    prev.data === next.data &&
    prev.error === next.error &&
    prev.isLoading === next.isLoading &&
    prev.isPending === next.isPending &&
    prev.isFetching === next.isFetching &&
    prev.isError === next.isError &&
    prev.isSuccess === next.isSuccess &&
    prev.isFetched === next.isFetched &&
    prev.status === next.status &&
    prev.fetchStatus === next.fetchStatus &&
    prev.failureCount === next.failureCount &&
    prev.refetch === next.refetch
      ? prev
      : next;
  resultRef.current = result;

  useDebugValue(result);
  return result;
}

export type UseMutationResult<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
> = {
  data: TData | undefined;
  error: TError | null;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  isIdle: boolean;
  status: 'idle' | 'pending' | 'error' | 'success';
  variables: TVariables | undefined;
  mutate: (
    variables?: TVariables,
    opts?: MutateOpts<TData, TError, TVariables, TContext>,
  ) => void;
  mutateAsync: (
    variables?: TVariables,
    opts?: MutateOpts<TData, TError, TVariables, TContext>,
  ) => Promise<TData>;
  reset: () => void;
  failureCount: number;
  context: TContext | undefined;
};

type MutateOpts<TData, TError, TVariables, TContext> = {
  onSuccess?: (data: TData, variables: TVariables, context: TContext | undefined) => unknown;
  onError?: (error: TError, variables: TVariables, context: TContext | undefined) => unknown;
  onSettled?: (
    data: TData | undefined,
    error: TError | null,
    variables: TVariables,
    context: TContext | undefined,
  ) => unknown;
};

export function useMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>(
  options: MutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext> {
  const client = useQueryClient();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Auto-name mutations for system error reports: when no mutationKey is
  // declared, derive a stable label from the calling component's function
  // name via a one-time stack parse (works in dev; minified-but-stable in
  // prod builds). This keeps MutationCache.onError from reporting
  // "Mutation:unknown" for keyless mutations.
  const autoKeyRef = useRef<string | null>(null);
  if (autoKeyRef.current === null) {
    const declaredKey = Array.isArray(options.mutationKey)
      ? options.mutationKey.filter((p) => typeof p === 'string' && p.length > 0).join(':')
      : options.mutationKey;
    if (declaredKey) {
      autoKeyRef.current = String(declaredKey);
    } else {
      const frames = (new Error().stack ?? '').split('\n');
      let caller: string | undefined;
      for (const frame of frames) {
        const m = frame.match(/^\s*at (\w+)[ (]/);
        if (m && m[1] !== 'useMutation') {
          caller = m[1];
          break;
        }
      }
      autoKeyRef.current = caller ?? `mutation-${++autoMutationSeq}`;
    }
  }
  optionsRef.current = { ...optionsRef.current, mutationKey: [autoKeyRef.current] };

  const [state, setState] = useState<{
    data: TData | undefined;
    error: TError | null;
    status: 'idle' | 'pending' | 'error' | 'success';
    variables: TVariables | undefined;
    context: TContext | undefined;
    failureCount: number;
  }>({
    data: undefined,
    error: null,
    status: 'idle',
    variables: undefined,
    context: undefined,
    failureCount: 0,
  });

  const generationRef = useRef(0);
  const resetGenerationRef = useRef(0);

  const mutateAsync = useCallback(
    async (
      variables?: TVariables,
      mutateOpts?: MutateOpts<TData, TError, TVariables, TContext>,
    ): Promise<TData> => {
      const vars = variables as TVariables;
      // Merge client defaults for mutations (e.g. retry: 0)
      const clientDefaults = (client.getDefaultOptions().mutations ?? {}) as Partial<MutationOptions<TData, TError, TVariables, TContext>>;
      const opts: MutationOptions<TData, TError, TVariables, TContext> = {
        ...clientDefaults,
        ...optionsRef.current,
      };
      const myGen = ++generationRef.current;
      let context: TContext | undefined;

      setState((s) => ({
        ...s,
        status: 'pending',
        error: null,
        variables: vars,
        failureCount: 0,
      }));

      const resolveRetry = (retry: unknown): number | ((failureCount: number, error: unknown) => boolean) => {
        if (retry === false) return 0;
        if (retry === true) return Infinity;
        if (typeof retry === 'number' || typeof retry === 'function') return retry as number | ((failureCount: number, error: unknown) => boolean);
        return 0;
      };

      const mutationFn = opts.mutationFn;
      if (!mutationFn) throw new Error('Missing mutationFn');

      // Resolve retry semantics (include client defaults)
      const retryOpt = (opts.retry ?? clientDefaults.retry) as unknown;
      const maxRetries = resolveRetry(retryOpt);

      let failureCount = 0;
      for (;;) {
        // If reset happened after we started, abandon
        if (resetGenerationRef.current >= myGen && generationRef.current > myGen) {
          throw new DOMException('Mutation reset', 'AbortError');
        }
        try {
          if (failureCount === 0 && opts.onMutate) {
            context = await opts.onMutate(vars);
            if (generationRef.current !== myGen) throw new DOMException('Mutation superseded', 'AbortError');
            setState((s) => (generationRef.current === myGen ? { ...s, context } : s));
          }

          const data = await mutationFn(vars);
          if (generationRef.current !== myGen) throw new DOMException('Mutation superseded', 'AbortError');

          await opts.onSuccess?.(data, vars, context);
          // Only fire per-call callbacks if still latest generation
          if (generationRef.current === myGen) await mutateOpts?.onSuccess?.(data, vars, context);
          await opts.onSettled?.(data, null, vars, context);
          if (generationRef.current === myGen) await mutateOpts?.onSettled?.(data, null, vars, context);

          if (generationRef.current === myGen) {
            setState({
              data,
              error: null,
              status: 'success',
              variables: vars,
              context,
              failureCount: 0,
            });
          }
          return data;
        } catch (err) {
          if (err instanceof DOMException && (err.name === 'AbortError' || err.message === 'Mutation superseded' || err.message === 'Mutation reset')) {
            throw err;
          }
          const canRetry =
            typeof maxRetries === 'function'
              ? (maxRetries as (n: number, e: unknown) => boolean)(failureCount, err as TError)
              : (maxRetries as number) === Infinity
                ? true
                : failureCount < (maxRetries as number);
          if (!canRetry) {
            if (generationRef.current !== myGen) throw err as TError;
            const error = err as TError;
            client.getMutationCache().notifyError({
              error,
              variables: vars,
              context,
              mutation: { options: opts as unknown as MutationOptions<unknown, unknown, unknown, unknown> },
            });
            await opts.onError?.(error, vars, context);
            if (generationRef.current === myGen) await mutateOpts?.onError?.(error, vars, context);
            await opts.onSettled?.(undefined, error, vars, context);
            if (generationRef.current === myGen) await mutateOpts?.onSettled?.(undefined, error, vars, context);

            if (generationRef.current === myGen) {
              setState((s) => ({
                data: s.data,
                error,
                status: 'error',
                variables: vars,
                context,
                failureCount: s.failureCount + 1,
              }));
            }
            throw error;
          }
          failureCount++;
          if (generationRef.current === myGen) {
            setState((s) => (generationRef.current === myGen ? { ...s, failureCount } : s));
          }
          await new Promise<void>((r) => setTimeout(r, Math.min(1000 * 2 ** (failureCount - 1), 8000)));
        }
      }
    },
    [client],
  );

  const mutate = useCallback(
    (variables?: TVariables, mutateOpts?: MutateOpts<TData, TError, TVariables, TContext>) => {
      void mutateAsync(variables, mutateOpts).catch(() => {});
    },
    [mutateAsync],
  );

  const reset = useCallback(() => {
    generationRef.current++;
    resetGenerationRef.current = generationRef.current;
    setState({
      data: undefined,
      error: null,
      status: 'idle',
      variables: undefined,
      context: undefined,
      failureCount: 0,
    });
  }, []);

  return {
    data: state.data,
    error: state.error,
    isPending: state.status === 'pending',
    isError: state.status === 'error',
    isSuccess: state.status === 'success',
    isIdle: state.status === 'idle',
    status: state.status,
    variables: state.variables,
    mutate,
    mutateAsync,
    reset,
    failureCount: state.failureCount,
    context: state.context,
  };
}

/** Devtools removed with TanStack — stub keeps call sites compiling. */
export function ReactQueryDevtools(_props: { initialIsOpen?: boolean }) {
  return null;
}

function stableHash(key: readonly unknown[]): string {
  return JSON.stringify(key, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as object)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return v;
  });
}
