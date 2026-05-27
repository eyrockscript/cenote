#!/usr/bin/env node
/**
 * Genera la familia completa de favicons + PWA icons desde mark.svg.
 *
 * Uso (requiere `sharp`):
 *   pnpm dlx sharp-cli --help  # verificar instalación
 *   node scripts/generate-favicons.js
 *
 * Outputs en web/public/:
 *   - favicon-16.png, favicon-32.png
 *   - apple-touch-icon.png (180×180, sin transparencia, fondo ink-50)
 *   - android-chrome-192.png, android-chrome-512.png
 *   - og-image.png (1200×630)
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PUBLIC = join(ROOT, "web", "public");
const MARK = join(PUBLIC, "brand", "mark.svg");
const MARK_LIGHT = join(PUBLIC, "brand", "mark-light.svg");

await mkdir(PUBLIC, { recursive: true });

const sizes = [
  { name: "favicon-16.png", size: 16, src: MARK },
  { name: "favicon-32.png", size: 32, src: MARK },
  { name: "android-chrome-192.png", size: 192, src: MARK },
  { name: "android-chrome-512.png", size: 512, src: MARK },
];

for (const { name, size, src } of sizes) {
  await sharp(src).resize(size, size).png().toFile(join(PUBLIC, name));
  console.log(`generated ${name} (${size}×${size})`);
}

// apple-touch-icon: 180x180 sin transparencia (iOS requirement)
await sharp(MARK_LIGHT)
  .resize(180, 180)
  .flatten({ background: "#fafafa" })
  .png()
  .toFile(join(PUBLIC, "apple-touch-icon.png"));
console.log("generated apple-touch-icon.png (180×180)");

// OG image — composed with logo offset left
const ogSvg = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f9fafb"/>
  <rect x="80" y="80" width="1040" height="470" rx="40" fill="#ffffff" stroke="#e2e8f0"/>
  <g transform="translate(140, 200)">
    <rect width="120" height="120" rx="26" fill="#0a0a0a"/>
    <g transform="translate(0,0) scale(1.875)">
      <circle cx="32" cy="32" r="17" stroke="#fafafa" stroke-width="2" fill="none"/>
      <circle cx="33.2" cy="33" r="11" stroke="#fafafa" stroke-width="1.4" fill="none" opacity="0.55"/>
      <circle cx="46" cy="20" r="3" fill="#ef4444"/>
    </g>
    <text x="160" y="56" font-family="Geist, system-ui, sans-serif" font-size="56" font-weight="600" fill="#0a0a0a" letter-spacing="-1.5">Cenote</text>
    <text x="160" y="100" font-family="Geist Mono, monospace" font-size="18" fill="#737373" letter-spacing="0.5">drift detection · diff viewer · authorship</text>
  </g>
  <text x="140" y="500" font-family="Geist, system-ui, sans-serif" font-size="20" fill="#0a0a0a">AWS + Terraform unified graph</text>
  <text x="140" y="528" font-family="Geist Mono, monospace" font-size="14" fill="#737373">self-hosted · read-only · $0 in AWS</text>
</svg>`);

await sharp(ogSvg).png().toFile(join(PUBLIC, "og-image.png"));
console.log("generated og-image.png (1200×630)");
