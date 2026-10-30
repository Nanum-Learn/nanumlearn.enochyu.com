(() => {
  const popup = document.getElementById('popup');
  const key = `popup-${popup.dataset.id}`;

  const closed = () => {
    try {
      return localStorage.getItem(key) === 'closed';
    } catch {
      return false;
    }
  };

  if (closed() || Date.now() > Date.parse(popup.dataset.until)) return;

  popup.addEventListener('close', () => {
    try {
      localStorage.setItem(key, 'closed');
    } catch {}
  });

  popup.addEventListener('click', e => {
    if (e.target === popup || e.target.closest('.popup-close, a')) popup.close();
  });

  popup.showModal();
})();
