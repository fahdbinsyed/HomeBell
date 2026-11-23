'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';
import { LinkProvider, type LinkLike } from '@homebell/ui-web';
import { ApiProvider, type ApiMode } from '@homebell/web-core';

const NextLink: LinkLike = ({ href, ...rest }) => <Link href={href} {...rest} />;
const MODE: ApiMode = process.env.NEXT_PUBLIC_HB_API_MODE === 'real' ? 'real' : 'mock';

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const onUnauthorized = useCallback(() => router.replace('/login'), [router]);
  return (
    <LinkProvider value={NextLink}>
      <ApiProvider app="school" mode={MODE} onUnauthorized={onUnauthorized}>
        {children}
      </ApiProvider>
    </LinkProvider>
  );
}
