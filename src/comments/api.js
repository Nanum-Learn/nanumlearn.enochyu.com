import { GITHUB, LIMITS, SITES } from './config.js';
import { encodeBody, normalizedText, parseName, parseText } from './content.js';
import { Failure } from './failure.js';
import { addComment, createDiscussion, findDiscussion, readComments } from './github.js';
import { assertNotPaused, checkLimit, recordPost } from './limit.js';
import { verifyTurnstile } from './turnstile.js';

const PATH = /^\/[A-Za-z0-9/_.-]*$/;
const NODE_ID = /^[A-Za-z0-9_=-]{1,128}$/;
const READ_ENV = ['GITHUB_APP_CLIENT_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY', 'COMMENTS_KV'];
const WRITE_ENV = [...READ_ENV, 'TURNSTILE_SECRET_KEY', 'RATE_LIMIT_SECRET'];

const siteForOrigin = origin => [...SITES.entries()].find(([, site]) => site.origin === origin);

function requireEnv(env, names) {
  if (names.some(name => !env[name])) throw new Failure(503, 'missing_config');
}

function headers(allowed, cacheControl = 'no-store') {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cacheControl,
    Vary: 'Origin',
    ...(allowed && {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    }),
  };
}

function parsePath(value) {
  if (typeof value !== 'string' || value.length > LIMITS.pathLength || !PATH.test(value)) {
    throw new Failure(404, 'bad_path', 'Unknown page.');
  }
  return value;
}

async function assertThread(request, env, site, path) {
  const sameProject = new URL(request.url).origin === site.origin && env.ASSETS;
  const url = new URL(site.threads, site.origin);
  const response = sameProject
    ? await env.ASSETS.fetch(url)
    : await fetch(url, { cf: { cacheTtl: LIMITS.manifestCacheSeconds, cacheEverything: true } });
  if (!response.ok) throw new Failure(503, 'manifest_status');
  const threads = await response.json();
  if (!Array.isArray(threads)) throw new Failure(503, 'manifest_format');
  if (!threads.includes(path)) throw new Failure(404, 'unknown_thread', 'Unknown page.');
}

async function readBody(request) {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > LIMITS.bodyBytes) throw new Failure(413, 'body_size', 'Comment is too long.');
  if (!request.body) throw new Failure(400, 'bad_json', 'Invalid request.');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LIMITS.bodyBytes) {
      await reader.cancel();
      throw new Failure(413, 'body_size', 'Comment is too long.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  chunks.reduce((offset, chunk) => (bytes.set(chunk, offset), offset + chunk.byteLength), 0);
  try {
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    return input;
  } catch {
    throw new Failure(400, 'bad_json', 'Invalid request.');
  }
}

function parseReplyTo(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !NODE_ID.test(value)) throw new Failure(404, 'bad_reply', 'Comment not found.');
  return value;
}

function cacheKey(url, siteKey, path) {
  const key = new URL('/api/comments', url.origin);
  key.searchParams.set('site', siteKey);
  key.searchParams.set('path', path);
  return new Request(key);
}

async function get(request, env, url, allowed) {
  const siteKey = url.searchParams.get('site');
  const site = SITES.get(siteKey);
  if (!site) throw new Failure(404, 'unknown_site', 'Unknown site.');
  const origin = request.headers.get('Origin');
  if (origin && origin !== site.origin) throw new Failure(403, 'origin', 'Origin not allowed.');
  requireEnv(env, READ_ENV);
  const path = parsePath(url.searchParams.get('path'));
  const key = cacheKey(url, siteKey, path);
  const cached = await caches.default.match(key);
  if (cached) return new Response(await cached.text(), { headers: headers(allowed) });
  await assertThread(request, env, site, path);
  await assertNotPaused(env);
  const discussion = await findDiscussion(env, 'read', `${siteKey}:${path}`);
  const payload = JSON.stringify(discussion
    ? {
        locked: discussion.locked,
        url: `https://github.com/${GITHUB.owner}/${GITHUB.repo}/discussions/${discussion.number}`,
        comments: await readComments(env, 'read', discussion.id),
      }
    : { locked: false, comments: [] });
  await caches.default.put(key, new Response(payload, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${LIMITS.readCacheSeconds}` },
  }));
  return new Response(payload, { headers: headers(allowed) });
}

function assertReply(replyTo, comments) {
  if (replyTo && !comments.some(comment => comment.id === replyTo)) {
    throw new Failure(404, 'unknown_reply', 'Comment not found.');
  }
}

function assertNotDuplicate(text, comments) {
  const incoming = normalizedText(text);
  const existing = comments.flatMap(comment => [comment, ...comment.replies]);
  if (existing.some(comment => normalizedText(comment.text) === incoming)) {
    throw new Failure(409, 'duplicate', 'This comment has already been posted.');
  }
}

async function post(request, env, url, origin, match) {
  if (!match) throw new Failure(403, 'origin', 'Origin not allowed.');
  const [siteKey, site] = match;
  requireEnv(env, WRITE_ENV);
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new Failure(415, 'content_type', 'Invalid request.');
  }
  const input = await readBody(request);
  if (input.website) throw new Failure(400, 'honeypot', 'Comment rejected.');
  const path = parsePath(input.path);
  const name = parseName(input.name, site);
  const text = parseText(input.text);
  const replyTo = parseReplyTo(input.replyTo);
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) throw new Failure(403, 'no_ip', 'Request not allowed.');
  await assertThread(request, env, site, path);
  const state = await checkLimit(env, ip);
  await verifyTurnstile(env, input.token, ip, site);
  await recordPost(env, state);

  const title = `${siteKey}:${path}`;
  let discussion = await findDiscussion(env, 'write', title);
  if (discussion?.locked) throw new Failure(403, 'locked', 'Comments are closed on this page.');
  const comments = discussion ? await readComments(env, 'write', discussion.id) : [];
  assertReply(replyTo, comments);
  assertNotDuplicate(text, comments);
  discussion ??= await createDiscussion(env, title, `Comments for ${site.origin}${path}`);
  const created = await addComment(env, discussion.id, replyTo, encodeBody(name, text));
  await caches.default.delete(cacheKey(url, siteKey, path));
  const comment = { id: created.id, createdAt: created.createdAt, name, text, replies: [] };
  return new Response(JSON.stringify({ comment, replyTo }), { status: 201, headers: headers(origin) });
}

export async function handle(request, env) {
  const origin = request.headers.get('Origin');
  const match = siteForOrigin(origin);
  const allowed = match ? origin : null;
  try {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: allowed ? 204 : 403, headers: headers(allowed) });
    }
    if (request.method === 'GET') return await get(request, env, url, allowed);
    if (request.method === 'POST') return await post(request, env, url, origin, match);
    throw new Failure(405, 'method', 'Method not allowed.');
  } catch (error) {
    const failure = error instanceof Failure ? error : new Failure(503, 'unexpected');
    if (failure.pause) await env.COMMENTS_KV.put('paused', '1', { expirationTtl: failure.pause }).catch(() => {});
    if (failure.status >= 500) console.error(JSON.stringify({ event: 'comments_failure', code: failure.code }));
    return new Response(JSON.stringify({ error: failure.publicMessage }), {
      status: failure.status,
      headers: headers(allowed),
    });
  }
}
