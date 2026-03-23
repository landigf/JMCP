import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JMCP",
    short_name: "JMCP",
    description: "Jarvis is My Co-Pilot",
    start_url: "/",
    display: "standalone",
    background_color: "#101c1b",
    theme_color: "#101c1b",
    icons: [],
  }
}
