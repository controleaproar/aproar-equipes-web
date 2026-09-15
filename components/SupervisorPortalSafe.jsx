'use client';

import { useEffect, useState } from "react";
import SupervisorPortal from "./SupervisorPortal";

export default function SupervisorPortalSafe() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = (input, init) => {
      if (typeof input === "string" && input.startsWith("/api/supervisor")) {
        return originalFetch(input.replace("/api/supervisor", "/api/supervisor-safe"), init);
      }
      if (input instanceof Request) {
        const url = new URL(input.url, window.location.origin);
        if (url.pathname === "/api/supervisor") {
          url.pathname = "/api/supervisor-safe";
          return originalFetch(new Request(url.toString(), input), init);
        }
      }
      return originalFetch(input, init);
    };

    setReady(true);
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  if (!ready) {
    return <main className="shell"><div className="loading-block">Carregando Portal do Supervisor...</div></main>;
  }

  return <SupervisorPortal />;
}
