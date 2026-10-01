import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Editor } from '../../components/editor/editor';

export const metadata: Metadata = { title: 'Editor – VYSN Video', robots: { index: false } };

export default function Page() {
  return <Suspense fallback={null}><Editor /></Suspense>;
}
