'use client';
import { useState, type ReactNode } from 'react';
import { useLink } from './surfaces';

const cx = (...p: Array<string | false | null | undefined>) => p.filter(Boolean).join(' ');

export interface NavItem {
  href: string;
  label: string;
  icon?: ReactNode;
  active?: boolean;
  badge?: ReactNode;
}

/** Responsive app shell: sidebar on desktop, drawer on mobile, skip link, top banner slot. */
export function AppShell({
  brand,
  nav,
  user,
  banner,
  children,
}: {
  brand: ReactNode;
  nav: NavItem[];
  user?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const Link = useLink();
  const navList = (
    <nav aria-label="Main" className="flex flex-col gap-0.5 p-3">
      {nav.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={n.active ? 'page' : undefined}
          className={cx(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
            n.active
              ? 'bg-info-bg text-info-fg'
              : 'text-text-muted hover:bg-surface-muted hover:text-text',
          )}
        >
          {n.icon && (
            <span className="size-5" aria-hidden>
              {n.icon}
            </span>
          )}
          <span className="flex-1">{n.label}</span>
          {n.badge}
        </Link>
      ))}
    </nav>
  );
  return (
    <div className="min-h-dvh bg-bg text-text">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-16 items-center border-b border-border px-5">{brand}</div>
        <div className="flex-1 overflow-y-auto">{navList}</div>
        {user && <div className="border-t border-border p-3">{user}</div>}
      </aside>
      {open && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface"
            onClick={() => setOpen(false)}
          >
            <div className="flex h-16 items-center border-b border-border px-5">{brand}</div>
            <div className="flex-1 overflow-y-auto">{navList}</div>
            {user && <div className="border-t border-border p-3">{user}</div>}
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md p-2 hover:bg-surface-muted"
            aria-label="Open navigation"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
              <path
                d="M3 6h18M3 12h18M3 18h18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          {brand}
        </header>
        {banner && <div className="flex flex-col gap-2 px-4 pt-4 sm:px-8">{banner}</div>}
        <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Minimal centred layout for sign-in screens. */
export function AuthLayout({
  brand,
  title,
  subtitle,
  children,
  footer,
}: {
  brand: ReactNode;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10 text-text">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">{brand}</div>
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-6 text-center text-xs text-text-muted">{footer}</div>}
      </div>
    </div>
  );
}

export function Logo({ product, endorsement = true }: { product: string; endorsement?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" className="fill-primary" />
        <path
          d="M16 7a6 6 0 0 0-6 6v4.5L8 21h16l-2-3.5V13a6 6 0 0 0-6-6Zm-2.5 16a2.5 2.5 0 0 0 5 0"
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <span className="flex flex-col leading-tight">
        <span className="text-base font-semibold text-text">
          HomeBell <span className="font-normal text-text-muted">{product}</span>
        </span>
        {endorsement && <span className="text-[10px] text-text-muted">Powered by neuXplus</span>}
      </span>
    </span>
  );
}
