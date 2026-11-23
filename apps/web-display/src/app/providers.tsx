'use client';
import type { ReactNode } from 'react';
import { ApiProvider, type ApiMode } from '@homebell/web-core';

const MODE: ApiMode = process.env.NEXT_PUBLIC_HB_API_MODE === 'real' ? 'real' : 'mock';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ApiProvider app="display" mode={MODE}>
      {children}
    </ApiProvider>
  );
}
