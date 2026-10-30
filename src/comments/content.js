import { LIMITS } from './config.js';
import { Failure } from './failure.js';

const MARK = '<!--nanum-comment:1-->';
const BODY = /^<!--nanum-comment:1-->\n(`{3,})text\n(.+)\n([\s\S]+)\n\1$/;
const NAME = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .'_-]*$/u;
const INVISIBLE = /(?![\n\u200d])[\p{Cc}\p{Cf}\p{Cs}\p{Co}\u115f\u1160\u3164\uffa0]/gu;
const VISIBLE = /[\p{L}\p{N}\p{S}\p{P}]/u;
const LINK = /https?:\/\/|www\./gi;
const SHIELD = '\u200b';

const reject = message => new Failure(400, 'invalid_content', message);

function clean(value) {
  return value
    .normalize('NFC')
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(INVISIBLE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseName(value, site) {
  if (value === undefined || value === null || value === '') return 'Anonymous';
  if (typeof value !== 'string') throw reject('Invalid name.');
  const name = clean(value).replace(/\s+/g, ' ');
  if (!name) return 'Anonymous';
  if (name.length > LIMITS.name || !NAME.test(name)) {
    throw reject('Names can use letters, numbers, spaces, and . \' _ - up to 40 characters.');
  }
  const flat = name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (site.reserved.some(word => flat.includes(word))) throw reject('That name is reserved.');
  return name;
}

export function parseText(value) {
  if (typeof value !== 'string') throw reject('Write a comment first.');
  const text = clean(value);
  if (text.length < 2 || !VISIBLE.test(text)) throw reject('Write a comment first.');
  if (text.length > LIMITS.text) throw reject('Comments can be up to 2000 characters.');
  if ((text.match(LINK) ?? []).length > LIMITS.links) throw reject('Comments can include up to 2 links.');
  if (/(.)\1{29,}/su.test(text) || /\p{M}{6,}/u.test(text)) {
    throw reject('This comment looks like spam.');
  }
  return text;
}

export function encodeBody(name, text) {
  const shielded = text.replace(/[@#]/g, `$&${SHIELD}`);
  const longest = Math.max(0, ...(shielded.match(/`+/g) ?? []).map(run => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${MARK}\n${fence}text\n${name}\n${shielded}\n${fence}`;
}

export function decodeBody(body) {
  if (typeof body !== 'string') return null;
  const match = body.replace(/\r\n?/g, '\n').match(BODY);
  if (!match || !NAME.test(match[2])) return null;
  return { name: match[2], text: match[3].replaceAll(SHIELD, '') };
}

export function normalizedText(text) {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
}
