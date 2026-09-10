import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '合拍 DUET｜Windows 雙影片工作台',
  icons: { icon: '/favicon.svg' },
  description:
    '在 Windows 用音樂對齊兩部影片，獨立試聽、自由構圖並下載融合成品。影片只在你的電腦處理。',
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#101313',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
