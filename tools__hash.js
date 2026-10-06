// PBKDF2-SHA256 (100 000 iterations, 256-bit) — identical to js__core__auth.js hashPassword().
import { pbkdf2Sync, randomBytes } from 'node:crypto';
export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = pbkdf2Sync(String(password), Buffer.from(salt, 'utf8'), 100000, 32, 'sha256').toString('hex');
  return { hash, salt };
}
if (process.argv[1] && process.argv[1].endsWith('hash.js') && process.argv[2]) console.log(hashPassword(process.argv[2]));
