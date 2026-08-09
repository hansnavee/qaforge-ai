import { Suspense } from 'react';
import { Sidebar } from '@/components/Sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-bg md:flex-row">
      <Suspense
        fallback={
          <aside className="w-full shrink-0 border-b border-border md:w-56 md:border-b-0 md:border-r" />
        }
      >
        <Sidebar />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 px-4 py-5 sm:px-6 md:px-8 md:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
