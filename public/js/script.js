const nav = document.querySelector('.nav');
const navToggle = document.querySelector('.nav-toggle');

navToggle.addEventListener('click', () => {
  navToggle.setAttribute('aria-expanded', nav.classList.toggle('open'));
});

document.addEventListener('click', e => {
  if (!nav.contains(e.target)) {
    nav.classList.remove('open');
    navToggle.setAttribute('aria-expanded', false);
  }
});

new ResizeObserver(() => {
  document.documentElement.style.setProperty('--header-h', `${nav.offsetHeight}px`);
}).observe(nav);

document.querySelectorAll('.leader button').forEach(button => {
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', open);
    document.getElementById(button.getAttribute('aria-controls')).hidden = !open;
  });
});

const intro = document.querySelector('.intro');

if (intro) {
  const hero = intro.querySelector('.hero');
  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
  const keys = { ArrowDown: true, PageDown: true, ArrowUp: false, PageUp: false };
  let d = 1;
  let h = 0;
  let target = null;
  let held = false;
  let free = false;
  let touching = false;
  let origin = 0;
  let last = 0;
  let lastAbs = 0;
  let until = 0;
  let touchY = 0;
  let timer;
  let release;

  const paint = () => {
    const p = Math.min(Math.max(scrollY / d, 0), 1);
    const under = scrollY < h;
    intro.style.setProperty('--p', p);
    nav.style.setProperty('--tint', under ? p : 0);
    nav.classList.toggle('invert', under && p > 0.5);
  };

  const glide = to => {
    if (Math.abs(scrollY - to) < 1) return;
    target = to;
    until = performance.now() + 900;
    scrollTo({ top: to, behavior });
    clearTimeout(release);
    release = setTimeout(() => target = null, 1200);
  };

  const settle = () => {
    if (target !== null || touching || scrollY < 1 || scrollY > d - 1) return;
    glide(scrollY > d / 2 ? d : 0);
  };

  const start = () => {
    origin = scrollY;
    held = false;
    free = false;
  };

  const hold = (e, down) => {
    if (nav.classList.contains('open') || document.querySelector('.popup[open]')) return;
    if (!held && target === null && !free && (down ? origin < d - 1 : origin > 1 && origin < d + 1)) {
      glide(down ? d : 0);
      held = true;
    }
    if (held || target !== null) e.preventDefault();
  };

  new ResizeObserver(() => {
    d = intro.offsetHeight - hero.offsetHeight;
    h = intro.offsetHeight;
    paint();
    settle();
  }).observe(intro);

  addEventListener('wheel', e => {
    if (!e.deltaY || e.ctrlKey) return;
    const now = performance.now();
    const abs = Math.abs(e.deltaY);
    if (now - last > 150 || (held && now > until && abs > lastAbs + 2)) start();
    last = now;
    lastAbs = abs;
    hold(e, e.deltaY > 0);
  }, { passive: false });

  addEventListener('touchstart', e => {
    touchY = e.touches[0].clientY;
    touching = true;
    start();
  });

  addEventListener('touchmove', e => {
    const dy = touchY - e.touches[0].clientY;
    if (dy) hold(e, dy > 0);
  }, { passive: false });

  addEventListener('touchend', () => {
    touching = false;
    clearTimeout(timer);
    timer = setTimeout(settle, 150);
  });

  addEventListener('keydown', e => {
    const down = e.key === ' ' ? !e.shiftKey : keys[e.key];
    if (down === undefined || e.target.closest('input, textarea, select, button')) return;
    if (!e.repeat) start();
    hold(e, down);
  });

  addEventListener('scroll', () => {
    if (target === null) free = true;
    else if (Math.abs(scrollY - target) < 1) target = null;
    paint();
    clearTimeout(timer);
    timer = setTimeout(settle, 150);
  });
}
