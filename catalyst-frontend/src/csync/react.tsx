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

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const query = useMemo(() => {
    return client.ensureQuery({
      ...optionsRef.current,
      queryKey,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, queryKeyHash]);

  query.options = {
    ...client.getDefaultOptions().queries,
    ...options,
    queryKey,
  } as QueryOptions<TData, TError>;

  const subscribe = useCallback(
    (onStoreChange: () => void) => client.subscribeQuery(query as unknown as Query, onStoreChange),
    [client, query],
  );

  const getSnapshot = useCallback(() => query.state, [query]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    if (!optionsRef.current.queryFn) return;

    const staleTime =
      optionsRef.current.staleTime ?? client.getDefaultOptions().queries?.staleTime ?? 60_000;
    const hasData = query.state.data !== undefined;
    const isStale =
      query.state.isInvalidated ||
      !hasData ||
      Date.now() - query.state.dataUpdatedAt >= (typeof staleTime === 'number' ? staleTime : 0);

    if (isStale) {
      void client.fetchQuery({ ...optionsRef.current, queryKey });
    }

    client.setupRefetchInterval(query as unknown as Query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, query, enabled, queryKeyHash, state.isInvalidated, state.dataUpdatedAt]);

  const placeholder = options.placeholderData;
  const select = options.select;
  let data = state.data as TData | undefined;
  const prevDataRef = useRef<TData | undefined>(undefined);
  if (state.data !== undefined) {
    prevDataRef.current = state.data as TData;
  }
  if (data === undefined && placeholder !== undefined) {
    data =
      typeof placeholder === 'function'
        ? (placeholder as (p: TData | undefined) => TData | undefined)(prevDataRef.current)
        : (placeholder as TData);
  }
  // Apply select on every read so cache writers (SSE/setQueryData) cannot leak
  // raw shapes to consumers. Runs after placeholder resolution.
  // Memoize by input reference: select([]) must not allocate a fresh [] every
  // render (React 19 prev-state sync loops on unstable empty arrays).
  const selectInputRef = useRef<TData | undefined>(undefined);
  const selectOutputRef = useRef<TData | undefined>(undefined);
  if (data !== undefined && typeof select === 'function') {
    if (selectInputRef.current !== data) {
      selectInputRef.current = data;
      selectOutputRef.current = select(data);
    }
    data = selectOutputRef.current;
  } else {
    selectInputRef.current = undefined;
    selectOutputRef.current = undefined;
  }

  const isPending =
    enabled && state.data === undefined && data === undefined && state.status === 'pending';
  const isFetching = state.fetchStatus === 'fetching';
  const isLoading = Boolean(isPending && isFetching);
  const isError = state.status === 'error' && state.data === undefined;
  const isSuccess = state.data !== undefined && state.error === null;

  // Depend on queryKeyHash — queryKey arrays are recreated every render and would
  // churn refetch identity, which re-fires every effect that lists refetch as a dep.
  const refetch = useCallback(() => {
    return client.fetchQuery({ ...optionsRef.current, queryKey: optionsRef.current.queryKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, queryKeyHash]);

  const result: UseQueryResult<TData, TError> = {
    data,
    error: state.error as TError | null,
    isLoading,
    isPending: Boolean(isPending),
    isFetching,
    isError,
    isSuccess,
    isFetched: state.dataUpdatedAt > 0 || state.errorUpdatedAt > 0,
    status: state.status,
    fetchStatus: state.fetchStatus,
    refetch,
    failureCount: 0,
  };

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

  const mutateAsync = useCallback(
    async (
      variables?: TVariables,
      mutateOpts?: MutateOpts<TData, TError, TVariables, TContext>,
    ): Promise<TData> => {
      const vars = variables as TVariables;
      const opts = optionsRef.current;
      let context: TContext | undefined;

      setState((s) => ({
        ...s,
        status: 'pending',
        error: null,
        variables: vars,
        failureCount: 0,
      }));

      try {
        if (opts.onMutate) {
          context = await opts.onMutate(vars);
        }
        setState((s) => ({ ...s, context }));

        const mutationFn = opts.mutationFn;
        if (!mutationFn) throw new Error('Missing mutationFn');

        const data = await mutationFn(vars);

        await opts.onSuccess?.(data, vars, context);
        await mutateOpts?.onSuccess?.(data, vars, context);
        await opts.onSettled?.(data, null, vars, context);
        await mutateOpts?.onSettled?.(data, null, vars, context);

        setState({
          data,
          error: null,
          status: 'success',
          variables: vars,
          context,
          failureCount: 0,
        });
        return data;
      } catch (err) {
        const error = err as TError;
        client.getMutationCache().notifyError({
          error,
          variables: vars,
          context,
          mutation: { options: opts as MutationOptions<any, any, any, any> },
        });
        await opts.onError?.(error, vars, context);
        await mutateOpts?.onError?.(error, vars, context);
        await opts.onSettled?.(undefined, error, vars, context);
        await mutateOpts?.onSettled?.(undefined, error, vars, context);

        setState((s) => ({
          data: s.data,
          error,
          status: 'error',
          variables: vars,
          context,
          failureCount: s.failureCount + 1,
        }));
        throw error;
      }
    },
    [client],
  );

  const mutate = useCallback(
    (variables?: TVariables, mutateOpts?: MutateOpts<TData, TError, TVariables, TContext>) => {
      void mutateAsync(variables, mutateOpts).catch(() => {
        /* surfaced via state + onError */
      });
    },
    [mutateAsync],
  );

  const reset = useCallback(() => {
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
