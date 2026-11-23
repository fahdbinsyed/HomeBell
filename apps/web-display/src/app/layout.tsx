import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'HomeBell Display',
  description: 'HomeBell pickup queue display screen',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: '#0E121A' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body className="overflow-hidden">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
