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
    background_color: "#0b0c0e",
    theme_color: "#0b0c0e",
    icons: [
      { src: "/icons/icon-192.png?v=3", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png?v=3", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png?v=3", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
