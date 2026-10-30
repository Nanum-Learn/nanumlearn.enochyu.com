import { handle } from '../../src/comments/api.js';

export const onRequest = ({ request, env }) => handle(request, env);
