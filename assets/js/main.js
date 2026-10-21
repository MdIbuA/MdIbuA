// The Engineering Playground — progressive enhancement only.
// Every feature here is optional: the page is complete without JavaScript.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------------------------------------------------------------------------
   System map data. Every "where" link points at a project on this page.
--------------------------------------------------------------------------- */
const NODES = {
  ui: {
    title: 'Interface',
    body: 'Where a person meets the system. I have shipped React dashboards, a Telegram bot whose chat is the whole product, and dependency-free static apps.',
    where: [['CryptoPulse dashboard', '#project-cryptopulse'], ['Ops Agent on Telegram', '#project-opsagent']],
  },
  api: {
    title: 'API layer',
    body: 'Validates input, enforces auth and turns requests into calls the rest of the system understands. Built with FastAPI, Express and AWS Lambda handlers.',
    where: [['FastAPI + JWT in CryptoPulse', '#project-cryptopulse'], ['Lambda in DocuMind', '#project-documind']],
  },
  agent: {
    title: 'Agent loop',
    body: 'Lets an LLM choose typed tools, runs them, and feeds the results back, with a hard cap on rounds. I wrote mine directly on the SDK so every step is inspectable.',
    where: [['32-tool agent, Ops Agent', '#project-opsagent']],
  },
  model: {
    title: 'Model',
    body: 'Inference, from hosted LLMs (Bedrock Nova, Claude, Gemini) to models I trained myself (Keras LSTMs, Gradient Boosting, CNNs with transfer learning).',
    where: [['LSTM + GBR', '#project-cryptopulse'], ['Nova Pro', '#project-documind'], ['Xception / MobileNet', '#project-bone']],
  },
  retrieval: {
    title: 'Retrieval',
    body: 'Gets the right context into the prompt so answers come from sources, not model memory. Approaches range from protocol retrieval (RAG) to plain long-context stuffing.',
    where: [['Protocol RAG', '#project-crisis'], ['Document context', '#project-documind']],
  },
  pipeline: {
    title: 'Data pipeline',
    body: 'Ingestion and feature engineering: paginated market-data pulls with a fallback source, rolling statistics and leakage-safe chronological splits.',
    where: [['Binance → features', '#project-cryptopulse']],
  },
  data: {
    title: 'Data store',
    body: 'The source of truth. Money in integer paise, row locks for concurrent writes, idempotency keys. Postgres, MongoDB, Oracle, Firestore and S3.',
    where: [['Postgres + Prisma', '#project-opsagent'], ['Oracle APEX apps', '#index']],
  },
  cloud: {
    title: 'Cloud & delivery',
    body: 'The boundary everything runs inside: serverless on AWS (Lambda, S3, CloudFront, EventBridge, SES), containers on Cloud Run, and Docker plus GitHub Actions to ship.',
    where: [['Serverless DocuMind', '#project-documind'], ['More cloud builds', '#index']],
  },
};

const EDGES = $$('[data-edge]').map((el) => ({ el, a: el.dataset.edge.split('-')[0], b: el.dataset.edge.split('-')[1] }));

const FLOWS = {
  documind: {
    title: 'Trace — DocuMind AI',
    steps: [
      ['ui', 'React app uploads a PDF.'],
      ['api', 'Lambda receives it and stores it in S3.'],
      ['data', 'pypdf extracts the text layer.'],
      ['retrieval', 'Text is truncated to fit the task’s context budget.'],
      ['model', 'Nova Pro returns strict JSON.'],
      ['api', 'Lambda validates and returns the result.'],
      ['ui', 'The summary, Q&A and export are rendered.'],
    ],
    link: '#project-documind',
  },
  cryptopulse: {
    title: 'Trace — CryptoPulse',
    steps: [
      ['pipeline', 'Pull OHLCV candles from Binance (CSV fallback).'],
      ['pipeline', 'Engineer moving averages, volatility and returns.'],
      ['model', 'Gradient Boosting or the LSTM forecasts each horizon.'],
      ['api', 'FastAPI serves the forecast and its metrics.'],
      ['data', 'MongoDB stores users and forecast history.'],
      ['ui', 'React charts the forecast next to RMSE, MAE and R².'],
    ],
    link: '#project-cryptopulse',
  },
  opsagent: {
    title: 'Trace — Supermarket Ops Agent',
    steps: [
      ['ui', 'Owner types “make a bill: 2kg sugar, 4 Maggi, UPI”.'],
      ['api', 'The grammY handler skips any Telegram update it has already processed.'],
      ['agent', 'The loop sends the message and 32 tool schemas.'],
      ['model', 'Claude decides which tools to call.'],
      ['agent', 'Tools run with validated inputs.'],
      ['data', 'Postgres applies the change atomically, with stock guards.'],
      ['ui', 'The reply and the PDF invoice go back to Telegram.'],
    ],
    link: '#project-opsagent',
  },
};

