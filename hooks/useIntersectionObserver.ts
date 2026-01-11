import { useEffect, useRef, useState } from 'react';

export interface UseIntersectionObserverOptions {
  threshold?: number | number[];
  root?: Element | null;
  rootMargin?: string;
  freezeOnceVisible?: boolean;
}

/**
 * Hook for detecting when an element enters the viewport
 * Returns [setRef, isIntersecting] tuple
 */
export function useIntersectionObserver<T extends HTMLElement = HTMLDivElement>(
  options: UseIntersectionObserverOptions = {}
): [React.RefCallback<T>, boolean] {
  const {
    threshold = 0,
    root = null,
    rootMargin = '200px', // Load 200px before entering viewport
    freezeOnceVisible = true,
  } = options;

  const [isIntersecting, setIsIntersecting] = useState(false);
  const [element, setElement] = useState<T | null>(null);
  const frozenRef = useRef(false);

  useEffect(() => {
    if (!element) return;

    // If already frozen as visible, don't observe
    if (freezeOnceVisible && frozenRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const isElementIntersecting = entry.isIntersecting;

        setIsIntersecting(isElementIntersecting);

        if (isElementIntersecting && freezeOnceVisible) {
          frozenRef.current = true;
        }
      },
      { threshold, root, rootMargin }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [element, threshold, root, rootMargin, freezeOnceVisible]);

  return [setElement, isIntersecting];
}
