'use client';

import Link from 'next/link';
import { useId } from 'react';

/** The VYSN "V" mark (vector copy of public/brand/vysn-logo-original.png). */
export function VysnMark({ height = 24, className }: { height?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="390 343 502 352" height={height} width={(height * 502) / 352} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}l`} x1="410" y1="346" x2="700" y2="692" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#007cfb" />
          <stop offset="1" stopColor="#0050c4" />
        </linearGradient>
        <linearGradient id={`${id}r`} x1="860" y1="346" x2="700" y2="640" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00dfd8" />
          <stop offset="0.55" stopColor="#12b9e6" />
          <stop offset="1" stopColor="#0784f8" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id}l)`} d="M393,346 L495,346 C525,346 545,368 557,395 L676,640 C686,662 702,685 731,692 L603,692 C578,692 556,678 545,652 Z" />
      <path fill={`url(#${id}r)`} d="M888,346 L750,616 C742,632 729,639 714,639 C703,639 694,633 689,624 L651,552 L720,412 C738,374 760,346 794,346 Z" />
    </svg>
  );
}

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="VYSN Video – Startseite">
      <VysnMark height={20} />
      <span className="brand-word">VYSN</span>
      <em>Video</em>
    </Link>
  );
}
