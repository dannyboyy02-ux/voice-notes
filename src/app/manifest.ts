import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Voice Notes",
    short_name: "Voice Notes",
    description: "Record, transcribe and turn talk into to-dos and reminders.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3f5f9",
    theme_color: "#0f5fa8",
    icons: [
      { src: "/icons/icon-192.png?v=2", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png?v=2", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
