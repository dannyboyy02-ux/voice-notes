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
  themeColor: "#0b0c0e",
};

const THEME_SCRIPT = `try{var t=localStorage.getItem("voice-notes-theme");if(t==="light"||t==="auto")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the saved look before the first paint, so the screen never flashes the wrong colours. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
