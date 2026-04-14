import { useEffect } from 'react';

export const APP_TITLE = 'Friendscape';

export function formatDisplayName(user) {
  const firstName = String(user?.first_name || '').trim();
  const lastName = String(user?.last_name || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fullName || String(user?.username || '').trim() || '';
}

export function buildDocumentTitle(page, detail = '') {
  const pageLabel = String(page || '').trim();
  const detailLabel = String(detail || '').trim();
  const parts = [];
  if (pageLabel) parts.push(pageLabel);
  if (detailLabel) parts.push(detailLabel);
  parts.push(APP_TITLE);
  return parts.join(' · ');
}

export function useDocumentTitle(page, detail = '') {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = buildDocumentTitle(page, detail);
  }, [page, detail]);
}
