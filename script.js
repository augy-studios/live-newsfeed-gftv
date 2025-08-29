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

  let wakeTimer = null; // fires when the next scheduled (future) post becomes visible

  yearEl.textContent = new Date().getFullYear();
  toggleScroll.checked = true;

  // THEME
  const getTheme = () => localStorage.getItem('livespot-theme') || 'auto';
  const setTheme = (t) => {
    localStorage.setItem('livespot-theme', t);
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
    rerenderTelegramEmbeds();
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

  // Resolve the effective dark mode from the theme setting
  function isDarkThemeEffective() {
    const t = (localStorage.getItem('livespot-theme') || 'auto');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    // auto -> follow system
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // Re-render all Telegram embeds to the current theme by replacing the <script> tags
  function rerenderTelegramEmbeds() {
    const scripts = document.querySelectorAll('.embeds script[data-telegram-post]');
    for (const old of scripts) {
      const post = old.getAttribute('data-telegram-post'); // channel/msgId
      const width = old.getAttribute('data-width') || '100%';
      const dark = isDarkThemeEffective() ? '1' : '0';

      // Build a fresh script so Telegram re-parses
      const s = document.createElement('script');
      s.async = true;
      s.src = 'https://telegram.org/js/telegram-widget.js?22';
      s.setAttribute('data-telegram-post', post);
      s.setAttribute('data-width', width);
      s.setAttribute('data-dark', dark);

      // Replace old script (and its rendered node)
      old.parentNode.insertBefore(s, old);
      old.remove();
    }
  }

  // If the theme is set to "auto", re-render telegram embeds when the OS theme flips
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', () => {
      if ((localStorage.getItem('livespot-theme') || 'auto') === 'auto') {
        rerenderTelegramEmbeds();
      }
    });
  }

  // Twitter embed support
  function extractTweetId(u) {
    // match /status/123... or /i/status/123...
    const m = u.pathname.match(/\/(?:i\/)?status\/(\d+)/);
    return m ? m[1] : null;
  }

  function makeFXTwitterIframe(url) {
    // Accepts any https://fxtwitter.com/... URL with a status ID
    try {
      const u = new URL(url);
      const id = extractTweetId(u);
      if (!id) return null;
      const wrap = document.createElement('div');
      wrap.className = 'embed-16x9'; // keeps it responsive; tweets are tall but this gives a clean container
      const iframe = document.createElement('iframe');
      iframe.loading = 'lazy';
      iframe.allowFullscreen = false;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.src = `https://fxtwitter.com/i/status/${encodeURIComponent(id)}?embed=1`;
      iframe.style.border = '0';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      wrap.appendChild(iframe);
      return wrap;
    } catch {
      return null;
    }
  }

  function makeFixupXIframe(url) {
    // Accepts https://fixupx.com/... URL with a status ID
    try {
      const u = new URL(url);
      const id = extractTweetId(u);
      if (!id) return null;
      const wrap = document.createElement('div');
      wrap.className = 'embed-16x9';
      const iframe = document.createElement('iframe');
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.src = `https://fixupx.com/i/status/${encodeURIComponent(id)}?embed=1`;
      iframe.style.border = '0';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      wrap.appendChild(iframe);
      return wrap;
    } catch {
      return null;
    }
  }

  // BlueSky Embed Support
  function makeFXBskyIframe(url) {
    // Accepts https://fxbsky.app/profile/{handle|did}/post/{rkey}
    // We route to the official Bluesky embed service which supports iframes well.
    try {
      const u = new URL(url);
      // Repoint host to bsky.app (same path) for canonical embed
      const bskyUrl = `https://bsky.app${u.pathname}`;
      const iframe = document.createElement('iframe');
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.src = `https://embed.bsky.app/?url=${encodeURIComponent(bskyUrl)}`;
      iframe.style.border = '0';
      iframe.style.width = '100%';
      iframe.style.height = '350px'; // Bluesky autosizing is limited cross-origin; fixed height is reliable
      iframe.setAttribute('title', 'Bluesky post');
      return iframe;
    } catch {
      return null;
    }
  }

  function makeSocialEmbed(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      if (host === 'fxtwitter.com') {
        return makeFXTwitterIframe(url);
      }
      if (host === 'fixupx.com') {
        return makeFixupXIframe(url);
      }
      if (host === 'fxbsky.app') {
        return makeFXBskyIframe(url);
      }
    } catch {}
    return null; // let caller decide fallback
  }

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

    // hide future posts, and find the earliest upcoming time
    const now = Date.now();
    const rawPosts = Array.isArray(data?.posts) ? data.posts.slice() : [];
    let nextUnlock = Infinity; // ms timestamp of the soonest future post

    // keep only posts whose time <= now; track the soonest future post time
    const posts = rawPosts.filter(p => {
      const t = new Date(p.time).getTime();
      if (!isFinite(t)) return true; // if bad/missing time, show it
      if (t > now) { // scheduled for the future
        if (t < nextUnlock) nextUnlock = t; // track earliest future
        return false; // hide for now
      }
      return true; // already due → show
    });

    // (re)schedule a wake-up fetch exactly when the next future post should appear
    if (isFinite(nextUnlock)) {
      if (wakeTimer) clearTimeout(wakeTimer);
      const delay = Math.max(0, nextUnlock - Date.now() + 500); // +0.5s cushion
      wakeTimer = setTimeout(() => {
        wakeTimer = null;
        fetchFeed();
      }, delay);

      // surface status so editors know when the next one hits
      const nextDate = new Date(nextUnlock);
      status(`Next scheduled post: ${fmtAbs(nextDate, state.tz)} (${fmtRel(nextDate)})`);
    }

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

    const embedsEl = $('.embeds', node);
    embedsEl.innerHTML = '';
    if (p.embeds && typeof p.embeds === 'object') {
      // YouTube
      if (Array.isArray(p.embeds.youtube)) {
        for (const y of p.embeds.youtube) {
          const id = getYouTubeId(y);
          if (id) embedsEl.appendChild(makeYouTubeIframe(id));
        }
      }
      // Telegram
      if (Array.isArray(p.embeds.telegram)) {
        for (const t of p.embeds.telegram) {
          if (t && typeof t === 'string') embedsEl.appendChild(makeTelegramEmbed(t));
        }
        if (p.embeds.telegram.length) ensureTelegramWidget();
      }
      // fxtwitter, fixupx, fxbsky
      if (p.embeds && Array.isArray(p.embeds.links)) {
        for (const link of p.embeds.links) {
          if (typeof link !== 'string') continue;
          const node = makeSocialEmbed(link);
          if (node) {
            embedsEl.appendChild(node);
          } else {
            // graceful fallback: clickable link
            const a = document.createElement('a');
            a.href = link;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = link;
            embedsEl.appendChild(a);
          }
        }
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

  function getYouTubeId(input) {
    if (!input) return null;
    // Accept raw ID or URL
    const idLike = String(input).trim();
    if (/^[\w-]{11}$/.test(idLike)) return idLike;
    try {
      const u = new URL(idLike);
      if (u.hostname.includes('youtu.be')) return u.pathname.slice(1);
      if (u.hostname.includes('youtube.com')) {
        if (u.searchParams.get('v')) return u.searchParams.get('v');
        const m = u.pathname.match(/\/embed\/([\w-]{11})/);
        if (m) return m[1];
      }
    } catch {}
    return null;
  }

  function makeYouTubeIframe(id) {
    const wrap = document.createElement('div');
    wrap.className = 'embed-16x9';
    const iframe = document.createElement('iframe');
    iframe.loading = 'lazy';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?rel=0`;
    wrap.appendChild(iframe);
    return wrap;
  }

  function makeTelegramEmbed(url) {
    try {
      const u = new URL(url);
      if (u.hostname === "t.me" && u.pathname.split("/").length >= 3) {
        const parts = u.pathname.split("/");
        const channel = parts[1];
        const msgId = parts[2];
        const s = document.createElement("script");
        s.async = true;
        s.src = "https://telegram.org/js/telegram-widget.js?22";
        s.setAttribute("data-telegram-post", `${channel}/${msgId}`);
        s.setAttribute("data-width", "100%");
        s.setAttribute("data-dark", isDarkThemeEffective() ? "1" : "0");
        return s;
      }
    } catch (e) {
      console.warn("Invalid Telegram URL:", url, e);
    }
    const div = document.createElement("div");
    div.textContent = "Telegram embed failed to load.";
    return div;
  }

  function ensureTelegramWidget() {
    // If the global widget script is present, it will auto-scan the DOM.
    // Re-injecting the script nudges it to parse newly-added blockquotes too.
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    document.head.appendChild(s);
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

    const embedsEl = $('.embeds', node);
    embedsEl.innerHTML = '';
    if (p.embeds && typeof p.embeds === 'object') {
      // YouTube
      if (Array.isArray(p.embeds.youtube)) {
        for (const y of p.embeds.youtube) {
          const id = getYouTubeId(y);
          if (id) embedsEl.appendChild(makeYouTubeIframe(id));
        }
      }
      // Telegram
      if (Array.isArray(p.embeds.telegram)) {
        for (const t of p.embeds.telegram) {
          if (t && typeof t === 'string') embedsEl.appendChild(makeTelegramEmbed(t));
        }
        if (p.embeds.telegram.length) ensureTelegramWidget();
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