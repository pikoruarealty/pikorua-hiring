<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Before touching `next`, the `Dockerfile`, or your package manager

`node_modules/next` carries a `bun patch` workaround for a confirmed,
still-open upstream Next.js 16 bug (crashes `next build` on `/_global-error`
prerendering — see `patches/next@16.2.11.patch`). It only affects
`next build`/Docker builds, never `bun run dev`, so it's invisible during
normal feature work. Read `memory.md`'s "RESOLVED: `/_global-error`" section
in full before: upgrading `next`, using a package manager other than `bun`,
or restructuring the `Dockerfile`'s `base` stage — each of those can silently
break the patch and reintroduce the crash. Don't remove
`src/app/global-error.tsx` or `export const dynamic = "force-dynamic"` in
`src/app/layout.tsx` as unrelated cleanup; both are load-bearing for this fix.
