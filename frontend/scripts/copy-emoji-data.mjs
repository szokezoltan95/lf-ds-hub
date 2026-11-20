import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(projectRoot, "node_modules/emojibase-data");
const targetRoot = resolve(projectRoot, "public/emoji-data");

await rm(targetRoot, { recursive: true, force: true });
await mkdir(targetRoot, { recursive: true });

// Frimousse falls back to English for Slovak; Hungarian and Ukrainian are
// supported directly. Bundle the data locally so the picker works offline.
for (const locale of ["en", "hu", "uk"]) {
  await mkdir(resolve(targetRoot, locale), { recursive: true });
  await cp(resolve(sourceRoot, locale, "data.json"), resolve(targetRoot, locale, "data.json"));
  await cp(resolve(sourceRoot, locale, "messages.json"), resolve(targetRoot, locale, "messages.json"));
}
