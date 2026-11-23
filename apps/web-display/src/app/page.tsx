'use client';
import { useCallback, useEffect, useState } from 'react';
import { Spinner } from '@homebell/ui-web';
import { Pairing } from '@/components/pairing';
import { QueueBoard } from '@/components/queue-board';
import { clearToken, loadToken, saveToken } from '@/lib/token-store';

export default function DisplayHome() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void loadToken().then(setToken);
  }, []);
  const onPaired = useCallback((t: string) => {
    void saveToken(t);
    setToken(t);
  }, []);
  const onUnpaired = useCallback(() => {
    void clearToken();
    setToken(null);
  }, []);
  if (token === undefined) {
    return (
      <div className="flex h-dvh items-center justify-center bg-bg text-text">
        <Spinner size={40} label="Starting…" />
      </div>
    );
  }
  return token ? (
    <QueueBoard token={token} onUnpaired={onUnpaired} onTokenRotated={onPaired} />
  ) : (
    <Pairing onPaired={onPaired} />
  );
}
