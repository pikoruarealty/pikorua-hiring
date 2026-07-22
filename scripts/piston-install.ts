import "dotenv/config";

/**
 * Installs the Piston language packages this platform needs. Run after the
 * `piston` container's first boot (its runtime list starts empty) — see
 * `bun run piston:install` / docker-compose.yml comments.
 *
 * Piston packages don't map 1:1 to our canonical language codes: "c" and
 * "cpp" both come from the single `gcc` package (Piston aliases the runtime
 * to both languages once installed). Versions pinned to what's available on
 * the current Piston package index.
 */
const PISTON_API_URL = process.env.PISTON_API_URL ?? "http://localhost:2000";

const PACKAGES = [
  { language: "gcc", version: "10.2.0" },
  { language: "java", version: "15.0.2" },
  { language: "python", version: "3.12.0" },
];

async function main() {
  for (const pkg of PACKAGES) {
    process.stdout.write(`Installing ${pkg.language}@${pkg.version}... `);
    const res = await fetch(`${PISTON_API_URL}/api/v2/packages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pkg),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      console.log(`FAILED (${res.status})`, body);
      process.exitCode = 1;
      continue;
    }
    console.log("ok", body);
  }

  const runtimes = await fetch(`${PISTON_API_URL}/api/v2/runtimes`).then((r) => r.json());
  console.log("\nInstalled runtimes:", JSON.stringify(runtimes, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
