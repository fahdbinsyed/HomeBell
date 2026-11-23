'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { decodeSupportHandoff } from '@homebell/mocks';
import { AuthLayout, Banner, Logo, Spinner } from '@homebell/ui-web';
import { useApi } from '@homebell/web-core';

/**
 * Entry point for platform support sessions (read-only "view as school").
 * Mock mode: imports the hand-off payload into this app's mock DB.
 * Phase 3: the BFF exchanges the session id for a support cookie.
 */
export default function SupportEntryPage() {
  const { mock } = useApi();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const payload = decodeSupportHandoff(window.location.hash.slice(1));
    window.history.replaceState(null, '', '/support');
    if (!mock) return setError('Support sessions connect through the real API in Phase 3.');
    if (!payload || !mock.importSupportSession(payload))
      return setError(
        'This support link is invalid or has expired. Start a new session from the platform portal.',
      );
    void qc.invalidateQueries();
    router.replace(`/t/${payload.tenantId}/overview`);
  }, [mock, qc, router]);
  return (
    <AuthLayout brand={<Logo product="for Schools" />} title="Opening support session">
      {error ? (
        <Banner tone="danger">{error}</Banner>
      ) : (
        <Spinner label="Starting read-only session…" />
      )}
    </AuthLayout>
  );
}
