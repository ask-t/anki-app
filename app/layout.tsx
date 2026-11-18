import "./globals.css";
import type { Metadata, Viewport } from "next";
export const metadata: Metadata = { title: "Anki App — Conference Vocab", description: "Study vocabulary from General Conference" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#eef3fb" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      {/* Browser extensions can add attributes to body before React hydrates. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
