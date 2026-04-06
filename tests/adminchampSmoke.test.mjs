import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd());

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

test('adminchamp page keeps critical management controls and script wiring', () => {
  const html = read('adminchamp.html');

  const requiredSnippets = [
    'id="openFeedbackEditorBtn"',
    'id="quizLibrary"',
    'id="courseOfferForm"',
    'id="saveCourseOfferBtn"',
    'href="template.html"',
    'src="js/adminchamp.js"',
  ];

  requiredSnippets.forEach((snippet) => {
    assert.equal(
      html.includes(snippet),
      true,
      `Expected adminchamp.html to include: ${snippet}`,
    );
  });
});

test('legacy indexchamp file is removed to keep single admin entrypoint', () => {
  const legacyPath = path.join(repoRoot, 'indexchamp.html');
  assert.equal(fs.existsSync(legacyPath), false);
});
