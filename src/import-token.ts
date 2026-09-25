import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Set a stable secret when multiple API processes must accept each other's tokens.
const secret =
  process.env.IMPORT_TOKEN_SECRET ?? randomBytes(32).toString('hex');
const lifetimeMs = 24 * 60 * 60 * 1000;

export function issueImportToken(
  digest: string,
  owner: string,
  now = Date.now(),
) {
  const payload = Buffer.from(
    JSON.stringify({ digest, owner, expiresAt: now + lifetimeMs }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

export function verifyImportToken(
  token: string,
  owner: string,
  now = Date.now(),
) {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra || !/^[a-f0-9]{64}$/.test(signature))
    return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), expected)) return null;
  try {
    const data: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString(),
    );
    if (
      !data ||
      typeof data !== 'object' ||
      !('digest' in data) ||
      !('owner' in data) ||
      !('expiresAt' in data) ||
      typeof data.digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.digest) ||
      data.owner !== owner ||
      typeof data.expiresAt !== 'number' ||
      data.expiresAt <= now
    )
      return null;
    return data.digest;
  } catch {
    return null;
  }
}
