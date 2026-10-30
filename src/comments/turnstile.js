import { LIMITS } from './config.js';
import { Failure } from './failure.js';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const FAILED = 'The spam check failed. Please try again.';

export async function verifyTurnstile(env, token, ip, site) {
  if (typeof token !== 'string' || !token || token.length > LIMITS.tokenLength) {
    throw new Failure(403, 'turnstile_token', FAILED);
  }
  const response = await fetch(SITEVERIFY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
  });
  if (!response.ok) throw new Failure(503, 'turnstile_status');
  const result = await response.json();
  const hostname = new URL(site.origin).hostname;
  if (result.success !== true || result.hostname !== hostname || result.action !== 'comment') {
    throw new Failure(403, 'turnstile_rejected', FAILED);
  }
}
