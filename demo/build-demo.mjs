// Builds a read-only STATIC demo of the app for GitHub Pages.
//
// It MUTATES the working tree (removes login/api/proxy, stubs server actions, ...),
// so run it only in a throwaway checkout (CI) or restore afterwards with
//   git checkout -- . && git clean -fd src
// Requires DATABASE_URL pointing to a migrated + seeded Postgres (read at build time only).
//
// Usage:  node demo/build-demo.mjs [--force]      env: BASE_PATH=/repo-name

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

if (!process.env.CI && !process.argv.includes("--force")) {
  console.error("Refusing to modify the working tree outside CI. Re-run with --force in a throwaway checkout.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (migrated + seeded Postgres).");
  process.exit(1);
}

const BASE_PATH = process.env.BASE_PATH ?? "";
const read = (p) => readFileSync(p, "utf8");
const write = (p, s) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s);
};
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

// 1. Server-only features a static site cannot run.
for (const p of ["src/proxy.ts", "src/app/api", "src/app/login"]) rmSync(p, { recursive: true, force: true });

// 2. Auth stub: everyone is a demo user.
write(
  "src/auth.ts",
  `export async function auth() {
  return { user: { id: "demo", name: "Demo", role: "ADMIN" } };
}
`,
);
write("src/lib/current-user.ts", `export async function requireUser() {\n  return { id: "demo", name: "Demo", role: "ADMIN" };\n}\n`);

// 3. Server actions -> read-only stubs.
const MSG = "Mode demo : lecture seule.";
for (const f of readdirSync("src/lib/actions")) {
  const path = join("src/lib/actions", f);
  const names = [...read(path).matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  if (f === "couleurs.ts") {
    write(
      path,
      `export type CouleurState = { ok?: boolean; error?: string };
export async function changerCouleur(..._args: unknown[]): Promise<CouleurState> {
  return { error: ${JSON.stringify(MSG)} };
}
`,
    );
  } else {
    write(path, names.map((n) => `export async function ${n}(..._args: unknown[]): Promise<void> {}\n`).join(""));
  }
}

// 4. Nav: drop the sign-out server action, show a demo badge.
{
  const p = "src/components/AppNav.tsx";
  const s = read(p)
    .replace('import { auth, signOut } from "@/auth";', 'import { auth } from "@/auth";')
    .replace(
      /<form[\s\S]*?<\/form>/,
      '<span className="rounded bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600">Demo - lecture seule</span>',
    );
  write(p, s);
}

// 4b. Inline server actions inside pages/components: drop the action, make submit buttons inert.
for (const p of walk("src").filter((f) => f.endsWith(".tsx"))) {
  const s = read(p);
  if (!s.includes('"use server"')) continue;
  write(
    p,
    s
      .replace(/\s*action=\{async \([^)]*\) => \{\s*"use server";[\s\S]*?\n\s*\}\}/g, "")
      .replace(/type="submit"/g, 'type="button" title="Desactive dans la demo"'),
  );
}

// 4c. Server components cannot pass plain functions as <form action>: drop them (client components keep theirs).
for (const p of walk("src").filter((f) => f.endsWith(".tsx"))) {
  const s = read(p);
  if (/^\s*["']use client["']/.test(s)) continue;
  const t = s.replace(/\baction=\{[A-Za-z_]\w*\}/g, "action={undefined as never}");
  if (t !== s) write(p, t);
}

// 5. "new" form pages (use searchParams / server actions) -> static notice.
const notice = (titre) => `export default function Page() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold text-neutral-900">${titre}</h1>
      <p className="text-neutral-600">Cette demo statique est en lecture seule : la creation est desactivee.</p>
    </div>
  );
}
`;
for (const [dir, titre] of [
  ["clients", "Nouveau client"],
  ["produits", "Nouveau produit"],
  ["devis", "Nouveau devis"],
  ["factures", "Nouvelle facture"],
  ["avoirs", "Nouvel avoir"],
]) {
  write(`src/app/(app)/${dir}/new/page.tsx`, notice(titre));
}

// 6. Dynamic [id] pages and PDF routes need generateStaticParams; PDF routes must be static.
const MODEL = { avoirs: "avoir", clients: "client", devis: "devis", factures: "facture", produits: "produit" };
for (const [dir, model] of Object.entries(MODEL)) {
  const files = [`src/app/(app)/${dir}/[id]/page.tsx`, `src/app/(app)/${dir}/[id]/pdf/route.ts`];
  for (const p of files) {
    if (!existsSync(p)) continue;
    let s = read(p);
    s += `\nexport async function generateStaticParams() {\n  return (await prisma.${model}.findMany({ select: { id: true } })).map((r) => ({ id: r.id }));\n}\n`;
    if (p.endsWith("route.ts")) s += `\nexport const dynamic = "force-static";\n`;
    write(p, s);
  }
}

// 6b. Serve PDFs as .../document.pdf so GitHub Pages sends a PDF content type (an extensionless file downloads).
for (const dir of ["avoirs", "devis", "factures"]) {
  const from = `src/app/(app)/${dir}/[id]/pdf`;
  if (existsSync(from)) renameSync(from, `src/app/(app)/${dir}/[id]/document.pdf`);
}
for (const p of walk("src").filter((f) => f.endsWith(".tsx"))) {
  const s = read(p);
  const t = s.replace(/\/pdf`/g, "/document.pdf`");
  if (t !== s) write(p, t);
}

// 7. Plain <a href="/..."> are not basePath-aware: prefix them.
if (BASE_PATH) {
  for (const p of walk("src").filter((f) => /\.(tsx|ts)$/.test(f))) {
    const s = read(p);
    const t = s.replace(/(<a\s[^>]*?href=\{`)(\/)/g, `$1${BASE_PATH}$2`);
    if (t !== s) write(p, t);
  }
}

// 8. Static export config.
write(
  "next.config.ts",
  `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: ${JSON.stringify(BASE_PATH)},
  images: { unoptimized: true },
};

export default nextConfig;
`,
);

// 9. Build.
execSync("npx prisma generate", { stdio: "inherit" });
execSync("npx next build", { stdio: "inherit" });
write("out/.nojekyll", "");
if (existsSync("out/404/index.html")) cpSync("out/404/index.html", "out/404.html");
console.log("Static demo ready in ./out");
