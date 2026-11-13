export const APP_URL = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
export const APP_SECRET = () => {
  const s = process.env.APP_SECRET;
  if (!s && process.env.NODE_ENV === 'production') throw new Error('APP_SECRET must be set in production');
  return s || 'dev-only-secret';
};
export const isDev = () => process.env.NODE_ENV !== 'production';
