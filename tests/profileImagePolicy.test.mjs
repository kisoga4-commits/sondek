import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProfileImageStoragePath,
  isAllowedProfileImageType,
  PROFILE_IMAGE_MAX_BYTES,
} from '../js/profileImagePolicy.js';

test('allows only jpg/png/webp mime types', () => {
  assert.equal(isAllowedProfileImageType('image/jpeg'), true);
  assert.equal(isAllowedProfileImageType('image/png'), true);
  assert.equal(isAllowedProfileImageType('image/webp'), true);
  assert.equal(isAllowedProfileImageType('image/gif'), false);
});

test('builds storage path using users/{userId}/profile/{timestamp}.jpg format', () => {
  const path = buildProfileImageStoragePath('uid-123', 1700000000000);
  assert.equal(path, 'users/uid-123/profile/1700000000000.jpg');
});

test('exports max bytes policy as 2MB', () => {
  assert.equal(PROFILE_IMAGE_MAX_BYTES, 2 * 1024 * 1024);
});
