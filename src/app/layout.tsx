import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Clause Review - Legal Document Discovery & Compliance Engine',
  description: 'Semantic contract review: find missing and risky clauses by comparing contracts with a library of standard clauses.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
