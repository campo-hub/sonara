import { useLayoutEffect, useState } from 'react';
import { computeMixGridFit } from './homeFit.js';

export function useMixGridFit(ref, count) {
  const [fit, setFit] = useState(() => computeMixGridFit({ width: 0, height: 0, count: count || 0 }));

  useLayoutEffect(() => {
    const element = ref?.current;
    if (!element) return undefined;

    const measure = () => {
      const width = element.clientWidth || 0;
      setFit(computeMixGridFit({ width, count: count || 0 }));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count, ref]);

  return fit;
}

export function useVisibleCount(ref, items, initialLimit = 8) {
  const [visibleCount, setVisibleCount] = useState(Math.min(items.length, initialLimit));

  useLayoutEffect(() => {
    const element = ref?.current;
    if (!element) return undefined;

    const measure = () => {
      const maxItems = items.length || 0;
      if (!maxItems) {
        setVisibleCount(0);
        return;
      }

      const itemHeight = 52;
      const columnHeight = element.clientHeight || 0;
      const nextCount = Math.max(0, Math.min(maxItems, Math.floor(columnHeight / itemHeight)) || initialLimit);
      setVisibleCount((current) => (current === nextCount ? current : nextCount));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [initialLimit, items, ref]);

  return visibleCount;
}
