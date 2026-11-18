#!/usr/bin/env node
/**
 * Regenerates the "## Resolution log" section of bug-audit-2026-08.md.
 *
 *   node docs/regen-resolution-log.mjs
 *
 * The per-finding entries are the source of truth; the table is a view over
 * their `Status:` / `Severity:` / `Phase:` fields and their section heading.
 * Run this after flipping any `Status:` line, rather than editing the table by
 * hand — a hand-maintained summary drifts from the thing it summarises, which
 * is the same class of defect this document exists to track.
 *
 * Idempotent: replaces the existing section if present, inserts it before
 * "## Automated baseline results" otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "bug-audit-2026-08.md",
);
let src = fs.readFileSync(docPath, "utf8");

// ── parse entries ─────────────────────────────────────────────────────────
// The doc is stored with CRLF endings, so split on both and drop the CR —
// otherwise every captured value carries a trailing \r and nothing matches.
const entries = {};
let section = null;
for (const line of src.split(/\r?\n/)) {
  const sec = /^# ([A-I]) — (.+)$/.exec(line);
  if (sec) section = sec[1];
  const hit = /^#### (BUG-\d{3}) — (.+)$/.exec(line);
  if (hit) entries[hit[1]] = { section, title: hit[2].trim() };
}
if (Object.keys(entries).length === 0) {
  throw new Error(
    "Parsed 0 findings — refusing to write an empty log. The entry heading " +
      "format probably changed; fix the parser before running again.",
  );
}
for (const [id, e] of Object.entries(entries)) {
  const block = src.split(`#### ${id} — `)[1].split(/\r?\n#### /)[0];
  for (const [field, key] of [["Severity", "sev"], ["Status", "status"], ["Phase", "phase"]]) {
    const m = new RegExp(`^- \\*\\*${field}:\\*\\* (.+)$`, "m").exec(block);
    e[key] = m ? m[1].trim() : "?";
  }
}

const all = Object.entries(entries);
const fixed = all.filter(([, e]) => e.status.startsWith("Fixed"));

// ── formatting helpers ────────────────────────────────────────────────────
// Titles contain things like `<RigidBody>` and `<Suspense>`; markdown renders
// bare angle brackets as HTML, so they have to stay inside code spans.
const title = (t) => {
  const plain = t.replace(/`/g, "");
  const clipped = plain.length <= 56 ? plain : plain.slice(0, 53).trimEnd() + "…";
  return clipped.replace(/(<[A-Za-z][\w.]*>)/g, "`$1`");
};
const how = (status) => {
  const m = /\(([^)]+)\)\s*$/.exec(status);
  if (m) return m[1];
  if (/moot/i.test(status)) return "moot — see Related";
  return "—";
};
const date = (status) => (/Fixed (\d{4}-\d{2}-\d{2})/.exec(status) ?? [, "—"])[1];
const bar = (f, t, w = 20) =>
  "█".repeat(t ? Math.round((w * f) / t) : 0).padEnd(w, "░");

// ── progress by phase ─────────────────────────────────────────────────────
const phases = {};
for (const [, e] of all) {
  const d = (phases[e.phase] ??= { total: 0, fixed: 0 });
  d.total++;
  if (e.status.startsWith("Fixed")) d.fixed++;
}
const progress = [
  "| Phase | Fixed | Total | Progress |",
  "|---|---:|---:|---|",
  ...Object.keys(phases).sort().map((p) => {
    const d = phases[p];
    return `| Phase ${p} | ${d.fixed} | ${d.total} | \`${bar(d.fixed, d.total)}\` ${d.fixed}/${d.total} |`;
  }),
  `| **All** | **${fixed.length}** | **${all.length}** | \`${bar(fixed.length, all.length)}\` ${Math.round((100 * fixed.length) / all.length)}% |`,
].join("\n");

const rows = fixed
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, e]) =>
    `| ${id} | ${title(e.title)} | ${e.sev} | §${e.section} | ${e.phase} | ${date(e.status)} | ${how(e.status)} |`,
  )
  .join("\n");

const openCritical = all
  .filter(([, e]) => e.sev === "Critical" && !e.status.startsWith("Fixed"))
  .map(([id]) => id)
  .sort();

const body = `## Resolution log

${fixed.length} of ${all.length} findings resolved. Regenerate this section with
\`node docs/regen-resolution-log.mjs\` after flipping any \`Status:\` line — it is
derived from the entries below, which are the source of truth. Nothing is ever
removed or renumbered; see [Marking findings fixed](#marking-findings-fixed).

${progress}

${openCritical.length ? `**Critical still open (${openCritical.length}):** ${openCritical.join(", ")}.` : "**No Critical findings remain open.**"}

### Resolved

| ID | Finding | Severity | § | Phase | Fixed | How |
|---|---|---|---|---:|---|---|
${rows}

`;

const marker = "## Resolution log";
const nextHeading = "## Automated baseline results";
if (src.includes(marker)) {
  const start = src.indexOf(marker);
  const end = src.indexOf(nextHeading, start);
  if (end === -1) throw new Error(`Could not find "${nextHeading}" after the log`);
  src = src.slice(0, start) + body + src.slice(end);
} else {
  src = src.replace(nextHeading, body + nextHeading);
}
fs.writeFileSync(docPath, src);
console.log(
  `Resolution log regenerated: ${fixed.length}/${all.length} resolved, ` +
    `${openCritical.length} Critical still open.`,
);
