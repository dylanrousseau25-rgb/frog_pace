import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Frog Pace",
    short_name: "Frog Pace",
    description: "Ton coach d'endurance personnel.",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f8f5",
    theme_color: "#62d84e",
    categories: ["sports", "fitness", "health"],
    icons: [
      { src: "/frog-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/frog-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }
    ]
  };
}
