import type { MetadataRoute } from "next";

/** Prototype interne : indexation totalement bloquée. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
