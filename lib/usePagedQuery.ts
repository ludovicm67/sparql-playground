import { useCallback, useEffect, useRef, useState } from "react";

export type PagedQuery<T> = {
  items: T[];
  loading: boolean;
  error: string | undefined;
  /** True once a short page came back, meaning there is nothing more to fetch. */
  exhausted: boolean;
  loadMore: () => void;
};

/**
 * Loads one page on mount and appends further pages on demand.
 *
 * There is deliberately no reset path: callers give the component a `key` tied
 * to what it is listing, so switching sources remounts with fresh state instead
 * of racing an in-flight page against a reset.
 */
export const usePagedQuery = <T,>(
  load: (offset: number) => Promise<T[]>,
  pageSize: number
): PagedQuery<T> => {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [exhausted, setExhausted] = useState(false);

  const busy = useRef(false);
  const known = useRef(0);

  // Held in a ref rather than depended on: callers rebuild this closure freely
  // (a canvas drag rebuilds it every pointer event), and re-running the fetch
  // for each new identity would hammer the endpoint. Switching sources is done
  // by remounting with a new `key`, per the note above.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    let active = true;
    busy.current = true;

    // The state updates below all sit after an await, so mounting does not
    // cascade a synchronous re-render.
    void (async () => {
      try {
        const page = await loadRef.current(0);
        if (!active) {
          return;
        }
        known.current = page.length;
        setItems(page);
        setExhausted(page.length < pageSize);
        setError(undefined);
      } catch (failure) {
        if (!active) {
          return;
        }
        setError(failure instanceof Error ? failure.message : String(failure));
        setExhausted(true);
      } finally {
        busy.current = false;
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
    // Mount only: see `loadRef` above.
  }, [pageSize]);

  const loadMore = useCallback(() => {
    if (busy.current || exhausted || loading) {
      return;
    }

    busy.current = true;
    setLoading(true);

    void (async () => {
      const offset = known.current;
      try {
        const page = await loadRef.current(offset);
        known.current += page.length;
        setItems((current) => [...current, ...page]);
        setExhausted(page.length < pageSize);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
        setExhausted(true);
      } finally {
        busy.current = false;
        setLoading(false);
      }
    })();
  }, [exhausted, loading, pageSize]);

  return { items, loading, error, exhausted, loadMore };
};

/** True when a scroll container is close to its bottom. */
export const nearBottom = (element: HTMLElement, threshold = 120) =>
  element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
