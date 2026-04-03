export const PROFILE_IMAGE_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PROFILE_IMAGE_MAX_DIMENSION = 1024;
export const PROFILE_IMAGE_QUALITY = 0.8;

export function isAllowedProfileImageType(mimeType) {
  const normalized = String(mimeType || '').toLowerCase().trim();
  return PROFILE_IMAGE_ALLOWED_TYPES.includes(normalized);
}

export function validateProfileImageConstraints(file) {
  if (!(file instanceof File)) {
    throw new Error('กรุณาเลือกไฟล์รูปภาพก่อนอัปโหลด');
  }

  if (!isAllowedProfileImageType(file.type)) {
    throw new Error('รองรับเฉพาะไฟล์ JPG, PNG หรือ WEBP เท่านั้น');
  }

  if (Number(file.size || 0) > PROFILE_IMAGE_MAX_BYTES) {
    throw new Error('ขนาดไฟล์เกิน 2MB กรุณาเลือกรูปที่เล็กลง');
  }
}

export function buildProfileImageStoragePath(userId, timestampMs = Date.now()) {
  const safeUserId = String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `users/${safeUserId}/profile/${timestampMs}.jpg`;
}