function initSystemMap() {
  const map = $('[data-sysmap]');
  if (!map) return;
  const panel = $('[data-sysmap-panel]', map);
  const nodeBtns = $$('[data-node]', map);
  const flowBtns = $$('[data-flow]', map);
  const byId = Object.fromEntries(nodeBtns.map((b) => [b.dataset.node, b]));
  let flowTimer = null;

  const clear = () => {
    window.clearTimeout(flowTimer);
    map.classList.remove('has-selection', 'has-cloud');
    nodeBtns.forEach((b) => { b.setAttribute('aria-pressed', 'false'); b.classList.remove('is-linked', 'is-current'); });
    flowBtns.forEach((b) => b.setAttribute('aria-pressed', 'false'));
    EDGES.forEach((e) => e.el.classList.remove('is-active'));
  };

  const linkList = (pairs) =>
    `<p class="sysmap__panel-links">${pairs.map(([t, h]) => `<a href="${h}">${t}</a>`).join('')}</p>`;

  const selectNode = (id) => {
    const wasPressed = byId[id].getAttribute('aria-pressed') === 'true';
    clear();
    if (wasPressed) { resetPanel(); return; }
    const info = NODES[id];
    map.classList.add('has-selection');
    byId[id].setAttribute('aria-pressed', 'true');
    if (id === 'cloud') {
      map.classList.add('has-cloud');
      nodeBtns.forEach((b) => b !== byId[id] && b.classList.add('is-linked'));
    } else {
      EDGES.forEach((e) => {
        if (e.a === id || e.b === id) {
          e.el.classList.add('is-active');
          byId[e.a === id ? e.b : e.a].classList.add('is-linked');
        }
      });
    }
    panel.innerHTML = `<p class="sysmap__panel-title">${info.title}</p>
      <p class="sysmap__panel-body">${info.body}</p>${linkList(info.where)}`;
  };

  const resetPanel = () => {
    panel.innerHTML = `<p class="sysmap__panel-title">Nothing selected</p>
      <p class="sysmap__panel-body">Each box is a layer I have built in a real project. Pick one to see its job and where it shows up in my work.</p>`;
  };

  const runFlow = (key, btn) => {
    const wasPressed = btn.getAttribute('aria-pressed') === 'true';
    clear();
    if (wasPressed) { resetPanel(); return; }
    const flow = FLOWS[key];
    btn.setAttribute('aria-pressed', 'true');
    map.classList.add('has-selection');
    panel.innerHTML = `<p class="sysmap__panel-title">${flow.title}</p>
      <ol class="sysmap__steps">${flow.steps.map(([n, t]) => `<li><span><strong>${NODES[n].title}</strong> — ${t}</span></li>`).join('')}</ol>
      ${linkList([['Read the case study', flow.link]])}`;
    const items = $$('.sysmap__steps li', panel);

    const show = (i) => {
      nodeBtns.forEach((b) => b.classList.remove('is-current'));
      items.forEach((li, j) => li.classList.toggle('is-current', j === i));
      const [n] = flow.steps[i];
      byId[n].classList.add('is-current', 'is-linked');
      // Light the edge to the most recent earlier step that connects to this node.
      for (let j = i - 1; j >= 0; j -= 1) {
        const prev = flow.steps[j][0];
        const edge = EDGES.find((e) => (e.a === prev && e.b === n) || (e.b === prev && e.a === n));
        if (edge) { edge.el.classList.add('is-active'); break; }
      }
    };

    if (reduceMotion.matches) {
      flow.steps.forEach((_, i) => show(i));
      nodeBtns.forEach((b) => b.classList.remove('is-current'));
      items.forEach((li) => li.classList.remove('is-current'));
      return;
    }
    let i = 0;
    const tick = () => {
      show(i);
      i += 1;
      if (i < flow.steps.length) flowTimer = window.setTimeout(tick, 900);
    };
    tick();
  };

  nodeBtns.forEach((btn) => btn.addEventListener('click', () => selectNode(btn.dataset.node)));
  flowBtns.forEach((btn) => btn.addEventListener('click', () => runFlow(btn.dataset.flow, btn)));

  // Arrow keys move focus between nodes in reading order; Escape clears.
  map.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { clear(); resetPanel(); return; }
    const i = nodeBtns.indexOf(document.activeElement);
    if (i === -1) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    nodeBtns[(i + step + nodeBtns.length) % nodeBtns.length].focus();
  });
}

