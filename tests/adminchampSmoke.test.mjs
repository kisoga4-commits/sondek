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

test('indexchamp route redirects to adminchamp route', () => {
  const html = read('indexchamp.html');
  assert.equal(html.includes('url=adminchamp.html'), true);
  assert.equal(html.includes("window.location.replace('adminchamp.html')"), true);
});
