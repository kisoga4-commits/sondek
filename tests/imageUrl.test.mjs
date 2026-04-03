import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePublicImageUrl, optimizePublicImageUrl } from '../js/imageUrl.js';

test('converts Google Drive /file/d/{id}/view links to direct-view URLs', () => {
  const input = 'https://drive.google.com/file/d/1AojH-CQCRD9YPSeShIps5P4-0woH4gCT/view?usp=drive_link';
  const output = normalizePublicImageUrl(input);

  assert.equal(output, 'https://drive.google.com/uc?export=view&id=1AojH-CQCRD9YPSeShIps5P4-0woH4gCT');
});

test('converts Google Drive open?id= links to direct-view URLs', () => {
  const input = 'https://drive.google.com/open?id=abcXYZ123';
  const output = normalizePublicImageUrl(input);

  assert.equal(output, 'https://drive.google.com/uc?export=view&id=abcXYZ123');
});

test('optimizes Google Drive links using thumbnail endpoint with max width', () => {
  const input = 'https://drive.google.com/file/d/abcXYZ123/view?usp=drive_link';
  const output = optimizePublicImageUrl(input, { maxWidth: 720 });

  assert.equal(output, 'https://drive.google.com/thumbnail?id=abcXYZ123&sz=w720');
});

test('keeps non-Google-Drive URLs unchanged when normalizing', () => {
  const input = 'https://example.com/images/photo.jpg';
  const output = normalizePublicImageUrl(input);

  assert.equal(output, input);
});

test('optimizes Unsplash URLs by adding resize and crop params', () => {
  const input = 'https://images.unsplash.com/photo-123?foo=bar';
  const output = optimizePublicImageUrl(input, { maxWidth: 500 });

  assert.equal(output, 'https://images.unsplash.com/photo-123?auto=format&fit=crop&w=500&q=70');
});
