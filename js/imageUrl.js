function extractGoogleDriveFileId(url) {
  const filePathMatch = url.pathname.match(/^\/file\/d\/([^/]+)/i);
  if (filePathMatch?.[1]) return filePathMatch[1];

  const openId = url.searchParams.get('id');
  if (openId) return openId;


  return '';
}

function parseUrl(rawUrl) {
  const input = String(rawUrl || '').trim();
  if (!input) return { input: '', parsed: null };

  try {
    return { input, parsed: new URL(input) };
  } catch {
    return { input, parsed: null };
  }
}

export function normalizePublicImageUrl(rawUrl) {
  const { input, parsed } = parseUrl(rawUrl);
  if (!input || !parsed) return input;

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== 'drive.google.com') {
    return input;
  }

  const fileId = extractGoogleDriveFileId(parsed);
  if (!fileId) {
    return input;
  }

  return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`;
}

export function optimizePublicImageUrl(rawUrl, options = {}) {
  const { input, parsed } = parseUrl(rawUrl);
  if (!input || !parsed) return input;

  const maxWidth = Math.max(120, Math.min(2000, Number(options.maxWidth) || 800));
  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'drive.google.com') {
    const fileId = extractGoogleDriveFileId(parsed);
    if (fileId) {
      return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${maxWidth}`;
    }
  }

  if (input.includes('images.unsplash.com')) {
    const [base] = input.split('?');
    return `${base}?auto=format&fit=crop&w=${maxWidth}&q=70`;
  }

  return normalizePublicImageUrl(input);
}
