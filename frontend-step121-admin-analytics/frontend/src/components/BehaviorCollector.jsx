import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { destroyDFSNCollector, getDFSNCollector, initDFSNCollector } from '../services/dfsnCollector';

const idle = (cb) => {
  if (typeof window === 'undefined') return () => {};
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(cb, { timeout: 2000 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(cb, 800);
  return () => window.clearTimeout(id);
};

export default function BehaviorCollector() {
  const location = useLocation();

  useEffect(() => {
    const cancel = idle(() => initDFSNCollector());
    return () => {
      cancel();
      destroyDFSNCollector();
    };
  }, []);

  useEffect(() => {
    const notify = () => getDFSNCollector().onRouteChange(`${location.pathname}${location.search || ''}`);
    const cancel = idle(notify);
    return cancel;
  }, [location.pathname, location.search]);

  return null;
}
