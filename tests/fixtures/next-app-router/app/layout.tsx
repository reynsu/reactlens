import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata = {
  title: 'reactlens · next fixture',
  description: 'Next.js App Router fixture for reactlens e2e tests.',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="layout">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
