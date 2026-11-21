"use client";
import { useEffect } from "react";
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        event: "paceclub_render_error",
        digest: error.digest || "client-render",
      }),
    );
  }, [error]);
  return (
    <main className="shell">
      <section className="card">
        <h1>Let’s try that again.</h1>
        <p>
          This page could not load. Your saved activity remains associated with
          your account.
        </p>
        <button onClick={reset}>Retry</button>
        <p>
          <a href="/home">Return home</a>
        </p>
      </section>
    </main>
  );
}
