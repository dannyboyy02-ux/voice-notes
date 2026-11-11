import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice Notes",
  description: "Record, transcribe and turn talk into to-dos and reminders.",
  appleWebApp: { capable: true, title: "Voice Notes", statusBarStyle: "default" },
  // The ?v= changes whenever the artwork does, so phones fetch the new icon instead of a cached one.
  icons: { icon: "/icons/icon-192.png?v=3", apple: "/icons/apple-touch-icon.png?v=3" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0e131a" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
