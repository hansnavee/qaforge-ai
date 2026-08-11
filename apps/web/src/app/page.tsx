import Link from 'next/link';
import { Button } from '@/components/Button';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(1200px 700px at 15% -10%, rgba(20,184,166,0.28), transparent 55%), radial-gradient(900px 600px at 90% 10%, rgba(56,189,248,0.12), transparent 50%), linear-gradient(180deg, #071018 0%, #0b1220 45%, #0a1628 100%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.08) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage:
            'radial-gradient(ellipse at center, black 20%, transparent 75%)',
        }}
      />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <div className="text-sm font-semibold tracking-tight">
          QAForge
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Log in
            </Button>
          </Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-6xl flex-col justify-center px-6 pb-24 pt-10">
        <p className="mb-4 text-xs font-medium uppercase tracking-[0.22em] text-accent">
          QAForge
        </p>
        <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight text-fg sm:text-6xl">
          Ship with confidence. Let agents forge your QA.
        </h1>
        <p className="mt-5 max-w-xl text-pretty text-base text-muted sm:text-lg">
          Multi-agent discovery, accessibility, security checklists, Playwright
          automation, and executive reports — orchestrated end to end.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/signup">
            <Button size="lg">Start free</Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="secondary">
              Open dashboard
            </Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
