// Validates realtime/realtime.asyncapi.yaml with the official AsyncAPI parser
// (including external $refs into bundled/openapi.v1.yaml). Run after `bundle`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Parser, fromFile } from '@asyncapi/parser';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'realtime', 'realtime.asyncapi.yaml');

const parser = new Parser();
const { document, diagnostics } = await fromFile(parser, file).parse({
  source: pathToFileURL(file).href,
});

const severityName = ['error', 'warning', 'info', 'hint'];
let errors = 0;
for (const d of diagnostics) {
  const sev = severityName[d.severity] ?? String(d.severity);
  if (d.severity === 0) errors++;
  if (d.severity <= 1) console.log(`${sev}: ${d.message} @ ${d.path?.join('.') ?? ''}`);
}
if (errors > 0 || !document) {
  console.error(`realtime.asyncapi.yaml: ${errors} error(s).`);
  process.exit(1);
}
// Sanity: the file must still be readable as UTF-8 YAML text.
readFileSync(file, 'utf8');
console.log(
  `realtime.asyncapi.yaml valid: ${document.channels().length} channels, ${document.messages().length} messages.`,
);
