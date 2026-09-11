/**
 * Dumps the i18next linter findings as JSON on stdout.
 *
 * `scripts/i18n-hardcoded-check.mjs` reads this and compares it against the
 * reviewed baseline of strings that are deliberately not translated. Keeping
 * the linter call on this side of the workspace boundary keeps `i18next-cli`
 * and the TypeScript config resolvable.
 */
import { runLinter } from 'i18next-cli';
import config from '../i18next.config.ts';

const result = await runLinter(config);
const root = process.cwd();
const findings: {
  file: string;
  line: number;
  type: string;
  severity: string;
  text: string;
}[] = [];

for (const [file, issues] of Object.entries(result.files)) {
  for (const issue of issues) {
    findings.push({
      file: file.startsWith(root) ? file.slice(root.length + 1) : file,
      line: issue.line,
      type: issue.type ?? 'hardcoded',
      severity: issue.severity ?? 'error',
      text: issue.text,
    });
  }
}

process.stdout.write(JSON.stringify(findings));
