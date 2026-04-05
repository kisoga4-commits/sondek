import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function getHtmlFiles() {
  return execSync("rg --files -g '*.html'", { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function isExternalHref(href) {
  return /^(https?:|mailto:|javascript:|#)/.test(href);
}

function getLocalTargets(htmlRelPath, htmlContent) {
  const hrefPattern = /href="([^"]+)"/g;
  const localTargets = [];
  let match = hrefPattern.exec(htmlContent);
  while (match) {
    const href = String(match[1] || '');
    const clean = href.split('#')[0].split('?')[0];
    if (clean && !isExternalHref(clean)) {
      const absoluteTarget = path.resolve(repoRoot, path.dirname(htmlRelPath), clean);
      localTargets.push({ href, absoluteTarget });
    }
    match = hrefPattern.exec(htmlContent);
  }
  return localTargets;
}

test('all local href links in html files point to existing files', () => {
  const missingLinks = [];
  const htmlFiles = getHtmlFiles();

  htmlFiles.forEach((relPath) => {
    const content = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    const targets = getLocalTargets(relPath, content);
    targets.forEach(({ href, absoluteTarget }) => {
      if (!fs.existsSync(absoluteTarget)) {
        missingLinks.push(`${relPath} -> ${href}`);
      }
    });
  });

  assert.deepEqual(missingLinks, []);
});
