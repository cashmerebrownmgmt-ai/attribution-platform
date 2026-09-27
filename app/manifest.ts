import type { MetadataRoute } from "next";

/** Lets the dashboard be added to a phone's home screen and open full screen, like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Attribution · Cashmere Brown",
    short_name: "Attribution",
    description: "Sales, ad spend, profit and live visitors for Cashmere Brown.",
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0d0d0d",
    theme_color: "#0d0d0d",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Live", url: "/dashboard/live" },
      { name: "Daily report", url: "/dashboard/daily" },
      { name: "Today", url: "/dashboard?range=today" },
    ],
  };
}
