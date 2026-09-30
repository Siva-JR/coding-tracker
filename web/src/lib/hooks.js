import { useCallback, useEffect, useRef, useState } from 'react';

/** Runs `fn` whenever `deps` change; ignores results from superseded calls. */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useRef(0);
  const exec = useCallback(() => {
    const id = ++run.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => id === run.current && setState({ data, error: null, loading: false }),
      (error) => id === run.current && setState({ data: null, error, loading: false }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { exec(); }, [exec]);
  return { ...state, reload: exec };
}
