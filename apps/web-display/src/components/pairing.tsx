'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { unwrap } from '@homebell/api-client';
import type { PairingSession } from '@homebell/contracts';
import { DEMO } from '@homebell/mocks';
import { Logo } from '@homebell/ui-web';
import { messageFor, useApi } from '@homebell/web-core';

const SCHOOL_APP = process.env.NEXT_PUBLIC_SCHOOL_APP_URL ?? 'http://localhost:3000';

/** Shows a pairing code + QR, polls until a school admin pairs this screen (ADR-0013). */
export function Pairing({ onPaired }: { onPaired: (token: string) => void }) {
  const { client, mock } = useApi();
  const [session, setSession] = useState<PairingSession | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    unwrap(client.POST('/v1/display/pairing-sessions', { body: { appVersion: '1.0.0' } }))
      .then(async (s) => {
        if (cancelled) return;
        setSession(s);
        setQr(
          await QRCode.toDataURL(`${SCHOOL_APP}/select?pairDisplay=${s.pairingCode}`, {
            margin: 1,
            width: 320,
            color: { dark: '#0E121A', light: '#FFFFFF' },
          }),
        );
      })
      .catch((e) => !cancelled && setError(messageFor(e)));
    return () => {
      cancelled = true;
    };
  }, [client, generation]);

  useEffect(() => {
    if (!session) return;
    const h = setInterval(async () => {
      try {
        const r = await unwrap(
          client.GET('/v1/display/pairing-sessions/{pairingSessionId}', {
            params: {
              path: { pairingSessionId: session.pairingSessionId },
              header: { 'X-Pairing-Secret': session.pollSecret },
            },
          }),
        );
        if (r.status === 'paired' && r.displayToken) onPaired(r.displayToken);
        if (r.status === 'expired') setGeneration((g) => g + 1);
      } catch {
        /* keep polling; transient errors are expected on TVs with flaky Wi-Fi */
      }
    }, session.pollIntervalSeconds * 1000);
    const expiry = setTimeout(
      () => setGeneration((g) => g + 1),
      Math.max(10_000, Date.parse(session.expiresAt) - Date.now()),
    );
    return () => {
      clearInterval(h);
      clearTimeout(expiry);
    };
  }, [client, session, onPaired]);

  const code = session?.pairingCode ?? '········';
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-10 bg-bg p-10 text-center text-text">
      <div className="scale-150">
        <Logo product="Display" />
      </div>
      <div>
        <h1 className="text-4xl font-semibold">Pair this screen</h1>
        <p className="mt-3 text-xl text-text-muted">
          In the HomeBell school dashboard, open{' '}
          <strong className="text-text">Display screens → Pair a screen</strong> and enter this
          code.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-2xl text-danger-fg">
          {error} — retrying…
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-12">
          <p
            aria-label={`Pairing code ${code.split('').join(' ')}`}
            className="font-mono text-7xl font-bold tracking-[0.25em] text-text"
          >
            {code.slice(0, 4)}
            <span className="text-text-muted">-</span>
            {code.slice(4)}
          </p>
          {qr && (
            <img
              src={qr}
              alt="QR code with the pairing code"
              className="size-56 rounded-xl bg-white p-2"
            />
          )}
        </div>
      )}
      <p className="text-lg text-text-muted">The code refreshes every 10 minutes.</p>
      {mock && (
        <div className="rounded-xl border border-warning-border bg-warning-bg p-4 text-base text-warning-fg">
          <p className="mb-2">
            Mock mode: this screen and the school dashboard keep separate demo data, so codes can’t
            be paired across them.
          </p>
          <button
            type="button"
            className="rounded-md border border-warning-border bg-surface px-4 py-2 font-medium text-text"
            onClick={() => onPaired(DEMO.displayToken)}
          >
            Use the demo Greenfield Academy screen
          </button>
        </div>
      )}
    </main>
  );
}
