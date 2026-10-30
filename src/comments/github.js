import { GITHUB, LEADERSHIP, LIMITS } from './config.js';
import { decodeBody } from './content.js';
import { Failure } from './failure.js';

const API = 'https://api.github.com';
const HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'nanum-comments' };
const COMMENT = 'id createdAt isMinimized body author { __typename login ... on User { databaseId } }';

export const QUERIES = {
  repository: `query($owner: String!, $repo: String!, $category: String!) {
    repository(owner: $owner, name: $repo) { id discussionCategory(slug: $category) { id } }
  }`,
  discussions: `query($owner: String!, $repo: String!, $category: ID!, $after: String) {
    repository(owner: $owner, name: $repo) {
      discussions(first: 100, after: $after, categoryId: $category, orderBy: { field: CREATED_AT, direction: ASC }) {
        pageInfo { hasNextPage endCursor }
        nodes { id number title locked author { __typename login } }
      }
    }
  }`,
  comments: `query($id: ID!, $after: String) {
    node(id: $id) {
      ... on Discussion {
        comments(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ${COMMENT} replies(first: 100) { nodes { ${COMMENT} } } }
        }
      }
    }
  }`,
  createDiscussion: `mutation($input: CreateDiscussionInput!) {
    createDiscussion(input: $input) { discussion { id author { __typename login } } }
  }`,
  deleteDiscussion: `mutation($input: DeleteDiscussionInput!) {
    deleteDiscussion(input: $input) { clientMutationId }
  }`,
  addComment: `mutation($input: AddDiscussionCommentInput!) {
    addDiscussionComment(input: $input) { comment { id createdAt } }
  }`,
};

const tokens = new Map();
const apps = new Map();
const repositories = new Map();

const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');
const encodeJson = value => base64url(new TextEncoder().encode(JSON.stringify(value)));

