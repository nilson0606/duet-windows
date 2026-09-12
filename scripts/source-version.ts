import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function sourceVersion() {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const options = { cwd, encoding: 'utf8' as const, windowsHide: true };
  const commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], options).trim();
  const modified = execFileSync('git', ['status', '--porcelain'], options).trim();
  return `${commit}${modified ? '（未提交）' : ''}`;
}
