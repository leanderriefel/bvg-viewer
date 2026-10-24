import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    links: [
      { rel: "stylesheet", href: appCss },
      // The tile host is contacted immediately after hydration; warming the
      // connection here saves a DNS + TLS round trip on first paint.
      { rel: "preconnect", href: "https://tiles.openfreemap.org" },
      { rel: "dns-prefetch", href: "https://photon.komoot.io" },
    ],
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover",
      },
      { name: "color-scheme", content: "light dark" },
      { title: "Berlin in 3D" },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="overscroll-none">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
