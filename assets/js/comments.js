(() => {
  const root = document.getElementById('comments');
  if (!root) return;

  const { api, site, path, sitekey } = root.dataset;
  const TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  const UNAVAILABLE = 'Comments are unavailable right now.';
  const dates = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' });

  let comments = [];
  let replyTo = null;
  let token = '';
  let widget = null;
  let loadingWidget = false;

  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  const status = el('p', { className: 'comments-note', role: 'status' }, 'Loading comments…');
  const list = el('ol', { className: 'comment-list' });
  const replying = el('p', { className: 'comment-replying', hidden: true });
  const name = el('input', { id: 'comment-name', name: 'name', maxLength: 40, autocomplete: 'nickname', placeholder: '' });
  const text = el('textarea', { id: 'comment-text', name: 'text', maxLength: 2000, rows: 4, required: true });
  const trap = el('input', { name: 'website', tabIndex: -1, autocomplete: 'off' });
  const check = el('div', { className: 'comment-check' });
  const submit = el('button', { className: 'btn', type: 'submit' }, 'Post comment');
  const cancel = el('button', { className: 'comment-action', type: 'button', hidden: true }, 'Cancel reply');
  const formStatus = el('p', { className: 'comments-note', role: 'status' });
  const form = el('form', { className: 'comment-form', hidden: true },
    replying,
    el('label', { htmlFor: 'comment-name' }, 'Name (optional)'),
    name,
    el('label', { htmlFor: 'comment-text' }, 'Comment'),
    text,
    el('div', { className: 'comment-trap', ariaHidden: 'true' }, trap),
    check,
    el('div', { className: 'comment-actions' }, submit, cancel),
    formStatus,
    el('p', { className: 'comments-note' }, ''),
  );
  root.append(status, list, form);

  const startReply = comment => {
    replyTo = comment.id;
    replying.textContent = `Replying to ${comment.name}`;
    replying.hidden = false;
    cancel.hidden = false;
    text.focus();
  };

  const endReply = () => {
    replyTo = null;
    replying.hidden = true;
    cancel.hidden = true;
  };

  const renderComment = (comment, locked, nested) => {
    const time = el('time', { dateTime: comment.createdAt }, dates.format(new Date(comment.createdAt)));
    const author = el('strong', {}, comment.name);
    const mark = comment.verified === true
      ? [' ', el('span', { className: 'comment-verified', title: 'Verified leadership, signed in through GitHub' }, '✓ Verified')]
      : [];
    const item = el('li', { className: 'comment' },
      el('p', { className: 'comment-meta' }, author, ...mark, ' · ', time),
      el('p', { className: 'comment-text' }, comment.text),
    );
    if (nested) return item;
    if (!locked) {
      const reply = el('button', { className: 'comment-action', type: 'button' }, 'Reply');
      reply.addEventListener('click', () => startReply(comment));
      item.append(reply);
    }
    if (comment.replies.length) {
      item.append(el('ol', { className: 'comment-list comment-replies' },
        ...comment.replies.map(child => renderComment(child, locked, true))));
    }
    return item;
  };

  const render = locked => {
    list.replaceChildren(...comments.map(comment => renderComment(comment, locked, false)));
    status.textContent = comments.length ? '' : 'No comments yet.';
    status.hidden = !status.textContent;
  };

  const showCheck = () => {
    if (widget !== null || loadingWidget) return;
    loadingWidget = true;
    const script = el('script', { src: TURNSTILE });
    script.addEventListener('load', () => {
      widget = window.turnstile.render(check, {
        sitekey,
        action: 'comment',
        callback: value => { token = value; },
        'expired-callback': () => { token = ''; },
        'error-callback': () => {
          token = '';
          formStatus.textContent = 'The spam check could not load. Please try again.';
          return true;
        },
      });
    });
    script.addEventListener('error', () => {
      loadingWidget = false;
      formStatus.textContent = 'The spam check could not load. Please try again.';
    });
    document.head.append(script);
  };

  const resetCheck = () => {
    token = '';
    if (widget !== null) window.turnstile.reset(widget);
  };

  const addComment = (comment, parent) => {
    const owner = parent && comments.find(item => item.id === parent);
    if (owner) owner.replies.push(comment);
    else comments.push(comment);
    render(false);
  };

  form.addEventListener('focusin', showCheck);
  cancel.addEventListener('click', endReply);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!token) {
      showCheck();
      formStatus.textContent = 'Please complete the spam check first.';
      return;
    }
    submit.disabled = true;
    formStatus.textContent = 'Posting…';
    try {
      const response = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, name: name.value, text: text.value, replyTo, token, website: trap.value }),
      });
      const data = await response.json();
      if (response.ok) {
        addComment(data.comment, data.replyTo);
        text.value = '';
        endReply();
        formStatus.textContent = 'Posted.';
      } else {
        formStatus.textContent = data.error || UNAVAILABLE;
      }
    } catch {
      formStatus.textContent = UNAVAILABLE;
    } finally {
      submit.disabled = false;
      resetCheck();
    }
  });

  const load = async () => {
    try {
      const query = new URLSearchParams({ site, path });
      const response = await fetch(`${api}?${query}`);
      if (!response.ok) throw new Error();
      const data = await response.json();
      comments = data.comments;
      render(data.locked);
      if (data.locked) {
        status.textContent = 'Comments are closed on this page.';
        status.hidden = false;
      } else {
        form.hidden = false;
      }
    } catch {
      status.textContent = UNAVAILABLE;
    }
  };

  load();
})();