/* ---------------------------------------------------------------------------
   Project filters
--------------------------------------------------------------------------- */
function initFilters() {
  const buttons = $$('[data-filter]');
  if (!buttons.length) return;
  const items = $$('#work [data-tags]');
  const status = $('[data-filter-status]');
  const empty = $('[data-filter-empty]');
  const indexRows = $$('.index__row');
  const pair = $('.work__pair');

  buttons.forEach((btn) => btn.addEventListener('click', () => {
    const f = btn.dataset.filter;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    let shown = 0;
    items.forEach((el) => {
      const match = f === 'all' || el.dataset.tags.split(' ').includes(f);
      el.hidden = !match;
      if (match) { shown += 1; el.classList.add('is-in'); }
    });
    if (pair) {
      const visible = $$('[data-tags]', pair).filter((el) => !el.hidden).length;
      pair.hidden = visible === 0;
      pair.classList.toggle('is-single', visible === 1);
    }
    empty.hidden = indexRows.some((r) => !r.hidden);
    status.textContent = `${shown} project${shown === 1 ? '' : 's'} shown${f === 'all' ? '' : ` for ${btn.textContent}`}.`;
  }));
}

/* ---------------------------------------------------------------------------
   Command menu (Ctrl/⌘+K or "/")
--------------------------------------------------------------------------- */
const COMMANDS = [
  ['Sections', 'Selected work', '#work'],
  ['Sections', 'System map', '#system'],
  ['Sections', 'How I work', '#about'],
  ['Sections', 'Capabilities', '#stack'],
  ['Sections', 'Experience & leadership', '#path'],
  ['Sections', 'Writing', '#writing'],
  ['Sections', 'Contact', '#contact'],
  ['Projects', 'CryptoPulse', '#project-cryptopulse'],
  ['Projects', 'Supermarket Ops Agent', '#project-opsagent'],
  ['Projects', 'DocuMind AI', '#project-documind'],
  ['Projects', 'Crisis Response Coordinator', '#project-crisis'],
  ['Projects', 'Bone density classification', '#project-bone'],
  ['Projects', 'More builds & experiments', '#index'],
  ['Elsewhere', 'GitHub — @MdIbuA', 'https://github.com/MdIbuA'],
  ['Elsewhere', 'LinkedIn', 'https://www.linkedin.com/in/mohamedibrahimbinabdullah'],
  ['Elsewhere', 'AWS Builder article — DocuMind', 'https://builder.aws.com/content/3IXxyXBIA0XvQy27nJLaev2clbM/weekend-showcase-challenge-documind-ai'],
  ['Actions', 'Email Ibu', 'mailto:2005mohamedibrahim@gmail.com'],
];

