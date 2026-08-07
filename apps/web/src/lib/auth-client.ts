import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  // Required for Vercel (web) ↔ Railway (API) so the browser stores/sends session cookies.
  fetchOptions: {
    credentials: 'include',
  },
});
