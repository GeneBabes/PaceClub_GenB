import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'PaceClub · First steps', description: 'PaceClub account and avatar starter' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
