import { LIMITS } from './config.js';
import { Failure } from './failure.js';

const READ = { type: 'json', cacheTtl: 30 };
const TTL = { expirationTtl: 7200 };
const SLOW_DOWN = 'You are commenting too quickly. Please try again later.';
const BUSY = 'Comments are busy right now. Please try again later.';

export function network(ip) {
  if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1);
  const [head, tail = ''] = ip.split('::');
  const front = head ? head.split(':') : [];
  const back = tail ? tail.split(':') : [];
  const gap = Math.max(0, 8 - front.length - back.length);
  return [...front, ...Array(gap).fill('0'), ...back]
    .slice(0, 4)
    .map(group => parseInt(group, 16).toString(16))
    .join(':');
}

async function ipKey(env, ip, hour) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.RATE_LIMIT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(network(ip)));
  const hex = [...new Uint8Array(digest).slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `ip:${hex}:${hour}`;
}

export async function assertNotPaused(env) {
  if (await env.COMMENTS_KV.get('paused')) throw new Failure(503, 'paused');
}

export async function checkLimit(env, ip) {
  await assertNotPaused(env);
  const now = Date.now();
  const hour = Math.floor(now / 3600000);
  const own = await ipKey(env, ip, hour);
  const all = `all:${hour}`;
  const [mine, total] = await Promise.all([env.COMMENTS_KV.get(own, READ), env.COMMENTS_KV.get(all, READ)]);
  if (mine && now - mine.last < LIMITS.ipGapSeconds * 1000) throw new Failure(429, 'ip_gap', SLOW_DOWN);
  if ((mine?.count ?? 0) >= LIMITS.ipPerHour) throw new Failure(429, 'ip_hour', SLOW_DOWN);
  if ((total?.count ?? 0) >= LIMITS.allPerHour) throw new Failure(429, 'all_hour', BUSY);
  return { own, all, now, mine: mine?.count ?? 0, total: total?.count ?? 0 };
}

export async function recordPost(env, state) {
  await Promise.all([
    env.COMMENTS_KV.put(state.own, JSON.stringify({ count: state.mine + 1, last: state.now }), TTL),
    env.COMMENTS_KV.put(state.all, JSON.stringify({ count: state.total + 1 }), TTL),
  ]);
}
