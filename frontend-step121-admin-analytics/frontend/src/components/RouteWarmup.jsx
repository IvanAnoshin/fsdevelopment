import { useEffect, useState } from 'react';
import { coreAuthedRouteLoaders } from '../routeLoaders';
import { getToken } from '../services/authStorage';

const idle = (cb) => {
  if (typeof window === 'undefined') return () => {};
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(cb, { timeout: 1800 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(cb, 700);
  return () => window.clearTimeout(id);
};

export default function RouteWarmup() {
  const [authVersion, setAuthVersion] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onChange = () => setAuthVersion((value) => value + 1);
    window.addEventListener('app:auth-changed', onChange);
    return () => window.removeEventListener('app:auth-changed', onChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (!getToken()) return undefined;
    const stop = idle(() => {
      coreAuthedRouteLoaders.forEach((loader, index) => {
        window.setTimeout(() => {
          loader().catch(() => null);
        }, index * 120);
      });
    });
    return stop;
  }, [authVersion]);

  return null;
}