async function signJwt(env) {
  const pem = env.GITHUB_APP_PRIVATE_KEY;
  if (!pem.includes('BEGIN PRIVATE KEY')) throw new Failure(503, 'key_format');
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\\n|\s/g, '')), char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const head = encodeJson({ alg: 'RS256', typ: 'JWT' });
  const claims = encodeJson({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_CLIENT_ID });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${base64url(signature)}`;
}

async function call(path, auth, body) {
  const response = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...HEADERS, Authorization: `Bearer ${auth}`, ...(body && { 'Content-Type': 'application/json' }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  if (response.status === 403 || response.status === 429) {
    const wait = Number(response.headers.get('Retry-After')) || 0;
    throw new Failure(503, `github_${response.status}`, undefined, Math.max(wait, LIMITS.pauseSeconds));
  }
  if (!response.ok) throw new Failure(503, `github_${response.status}`);
  return response.json();
}

async function token(env, level) {
  const key = `${env.GITHUB_APP_INSTALLATION_ID}:${level}`;
  const cached = tokens.get(key);
  if (cached && cached.expires > Date.now() + 300000) return cached.value;
  const granted = await call(`/app/installations/${env.GITHUB_APP_INSTALLATION_ID}/access_tokens`, await signJwt(env), {
    repositories: [GITHUB.repo],
    permissions: { discussions: level, metadata: 'read' },
  });
  if (typeof granted.token !== 'string' || !granted.token) throw new Failure(503, 'github_token');
  tokens.set(key, { value: granted.token, expires: Date.parse(granted.expires_at) });
  return granted.token;
}

async function appSlug(env) {
  const key = env.GITHUB_APP_INSTALLATION_ID;
  if (!apps.has(key)) {
    const app = await call('/app', await signJwt(env));
    if (typeof app.slug !== 'string' || !app.slug) throw new Failure(503, 'github_app');
    apps.set(key, app.slug);
  }
  return apps.get(key);
}

async function graphql(env, level, query, variables) {
  const result = await call('/graphql', await token(env, level), { query, variables });
  if (result.errors?.some(error => error.type === 'RATE_LIMITED')) {
    throw new Failure(503, 'github_limited', undefined, LIMITS.pauseSeconds);
  }
  if (result.errors?.length || !result.data) {
    const [first] = result.errors ?? [];
    throw new Failure(503, `github_graphql:${first?.type ?? 'none'}:${first?.path?.join('.') ?? ''}`);
  }
  return result.data;
}

async function repository(env) {
  const key = env.GITHUB_APP_INSTALLATION_ID;
  if (!repositories.has(key)) {
    const data = await graphql(env, 'read', QUERIES.repository, {
      owner: GITHUB.owner,
      repo: GITHUB.repo,
      category: GITHUB.category,
    });
    const id = data.repository?.id;
    const category = data.repository?.discussionCategory?.id;
    if (!id || !category) throw new Failure(503, 'github_repository');
    repositories.set(key, { id, category });
  }
  return repositories.get(key);
}

const byApp = (author, slug) => author?.__typename === 'Bot' && author.login.replace(/\[bot\]$/, '') === slug;

async function listDiscussions(env, level, title) {
  const [slug, repo] = await Promise.all([appSlug(env), repository(env)]);
  const found = [];
  let after = null;
  for (let page = 0; page < LIMITS.discussionPages; page++) {
    const data = await graphql(env, level, QUERIES.discussions, {
      owner: GITHUB.owner,
      repo: GITHUB.repo,
      category: repo.category,
      after,
    });
    const { nodes, pageInfo } = data.repository.discussions;
    found.push(...nodes.filter(node => node.title === title && byApp(node.author, slug)));
    if (!pageInfo.hasNextPage) return found;
    after = pageInfo.endCursor;
  }
  throw new Failure(503, 'github_too_many_discussions');
}

export async function findDiscussion(env, level, title) {
  return (await listDiscussions(env, level, title))[0] ?? null;
}

export async function createDiscussion(env, title, body) {
  const repo = await repository(env);
  const slug = await appSlug(env);
  const data = await graphql(env, 'write', QUERIES.createDiscussion, {
    input: { repositoryId: repo.id, categoryId: repo.category, title, body },
  });
  const created = data.createDiscussion.discussion;
  if (!byApp(created.author, slug)) {
    await graphql(env, 'write', QUERIES.deleteDiscussion, { input: { id: created.id } });
    throw new Failure(503, 'github_author');
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
  const winner = await findDiscussion(env, 'write', title);
  if (!winner) throw new Failure(503, 'github_lookup');
  if (winner.id !== created.id) {
    await graphql(env, 'write', QUERIES.deleteDiscussion, { input: { id: created.id } });
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return winner;
}

function toComment(node, slug) {
  if (node.isMinimized) return null;
  if (node.author?.__typename === 'User' && LEADERSHIP.has(node.author.databaseId)) {
    const text = node.body.trim();
    return text && {
      id: node.id,
      createdAt: node.createdAt,
      name: LEADERSHIP.get(node.author.databaseId),
      text,
      verified: true,
    };
  }
  if (!byApp(node.author, slug)) return null;
  const decoded = decodeBody(node.body);
  return decoded && { id: node.id, createdAt: node.createdAt, ...decoded };
}

const byDate = (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt);

export async function readComments(env, level, discussionId) {
  const slug = await appSlug(env);
  const comments = [];
  let after = null;
  for (let page = 0; page < LIMITS.commentPages; page++) {
    const data = await graphql(env, level, QUERIES.comments, { id: discussionId, after });
    if (!data.node?.comments) throw new Failure(503, 'github_lookup');
    const { nodes, pageInfo } = data.node.comments;
    for (const node of nodes) {
      const comment = toComment(node, slug);
      if (!comment) continue;
      const replies = node.replies.nodes.map(reply => toComment(reply, slug)).filter(Boolean).sort(byDate);
      comments.push({ ...comment, replies });
    }
    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor;
  }
  return comments.sort(byDate);
}

export async function addComment(env, discussionId, replyToId, body) {
  const data = await graphql(env, 'write', QUERIES.addComment, {
    input: { discussionId, body, ...(replyToId && { replyToId }) },
  });
  return data.addDiscussionComment.comment;
}
