/**
 * Absolute URLs back into this app, correct whether it is hosted at the domain root or under a
 * sub-path such as https://user.github.io/tripnest/ (set at build time through VITE_BASE).
 */
export function routerBasename(): string {
  const base = import.meta.env.BASE_URL || '/';
  return base === '/' ? '' : base.replace(/\/$/, '');
}

/** appUrl('invite/abc') -> https://host/tripnest/invite/abc */
export function appUrl(path = ''): string {
  return `${window.location.origin}${routerBasename()}/${path.replace(/^\//, '')}`;
}
