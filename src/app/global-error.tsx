"use client";

// Root-layout error boundary. Must define its own <html>/<body> — it
// replaces the root layout when active, so it can't rely on ThemeProvider,
// fonts, or anything else from src/app/layout.tsx.
export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <h2>Something went wrong</h2>
        <p>An unexpected error occurred. Please try again.</p>
        <button onClick={() => unstable_retry()}>Try again</button>
      </body>
    </html>
  );
}