function initCommandMenu() {
  const dialog = $('[data-cmd]');
  if (!dialog || typeof dialog.showModal !== 'function') {
    $$('[data-cmd-open]').forEach((b) => { b.hidden = true; });
    return;
  }
  const input = $('#cmd-input', dialog);
  const list = $('#cmd-list', dialog);
  let results = [];
  let active = 0;
  let opener = null;

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  $$('[data-cmd-kbd]').forEach((k) => { k.textContent = isMac ? '⌘K' : 'Ctrl K'; });

  const render = () => {
    const q = input.value.trim().toLowerCase();
    results = COMMANDS.filter(([g, label]) => !q || `${g} ${label}`.toLowerCase().includes(q));
    active = Math.min(active, Math.max(results.length - 1, 0));
    if (!results.length) {
      list.innerHTML = '<li class="cmd__none" role="presentation">No matches. Try “projects” or “contact”.</li>';
      input.removeAttribute('aria-activedescendant');
      return;
    }
    let html = '';
    let group = '';
    results.forEach(([g, label, href], i) => {
      if (g !== group) {
        group = g;
        html += `<li class="cmd__group" role="presentation">${g}</li>`;
      }
      const ext = href.startsWith('http') ? 'opens new tab' : href.startsWith('mailto') ? 'email' : '';
      html += `<li class="cmd__item" role="option" id="cmd-opt-${i}" data-i="${i}" aria-selected="${i === active}">
        <span>${label}</span><small>${ext}</small></li>`;
    });
    list.innerHTML = html;
    input.setAttribute('aria-activedescendant', `cmd-opt-${active}`);
    $(`#cmd-opt-${active}`, list)?.scrollIntoView({ block: 'nearest' });
  };

  const open = () => {
    opener = document.activeElement;
    input.value = '';
    active = 0;
    render();
    dialog.showModal();
    input.focus();
  };
  const close = () => dialog.close();

  const run = (i) => {
    const item = results[i];
    if (!item) return;
    const [, , href] = item;
    close();
    if (href.startsWith('#')) {
      const target = $(href);
      history.pushState(null, '', href);
      target?.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      target?.setAttribute('tabindex', '-1');
      target?.focus({ preventScroll: true });
    } else if (href.startsWith('mailto')) {
      window.location.href = href;
    } else {
      window.open(href, '_blank', 'noopener');
    }
  };

  dialog.addEventListener('close', () => {
    if (opener && document.contains(opener) && document.activeElement === document.body) opener.focus();
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(active);
    }
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) run(Number(li.dataset.i));
  });

  $$('[data-cmd-open]').forEach((b) => b.addEventListener('click', open));
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      dialog.open ? close() : open();
    } else if (e.key === '/' && !typing && !dialog.open) {
      e.preventDefault();
      open();
    }
  });
}

/* ---------------------------------------------------------------------------
   Header: mobile menu, scrolled state, current section
--------------------------------------------------------------------------- */
function initHeader() {
  const header = $('[data-header]');
  const toggle = $('[data-menu-toggle]');
  const list = $('#site-nav-list');

  const setMenu = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    list.classList.toggle('is-open', open);
  };
  toggle?.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  list?.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') { setMenu(false); toggle.focus(); }
  });
  window.matchMedia('(min-width: 52.01em)').addEventListener('change', () => setMenu(false));

  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const links = $$('a[href^="#"]', list);
  const sections = links.map((a) => $(a.getAttribute('href'))).filter(Boolean);
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((a) => {
        if (a.getAttribute('href') === `#${entry.target.id}`) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => io.observe(s));
}

/* ---------------------------------------------------------------------------
   Reveal on scroll, copy email, footer year
--------------------------------------------------------------------------- */
function initReveal() {
  const els = $$('.reveal');
  if (!('IntersectionObserver' in window) || reduceMotion.matches) {
    els.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  els.forEach((el) => io.observe(el));
  // A deep link straight into a case study should not land on invisible content.
  if (location.hash) $(location.hash)?.closest('.reveal')?.classList.add('is-in');
}

function initCopy() {
  const status = $('[data-copy-status]');
  $$('[data-copy]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      status.textContent = 'Copied to clipboard';
    } catch {
      status.textContent = 'Copy failed — select the address instead';
    }
    window.setTimeout(() => { status.textContent = ''; }, 3000);
  }));
}

initHeader();
initSystemMap();
initFilters();
initCommandMenu();
initReveal();
initCopy();
$$('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
window.__ibuReady = true;
requestAnimationFrame(() => document.documentElement.classList.add('is-ready'));
