import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anime Data Create",
  description: "入力作業用アプリ集",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
