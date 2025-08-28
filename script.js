(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const feedEl = $('#feed');
  const pinnedSection = $('#pinned');
  const pinnedList = $('#pinnedList');
  const statusEl = $('#statusText');
  const tzText = $('#tzText');
  const updatedText = $('#updatedText');
  const titleEl = $('#feedTitle');
  const yearEl = $('#year');
  const btnPause = $('#btnPause');
  const btnTheme = $('#btnTheme');
  const toggleScroll = $('#toggleScroll');
  const toggleCompact = $('#toggleCompact');
  const postTpl = $('#postTemplate');
  const lightbox = $('#lightbox');
  const lightboxImg = $('#lightboxImg');
  const lightboxClose = $('#lightboxClose');

  let state = {
    paused: false,
    autoscroll: true,
    compact: false,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    posts: new Map(), // id -> data
    order: [], // ids in time desc
    etag: null,
  };

  yearEl.textContent = new Date().getFullYear();
  toggleScroll.checked = true;

  // THEME
  const getTheme = () => localStorage.getItem('theme') || 'auto';
  const setTheme = (t) => {
    localStorage.setItem('theme', t);
    applyTheme();
  };
  const applyTheme = () => {
    const t = getTheme();
    document.documentElement.dataset.theme = t;
    if (t === 'dark') document.documentElement.classList.add('force-dark');
    else document.documentElement.classList.remove('force-dark');
  };
  btnTheme.addEventListener('click', () => {
    const current = getTheme();
    const next = current === 'auto' ? 'dark' : current === 'dark' ? 'light' : 'auto';
    setTheme(next);
    btnTheme.textContent = `Theme: ${next}`;
  });
  applyTheme();
  btnTheme.textContent = `Theme: ${getTheme()}`;

  // COMPACT
  toggleCompact.addEventListener('change', e => {
    state.compact = !!e.target.checked;
    document.body.classList.toggle('compact', state.compact);
  });

  // AUTOSCROLL
  toggleScroll.addEventListener('change', e => state.autoscroll = !!e.target.checked);

  // PAUSE/RESUME
  btnPause.addEventListener('click', () => {
    state.paused = !state.paused;
    btnPause.textContent = state.paused ? 'Resume' : 'Pause';
    btnPause.setAttribute('aria-pressed', String(state.paused));
    status(`Auto-refresh ${state.paused ? 'paused' : 'resumed'}.`, 'ok');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      btnPause.click();
    }
    if (e.key.toLowerCase() === 't') {
      btnTheme.click();
    }
  });

  // Lightbox
  const openLightbox = (src, alt) => {
    lightboxImg.src = src;
    lightboxImg.alt = alt || '';
    lightbox.showModal();
  };
  lightboxClose.addEventListener('click', () => lightbox.close());
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) lightbox.close();
  });

  const fmtAbs = (d, tz) => new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: tz
  }).format(d);

  const fmtRel = (d) => {
    const rtf = new Intl.RelativeTimeFormat(undefined, {
      numeric: 'auto'
    });
    const diff = (Date.now() - d.getTime()) / 1000; // seconds
    const abs = Math.abs(diff);
    const units = [
      ['year', 31536000],
      ['month', 2592000],
      ['week', 604800],
      ['day', 86400],
      ['hour', 3600],
      ['minute', 60],
      ['second', 1]
    ];
    for (const [u, s] of units) {
      if (abs >= s || u === 'second') {
        return rtf.format(Math.round(-diff / s), u);
      }
    }
  };

  function status(text, cls = '') {
    statusEl.textContent = text;
    statusEl.className = cls ? cls : '';
  }

  async function fetchFeed() {
    if (state.paused) return;
    try {
      const res = await fetch(window.FEED_PATH, {
        cache: 'no-store'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      applyFeed(data);
      status('Connected', 'ok');
    } catch (err) {
      console.error(err);
      status(`Fetch error: ${err.message}`, 'err');
    }
  }

  function applyFeed(data) {
    const tz = window.TIMEZONE_OVERRIDE || data?.meta?.timezone || state.tz;
    state.tz = tz;
    tzText.textContent = tz;
    titleEl.textContent = data?.meta?.title || 'Live Feed';

    if (data?.meta?.updated_at) {
      const d = new Date(data.meta.updated_at);
      updatedText.textContent = `${fmtAbs(d, tz)} (${fmtRel(d)})`;
    }

    const posts = Array.isArray(data?.posts) ? data.posts.slice() : [];
    // Sort newest first by time
    posts.sort((a, b) => new Date(b.time) - new Date(a.time));

    // Build index and render only new/changed
    const existing = new Set(state.order);
    const newOrder = [];

    const pinned = [];

    for (const p of posts) {
      const id = p.id || `${p.time}-${(p.title||'').slice(0,24)}`;
      newOrder.push(id);
      const isPinned = !!p.pinned;
      const prev = state.posts.get(id);
      state.posts.set(id, p);
      if (!prev) {
        renderPost(id, p, isPinned);
      } else if (JSON.stringify(prev) !== JSON.stringify(p)) {
        updatePost(id, p, isPinned);
      }
      if (isPinned) pinned.push(id);
    }

    state.order = newOrder;

    // Reorder DOM to match newOrder (newest on top)
    for (const id of newOrder.slice().reverse()) {
      const node = feedEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (node) feedEl.prepend(node);
    }

    // Pinned section
    pinnedSection.hidden = pinned.length === 0;
    pinnedList.innerHTML = '';
    for (const id of pinned) {
      const srcNode = feedEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (srcNode) pinnedList.appendChild(srcNode.cloneNode(true));
    }

    // Auto-scroll to top for newest if toggled
    if (state.autoscroll) window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });

    // Update aria
    feedEl.setAttribute('aria-busy', 'false');
  }

  function renderPost(id, p, isPinned) {
    const node = postTpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = id;
    $('.title', node).textContent = p.title || 'Untitled';

    const t = new Date(p.time);
    const absEl = $('.absolute', node);
    const relEl = $('.relative', node);
    absEl.dateTime = t.toISOString();
    absEl.textContent = fmtAbs(t, state.tz);
    relEl.textContent = fmtRel(t);

    const descEl = $('.desc', node);
    descEl.textContent = p.description || '';

    const mediaEl = $('.media', node);
    mediaEl.innerHTML = '';
    if (Array.isArray(p.images)) {
      for (const src of p.images) {
        const img = new Image();
        img.src = src;
        img.alt = p.title || 'News image';
        img.addEventListener('click', () => openLightbox(src, img.alt));
        mediaEl.appendChild(img);
      }
    }

    const tagsEl = $('.tags', node);
    tagsEl.innerHTML = '';
    if (Array.isArray(p.tags)) {
      for (const tag of p.tags) {
        const s = document.createElement('span');
        s.className = 'tag';
        s.textContent = `#${tag}`;
        tagsEl.appendChild(s);
      }
    }

    feedEl.appendChild(node);
  }

  function updatePost(id, p) {
    const node = feedEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!node) return renderPost(id, p);
    $('.title', node).textContent = p.title || 'Untitled';

    const t = new Date(p.time);
    const absEl = $('.absolute', node);
    const relEl = $('.relative', node);
    absEl.dateTime = t.toISOString();
    absEl.textContent = fmtAbs(t, state.tz);
    relEl.textContent = fmtRel(t);

    $('.desc', node).textContent = p.description || '';

    const mediaEl = $('.media', node);
    mediaEl.innerHTML = '';
    if (Array.isArray(p.images)) {
      for (const src of p.images) {
        const img = new Image();
        img.src = src;
        img.alt = p.title || 'News image';
        img.addEventListener('click', () => openLightbox(src, img.alt));
        mediaEl.appendChild(img);
      }
    }

    const tagsEl = $('.tags', node);
    tagsEl.innerHTML = '';
    if (Array.isArray(p.tags)) {
      for (const tag of p.tags) {
        const s = document.createElement('span');
        s.className = 'tag';
        s.textContent = `#${tag}`;
        tagsEl.appendChild(s);
      }
    }
  }

  // Periodic relative-time refresher
  setInterval(() => {
    $$('.card time.absolute').forEach(abs => {
      const rel = abs.parentElement.querySelector('.relative');
      if (rel) rel.textContent = fmtRel(new Date(abs.dateTime));
    });
  }, 15000);

  // Polling
  fetchFeed();
  setInterval(fetchFeed, window.REFRESH_MS);
})();