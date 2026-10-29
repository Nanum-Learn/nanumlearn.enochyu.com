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

const banner = document.getElementById('banner');

if (sessionStorage.getItem('bannerClosed') !== 'true') banner.hidden = false;

banner.querySelector('button').addEventListener('click', () => {
  banner.hidden = true;
  sessionStorage.setItem('bannerClosed', 'true');
});
