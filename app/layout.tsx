import type { Metadata, Viewport } from 'next';
import { Inter, Sora } from 'next/font/google';
import './globals.css';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const display = Sora({ subsets: ['latin'], variable: '--font-display-face', display: 'swap', weight: ['400', '500', '600', '700'] });

export const metadata: Metadata = {
  title: 'VYSN Video – Marketing-Videos mit KI schneiden',
  description: 'Fotos und Clips hochladen – VYSN Video schneidet automatisch ein fertiges Reel, TikTok oder Werbevideo. Mit Editor, Texten, Musik im Takt und Export.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#070b16' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${sans.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
