import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Tango — Conference Vocab", description: "Study vocabulary from General Conference" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ja"><body>{children}</body></html>; }
