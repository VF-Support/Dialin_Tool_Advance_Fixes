/* global GUIDES_DEFAULT, CASE_TYPES, icon, getGuides, getGuide, saveGuide, resetGuide,
   createGuide, deleteGuide, subscribeGuides, subscribeCases, addCase, updateCaseStatus,
   deleteCase, FIREBASE_ENABLED */

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDateHeading(dateStr) {
  if (dateStr === todayStr()) return 'Today';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Global reactive state
// ---------------------------------------------------------------------------

let latestGuides = [];
let latestPendingCount = 0;
let globalSearchQuery = '';
let activeGuidesRerender = null; // set by whichever page cares about guide updates
let currentCleanup = null; // cleanup fn for whatever page is currently mounted

const appRoot = document.getElementById('app');

// ---------------------------------------------------------------------------
// Shell: sidebar + topbar (rendered once)
// ---------------------------------------------------------------------------

function renderShell() {
  appRoot.innerHTML = `
    <div class="sidebar-scrim" id="sidebar-scrim"></div>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <div>
          <div class="brand">${icon('radio', 18)}<span class="brand-label mono">DIC OPS</span></div>
          <h1>Training &amp; Case Board</h1>
        </div>
        <button class="close-mobile-nav" id="close-mobile-nav">${icon('x', 20)}</button>
      </div>
      <nav class="sidebar-nav" id="sidebar-nav"></nav>
    </aside>
    <div class="main-col">
      <header class="topbar">
        <div class="topbar-inner">
          <button class="open-mobile-nav" id="open-mobile-nav">${icon('menu', 22)}</button>
          <div class="search-wrap">
            ${icon('search', 16)}
            <input class="search-input" id="global-search" type="text" placeholder="Search guides..." />
          </div>
          <div class="sync-status">
            <span class="sync-dot ${FIREBASE_ENABLED ? 'on' : 'off'}"></span>
            <span class="hide-sm">${FIREBASE_ENABLED ? 'Synced via Firebase' : 'Local mode (this device only)'}</span>
          </div>
        </div>
      </header>
      <main id="page-content"></main>
    </div>
  `;

  document.getElementById('open-mobile-nav').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-scrim').classList.add('open');
  });
  const closeMobile = () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-scrim').classList.remove('open');
  };
  document.getElementById('close-mobile-nav').addEventListener('click', closeMobile);
  document.getElementById('sidebar-scrim').addEventListener('click', closeMobile);

  document.getElementById('global-search').addEventListener('input', (e) => {
    globalSearchQuery = e.target.value;
    const hash = location.hash || '#/';
    if (hash !== '#/' && hash !== '#') {
      location.hash = '#/';
    } else if (activeGuidesRerender) {
      activeGuidesRerender();
    }
  });
}

function renderSidebarNav() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  const hash = location.hash || '#/';

  const categories = new Map();
  latestGuides.forEach((g) => {
    if (!categories.has(g.category)) categories.set(g.category, []);
    categories.get(g.category).push(g);
  });

  const casesActive = hash === '#/cases';
  const allActive = hash === '#/' || hash === '#' || hash === '';

  let html = `
    <a href="#/cases" class="nav-link ${casesActive ? 'active' : ''}">
      <span class="icon-row">${icon('clipboard-list', 16)} Pending Case Board</span>
      ${latestPendingCount > 0 ? `<span class="pending-badge">${latestPendingCount}</span>` : ''}
    </a>
    <a href="#/" class="nav-link ${allActive ? 'active' : ''}">
      <span class="icon-row">${icon('layout-list', 16)} All Guides</span>
    </a>
    <a href="#/new-guide" class="nav-link ${hash === '#/new-guide' ? 'active' : ''}" style="margin-bottom:12px;">
      <span class="icon-row">${icon('list-plus', 16)} New Guide</span>
    </a>
    <div class="nav-divider"></div>
  `;

  categories.forEach((items, category) => {
    html += `<div class="nav-group"><div class="nav-category mono">${escapeHtml(category)}</div>`;
    items.forEach((g) => {
      const active = hash === `#/guides/${g.id}`;
      html += `<a href="#/guides/${g.id}" class="guide-link ${active ? 'active' : ''}" title="${escapeHtml(g.title)}">${escapeHtml(g.title)}</a>`;
    });
    html += `</div>`;
  });

  nav.innerHTML = html;

  // close mobile nav whenever a link inside it is used
  nav.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-scrim').classList.remove('open');
    });
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function parseRoute(hash) {
  hash = hash || '#/';
  if (hash === '#/' || hash === '#' || hash === '') return { name: 'landing' };
  if (hash === '#/cases') return { name: 'cases' };
  if (hash === '#/new-guide') return { name: 'new-guide' };
  const m = hash.match(/^#\/guides\/(.+)$/);
  if (m) return { name: 'guide', id: decodeURIComponent(m[1]) };
  return { name: 'landing' };
}

function onRouteChange() {
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }
  activeGuidesRerender = null;

  const route = parseRoute(location.hash);
  renderSidebarNav();
  const page = document.getElementById('page-content');
  page.scrollTop = 0;
  window.scrollTo(0, 0);

  if (route.name === 'landing') {
    mountGuidesLanding(page);
  } else if (route.name === 'guide') {
    mountGuideDetail(page, route.id);
  } else if (route.name === 'cases') {
    mountCaseTracker(page);
  } else if (route.name === 'new-guide') {
    mountNewGuidePage(page);
  }
}

// ---------------------------------------------------------------------------
// Page: Guides landing
// ---------------------------------------------------------------------------

function mountGuidesLanding(container) {
  function renderGrid() {
    const q = globalSearchQuery.trim().toLowerCase();
    const filtered = !q
      ? latestGuides
      : latestGuides.filter(
          (g) =>
            g.title.toLowerCase().includes(q) ||
            g.category.toLowerCase().includes(q) ||
            g.blocks.some((b) => b.type === 'text' && b.value.toLowerCase().includes(q))
        );

    const categories = new Map();
    filtered.forEach((g) => {
      if (!categories.has(g.category)) categories.set(g.category, []);
      categories.get(g.category).push(g);
    });

    let groupsHtml = '';
    if (categories.size === 0) {
      groupsHtml = `<div class="empty-state">No guides match &ldquo;${escapeHtml(globalSearchQuery)}&rdquo;.</div>`;
    } else {
      categories.forEach((items, category) => {
        groupsHtml += `<div class="guide-group"><h3>${escapeHtml(category.toUpperCase())}</h3><div class="card-grid">`;
        items.forEach((g) => {
          const imgCount = g.blocks.filter((b) => b.type === 'image').length;
          const preview = (g.blocks.find((b) => b.type === 'text') || {}).value || '';
          groupsHtml += `
            <a class="guide-card" href="#/guides/${g.id}">
              <div class="row-top">${icon('file-text', 18)}${icon('arrow-right', 16)}</div>
              <h4>${escapeHtml(g.title)}</h4>
              <p>${escapeHtml(preview)}</p>
              ${imgCount > 0 ? `<div class="img-count">${icon('image', 12)} ${imgCount} screenshot${imgCount > 1 ? 's' : ''}</div>` : ''}
            </a>
          `;
        });
        groupsHtml += `</div></div>`;
      });
    }

    container.innerHTML = `
      <div class="page wide">
        <div class="case-head" style="margin-bottom:32px;">
          <div>
            <p class="eyebrow">TRAINING LIBRARY</p>
            <h2>DIC procedure guides</h2>
            <p class="page-desc">Every dial-in procedure the team uses, pulled straight from the training workbook. Open any guide to read the full steps and screenshots, or hit Edit to correct or expand it.</p>
          </div>
          <a href="#/new-guide" class="log-case-btn">${icon('list-plus', 16)} New guide</a>
        </div>
        ${groupsHtml}
      </div>
    `;
  }

  activeGuidesRerender = renderGrid;
  renderGrid();

  currentCleanup = () => {
    activeGuidesRerender = null;
  };
}

// ---------------------------------------------------------------------------
// Page: Guide detail (view + edit)
// ---------------------------------------------------------------------------

/**
 * Renders the shared block editor UI (title, category, reorderable text/image
 * blocks) into `container`. Used both for editing an existing guide and for
 * building a brand-new one from scratch.
 *
 * `initialState` = { title, category, blocks }
 * `options` = { saveLabel, onSave(title, category, cleanBlocks), onCancel(), onDelete }
 */
function mountBlockEditor(container, initialState, options) {
  const editState = {
    title: initialState.title || '',
    category: initialState.category || '',
    blocks: (initialState.blocks || []).map((b) => Object.assign({}, b)),
  };

  // Captures whatever's currently in the DOM (title, category, and block
  // text) back into editState. Must be called before any action that
  // re-renders the form, or unsaved typing in those fields would be lost.
  function syncFromDom() {
    const titleEl = document.getElementById('editor-title');
    const categoryEl = document.getElementById('editor-category');
    if (titleEl) editState.title = titleEl.value;
    if (categoryEl) editState.category = categoryEl.value;
    container.querySelectorAll('[data-block-text]').forEach((el) => {
      const idx = Number(el.getAttribute('data-block-text'));
      if (editState.blocks[idx]) editState.blocks[idx].value = el.value;
    });
  }

  function render() {
    let blocksHtml = '';
    editState.blocks.forEach((b, i) => {
      if (b.type === 'text') {
        const rows = Math.max(1, Math.ceil(b.value.length / 70));
        blocksHtml += `
          <div class="block-row">
            <div class="block-reorder">
              <button data-action="move-up" data-idx="${i}" ${i === 0 ? 'disabled' : ''}>${icon('arrow-up', 13)}</button>
              <button data-action="move-down" data-idx="${i}" ${i === editState.blocks.length - 1 ? 'disabled' : ''}>${icon('arrow-down', 13)}</button>
            </div>
            <div class="block-content">
              <textarea data-block-text="${i}" rows="${rows}" class="${b.code ? 'code-style' : ''}" placeholder="Step text or a command...">${escapeHtml(b.value)}</textarea>
            </div>
            <div class="block-actions">
              <button data-action="toggle-code" data-idx="${i}" class="${b.code ? 'active' : ''}" title="Toggle command/code style">${icon('terminal', 13)}</button>
              <button data-action="remove-block" data-idx="${i}" class="danger" title="Delete">${icon('trash', 13)}</button>
            </div>
          </div>
        `;
      } else {
        blocksHtml += `
          <div class="block-row">
            <div class="block-reorder">
              <button data-action="move-up" data-idx="${i}" ${i === 0 ? 'disabled' : ''}>${icon('arrow-up', 13)}</button>
              <button data-action="move-down" data-idx="${i}" ${i === editState.blocks.length - 1 ? 'disabled' : ''}>${icon('arrow-down', 13)}</button>
            </div>
            <div class="block-content"><img src="${escapeHtml(b.src)}" alt="" /></div>
            <div class="block-actions">
              <button data-action="replace-image" data-idx="${i}" title="Replace image">${icon('image-plus', 13)}</button>
              <button data-action="remove-block" data-idx="${i}" class="danger" title="Delete">${icon('trash', 13)}</button>
            </div>
          </div>
        `;
      }
    });

    if (editState.blocks.length === 0) {
      blocksHtml = `<div class="empty-state" style="margin-bottom:12px;">No steps yet &mdash; add a text line or a screenshot below to get started.</div>`;
    }

    container.innerHTML = `
      <div class="page editor-page">
        <button class="back-link" data-action="cancel-edit" style="background:none;border:none;cursor:pointer;">${icon('chevron-left', 14)} ${options.cancelLabel || 'Cancel editing'}</button>

        <input type="file" accept="image/*" id="editor-file-input" style="display:none;" />

        <div class="editor-field">
          <label class="field-label">TITLE</label>
          <input class="text-input title-input" id="editor-title" placeholder="e.g. Replacing a stuck cash drawer sensor" value="${escapeHtml(editState.title)}" />
        </div>
        <div class="editor-field narrow">
          <label class="field-label">CATEGORY</label>
          <input class="text-input" id="editor-category" placeholder="e.g. Hardware" value="${escapeHtml(editState.category)}" />
        </div>

        <div id="blocks-container">${blocksHtml}</div>

        <div class="add-block-row">
          <button class="add-block-btn" data-action="add-text">${icon('type', 14)} Add text line</button>
          <button class="add-block-btn" data-action="add-image">${icon('image-plus', 14)} Add image</button>
        </div>
      </div>

      <div class="editor-toolbar">
        ${options.onDelete ? `<button class="btn-secondary" data-action="delete-guide" style="color:var(--red);border-color:rgba(217,97,79,0.4);margin-right:auto;">${icon('trash', 14)} Delete guide</button>` : ''}
        <button class="btn-secondary" data-action="cancel-edit">${icon('x', 14)} Cancel</button>
        <button class="btn-primary" data-action="save-guide">${icon('save', 14)} ${options.saveLabel || 'Save changes'}</button>
      </div>
    `;

    let pendingImageSlot = null;
    const fileInput = document.getElementById('editor-file-input');
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        syncFromDom();
        if (pendingImageSlot === 'append') {
          editState.blocks.push({ type: 'image', src: reader.result });
        } else {
          editState.blocks[pendingImageSlot].src = reader.result;
        }
        render();
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });

    container.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', () => {
        const action = el.getAttribute('data-action');
        const idx = el.hasAttribute('data-idx') ? Number(el.getAttribute('data-idx')) : null;

        if (action === 'cancel-edit') {
          options.onCancel();
          return;
        }
        if (action === 'delete-guide') {
          if (confirm('Delete this guide? This can\'t be undone.')) {
            options.onDelete();
          }
          return;
        }
        if (action === 'save-guide') {
          syncFromDom();
          const title = document.getElementById('editor-title').value.trim();
          const category = document.getElementById('editor-category').value.trim();
          if (!title) {
            alert('Give this guide a title before saving.');
            return;
          }
          const cleanBlocks = editState.blocks
            .filter((b) => (b.type === 'text' ? b.value.trim() !== '' : true))
            .map((b) => (b.type === 'text' ? { type: 'text', value: b.value, code: !!b.code } : { type: 'image', src: b.src }));
          options.onSave(title, category || 'Custom', cleanBlocks);
          return;
        }
        if (action === 'add-text') {
          syncFromDom();
          editState.blocks.push({ type: 'text', value: '', code: false });
          render();
          return;
        }
        if (action === 'add-image') {
          pendingImageSlot = 'append';
          fileInput.click();
          return;
        }
        if (action === 'replace-image') {
          pendingImageSlot = idx;
          fileInput.click();
          return;
        }
        if (action === 'toggle-code') {
          syncFromDom();
          editState.blocks[idx].code = !editState.blocks[idx].code;
          render();
          return;
        }
        if (action === 'remove-block') {
          syncFromDom();
          editState.blocks.splice(idx, 1);
          render();
          return;
        }
        if (action === 'move-up' || action === 'move-down') {
          syncFromDom();
          const dir = action === 'move-up' ? -1 : 1;
          const target = idx + dir;
          if (target < 0 || target >= editState.blocks.length) return;
          const tmp = editState.blocks[idx];
          editState.blocks[idx] = editState.blocks[target];
          editState.blocks[target] = tmp;
          render();
          return;
        }
      });
    });
  }

  render();
}

// ---------------------------------------------------------------------------
// Page: Create a brand-new guide from scratch
// ---------------------------------------------------------------------------

function mountNewGuidePage(container) {
  mountBlockEditor(
    container,
    { title: '', category: '', blocks: [] },
    {
      cancelLabel: 'Cancel',
      saveLabel: 'Create guide',
      onCancel: () => {
        location.hash = '#/';
      },
      onSave: (title, category, blocks) => {
        const newId = createGuide({ title, category, blocks });
        location.hash = `#/guides/${newId}`;
      },
    }
  );

  currentCleanup = () => {};
}

// ---------------------------------------------------------------------------
// Page: Guide detail (view + edit)
// ---------------------------------------------------------------------------

function mountGuideDetail(container, id) {
  let mode = 'view'; // 'view' | 'edit'
  let lightboxSrc = null;

  function groupBlocksForView(blocks) {
    const groups = [];
    blocks.forEach((b) => {
      const last = groups[groups.length - 1];
      if (b.type === 'text' && b.code && last && last.type === 'code-group') {
        last.lines.push(b.value);
      } else if (b.type === 'text' && b.code) {
        groups.push({ type: 'code-group', lines: [b.value] });
      } else {
        groups.push(b);
      }
    });
    return groups;
  }

  function render() {
    const guide = getGuide(id);
    if (!guide) {
      container.innerHTML = `
        <div class="page narrow" style="text-align:center;">
          <p style="color:var(--ink-500);margin-bottom:16px;">Guide not found.</p>
          <a href="#/" style="color:var(--teal);text-decoration:underline;">Back to all guides</a>
        </div>
      `;
      return;
    }

    if (mode === 'edit') {
      mountBlockEditor(
        container,
        { title: guide.title, category: guide.category, blocks: guide.blocks },
        {
          cancelLabel: 'Cancel editing',
          saveLabel: 'Save changes',
          onDelete: guide.custom
            ? () => {
                deleteGuide(guide.id);
                location.hash = '#/';
              }
            : null,
          onCancel: () => {
            mode = 'view';
            render();
          },
          onSave: (title, category, blocks) => {
            saveGuide(guide.id, { title, category, blocks });
            mode = 'view';
            render();
          },
        }
      );
    } else {
      renderViewMode(guide);
    }
  }

  function renderViewMode(guide) {
    const groups = groupBlocksForView(guide.blocks);
    let bodyHtml = '';
    groups.forEach((g) => {
      if (g.type === 'image') {
        bodyHtml += `<img src="${escapeHtml(g.src)}" alt="${escapeHtml(guide.title)} screenshot" data-action="open-lightbox" data-src="${escapeHtml(g.src)}" />`;
      } else if (g.type === 'code-group') {
        bodyHtml += `<pre class="mono-block">${escapeHtml(g.lines.join('\n'))}</pre>`;
      } else {
        bodyHtml += `<p>${escapeHtml(g.value)}</p>`;
      }
    });
    if (groups.length === 0) {
      bodyHtml = `<div class="empty-state">This guide doesn't have any steps yet. Hit Edit to add some.</div>`;
    }

    container.innerHTML = `
      <div class="page">
        <a href="#/" class="back-link">${icon('chevron-left', 14)} All guides</a>
        <div class="guide-head">
          <div>
            <p class="eyebrow">${escapeHtml(guide.category.toUpperCase())}${guide.custom ? ' &middot; CUSTOM' : ''}</p>
            <h1>${escapeHtml(guide.title)}</h1>
          </div>
          <div class="guide-head-actions">
            ${!guide.custom && guide.editedAt ? `<button class="icon-btn danger" data-action="reset-guide" title="Reset to original workbook content">${icon('rotate-ccw', 15)}</button>` : ''}
            <button class="edit-btn" data-action="enter-edit">${icon('pencil', 14)} Edit</button>
          </div>
        </div>
        ${guide.editedAt ? `<p class="edited-note">${guide.custom ? 'Created' : 'Last edited'} ${new Date(guide.editedAt).toLocaleString()}</p>` : '<div style="margin-bottom:24px;"></div>'}
        <div class="guide-body">${bodyHtml}</div>
      </div>
      ${lightboxSrc ? `
        <div class="lightbox" data-action="close-lightbox">
          <button class="close-x" data-action="close-lightbox">${icon('x', 26)}</button>
          <img src="${escapeHtml(lightboxSrc)}" alt="" />
        </div>
      ` : ''}
    `;

    container.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', () => {
        const action = el.getAttribute('data-action');
        if (action === 'enter-edit') {
          mode = 'edit';
          render();
        } else if (action === 'reset-guide') {
          if (confirm('Reset this guide back to the original workbook content? Your edits will be lost.')) {
            resetGuide(guide.id);
          }
        } else if (action === 'open-lightbox') {
          lightboxSrc = el.getAttribute('data-src');
          render();
        } else if (action === 'close-lightbox') {
          lightboxSrc = null;
          render();
        }
      });
    });
  }

  activeGuidesRerender = () => {
    if (mode === 'view') render();
  };
  render();

  currentCleanup = () => {
    activeGuidesRerender = null;
  };
}

// ---------------------------------------------------------------------------
// Page: Pending Case Board
// ---------------------------------------------------------------------------

function mountCaseTracker(container) {
  let allCases = [];
  let showForm = false;
  let filters = { status: 'Pending', caseType: 'All', dateRange: 'today', customDate: todayStr(), search: '' };
  let statusFormValue = 'Pending';
  let modalCase = null; // { caseId, caseNumber, nextStatus, history }

  container.innerHTML = `
    <div class="page wide">
      <div class="case-head">
        <div>
          <p class="eyebrow">DIC PENDING CASE BOARD</p>
          <h1>Log Pull &middot; DF &middot; Patch tracker</h1>
          <p class="page-desc">Log any case you're working on so the team knows what's pending. Mark it Done when it's finished &mdash; every status change is signed with the agent's name.</p>
        </div>
        <button class="log-case-btn" id="toggle-form-btn">${icon('list-plus', 16)} Log a case</button>
      </div>

      ${!FIREBASE_ENABLED ? `
        <div class="local-mode-banner">
          Running in local mode &mdash; cases are only saved on this device/browser. Add your Firebase config in <code>firebase-config.js</code> to sync and save cases for the whole team.
        </div>
      ` : ''}

      <div id="case-form-slot"></div>
      <div id="zero-pending-slot"></div>
      <div id="case-filters-slot"></div>
      <div id="case-list-slot"></div>
    </div>
    <div id="case-modal-slot"></div>
  `;

  document.getElementById('toggle-form-btn').addEventListener('click', () => {
    showForm = !showForm;
    renderForm();
  });

  function renderForm() {
    const slot = document.getElementById('case-form-slot');
    if (!showForm) {
      slot.innerHTML = '';
      return;
    }
    statusFormValue = 'Pending';
    slot.innerHTML = `
      <form class="case-form" id="case-form">
        <div class="form-grid">
          <div>
            <label class="field-label">CASE TYPE</label>
            <select class="select-input" id="f-case-type">
              ${CASE_TYPES.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
            </select>
          </div>
          <div id="f-other-wrap" style="display:none;">
            <label class="field-label">SPECIFY TYPE</label>
            <input class="text-input" id="f-case-type-other" placeholder="e.g. Register Lag Patch" />
          </div>
          <div>
            <label class="field-label">CASE NUMBER</label>
            <input class="text-input" id="f-case-number" placeholder="e.g. 12345678" />
          </div>
          <div>
            <label class="field-label">SITE / STORE NAME</label>
            <input class="text-input" id="f-name" placeholder="e.g. Kelly's 109 / Marathon" />
          </div>
          <div>
            <label class="field-label">CALLBACK INFO</label>
            <input class="text-input" id="f-callback" placeholder="Number / contact name" />
          </div>
          <div>
            <label class="field-label">STATUS</label>
            <div class="status-toggle-row">
              <button type="button" class="status-toggle pending-active" data-status="Pending" id="f-status-pending">Pending</button>
              <button type="button" class="status-toggle" data-status="Done" id="f-status-done">Done</button>
            </div>
          </div>
        </div>
        <div class="editor-field">
          <label class="field-label">NOTES (OPTIONAL)</label>
          <textarea class="text-area" id="f-notes" rows="2"></textarea>
        </div>
        <div class="form-footer">
          <div class="agent-field">
            <label class="field-label accent">YOUR NAME (AGENT LOGGING THIS)</label>
            <input class="text-input" id="f-agent" placeholder="Who's submitting this?" />
          </div>
          <button type="submit" class="btn-primary">${icon('send', 14)} Submit case</button>
        </div>
        <p class="form-error" id="f-error" style="display:none;"></p>
      </form>
    `;

    const caseTypeSelect = document.getElementById('f-case-type');
    const otherWrap = document.getElementById('f-other-wrap');
    caseTypeSelect.addEventListener('change', () => {
      otherWrap.style.display = caseTypeSelect.value === 'Other' ? 'block' : 'none';
    });

    const pendingBtn = document.getElementById('f-status-pending');
    const doneBtn = document.getElementById('f-status-done');
    pendingBtn.addEventListener('click', () => {
      statusFormValue = 'Pending';
      pendingBtn.classList.add('pending-active');
      doneBtn.classList.remove('done-active');
    });
    doneBtn.addEventListener('click', () => {
      statusFormValue = 'Done';
      doneBtn.classList.add('done-active');
      pendingBtn.classList.remove('pending-active');
    });

    document.getElementById('case-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('f-error');
      errorEl.style.display = 'none';

      const caseType = caseTypeSelect.value;
      const caseTypeOther = document.getElementById('f-case-type-other').value.trim();
      const caseNumber = document.getElementById('f-case-number').value.trim();
      const name = document.getElementById('f-name').value.trim();
      const callbackInfo = document.getElementById('f-callback').value.trim();
      const notes = document.getElementById('f-notes').value.trim();
      const agent = document.getElementById('f-agent').value.trim();

      if (caseType === 'Other' && !caseTypeOther) {
        errorEl.textContent = 'Enter a case type since you chose "Other".';
        errorEl.style.display = 'block';
        return;
      }
      if (!caseNumber) {
        errorEl.textContent = 'Case number is required.';
        errorEl.style.display = 'block';
        return;
      }
      if (!agent) {
        errorEl.textContent = 'Enter your name so the team knows who logged this case.';
        errorEl.style.display = 'block';
        return;
      }

      await addCase({ caseType, caseTypeOther, caseNumber, callbackInfo, name, status: statusFormValue, agent, notes });
      showForm = false;
      renderForm();
    });
  }

  function renderZeroPendingBanner() {
    const slot = document.getElementById('zero-pending-slot');
    const pendingTotal = allCases.filter((c) => c.status === 'Pending').length;
    slot.innerHTML =
      pendingTotal === 0
        ? `<div class="zero-pending-banner">${icon('check-circle', 18)} No pending cases right now &mdash; board is clear.</div>`
        : '';
  }

  function renderFilters() {
    const slot = document.getElementById('case-filters-slot');
    slot.innerHTML = `
      <div class="filter-bar">
        <div class="seg-group" id="status-seg">
          ${['All', 'Pending', 'Done'].map((s) => `<button class="seg-btn ${filters.status === s ? 'active' : ''}" data-status="${s}">${s}</button>`).join('')}
        </div>
        <select class="select-input" id="filter-case-type" style="width:auto;">
          <option value="All">All case types</option>
          ${CASE_TYPES.map((t) => `<option value="${escapeHtml(t)}" ${filters.caseType === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
        </select>
        <div class="seg-group" id="date-seg">
          ${[['today', 'Today'], ['week', 'Last 7 days'], ['all', 'All dates'], ['custom', 'Pick date']]
            .map(([val, label]) => `<button class="seg-btn ${filters.dateRange === val ? 'active' : ''}" data-date="${val}">${label}</button>`)
            .join('')}
        </div>
        ${filters.dateRange === 'custom' ? `<input type="date" class="select-input" id="filter-custom-date" style="width:auto;" value="${filters.customDate}" />` : ''}
        <div class="filter-search">
          ${icon('search', 13)}
          <input type="text" id="filter-search-input" placeholder="Case #, name, agent..." value="${escapeHtml(filters.search)}" />
        </div>
      </div>
    `;

    slot.querySelectorAll('#status-seg .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        filters.status = btn.getAttribute('data-status');
        renderFilters();
        renderList();
      });
    });
    document.getElementById('filter-case-type').addEventListener('change', (e) => {
      filters.caseType = e.target.value;
      renderList();
    });
    slot.querySelectorAll('#date-seg .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        filters.dateRange = btn.getAttribute('data-date');
        renderFilters();
        renderList();
      });
    });
    const customDateInput = document.getElementById('filter-custom-date');
    if (customDateInput) {
      customDateInput.addEventListener('change', (e) => {
        filters.customDate = e.target.value;
        renderList();
      });
    }
    document.getElementById('filter-search-input').addEventListener('input', (e) => {
      filters.search = e.target.value;
      renderList();
    });
  }

  function getFiltered() {
    return allCases.filter((c) => {
      if (filters.status !== 'All' && c.status !== filters.status) return false;
      if (filters.caseType !== 'All' && c.caseType !== filters.caseType) return false;

      const created = c.createdAt ? c.createdAt.slice(0, 10) : '';
      if (filters.dateRange === 'today' && created !== todayStr()) return false;
      if (filters.dateRange === 'custom' && created !== filters.customDate) return false;
      if (filters.dateRange === 'week') {
        const d = new Date(c.createdAt);
        const now = new Date();
        const diffDays = (now - d) / (1000 * 60 * 60 * 24);
        if (diffDays > 7 || diffDays < 0) return false;
      }

      if (filters.search.trim()) {
        const q = filters.search.trim().toLowerCase();
        const hay = `${c.caseNumber} ${c.name} ${c.callbackInfo} ${c.createdBy} ${c.caseTypeOther || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderList() {
    const slot = document.getElementById('case-list-slot');
    const filtered = getFiltered();

    if (filtered.length === 0) {
      slot.innerHTML = `<div class="empty-state">No cases match these filters.</div>`;
      return;
    }

    const grouped = new Map();
    filtered.forEach((c) => {
      const day = c.createdAt ? c.createdAt.slice(0, 10) : 'unknown';
      if (!grouped.has(day)) grouped.set(day, []);
      grouped.get(day).push(c);
    });
    const days = Array.from(grouped.keys()).sort((a, b) => (a < b ? 1 : -1));

    let html = '';
    days.forEach((day) => {
      const items = grouped.get(day);
      html += `<div class="date-group"><h3>${escapeHtml(fmtDateHeading(day).toUpperCase())} &middot; ${items.length} case${items.length > 1 ? 's' : ''}</h3>`;
      items.forEach((c) => {
        const nextStatus = c.status === 'Pending' ? 'Done' : 'Pending';
        html += `
          <div class="case-row" data-case-id="${c.id}">
            <div class="case-row-top">
              <div class="case-row-info">
                <div class="case-badges">
                  <span class="status-badge ${c.status === 'Pending' ? 'pending' : 'done'}">${c.status}</span>
                  <span class="case-type-tag">${escapeHtml(c.caseType === 'Other' ? c.caseTypeOther : c.caseType)}</span>
                </div>
                <h4>${escapeHtml(c.name || 'Unnamed site')}</h4>
                <div class="case-meta">
                  <span>${icon('hash', 12)} ${escapeHtml(c.caseNumber)}</span>
                  ${c.callbackInfo ? `<span>${icon('phone', 12)} ${escapeHtml(c.callbackInfo)}</span>` : ''}
                  <span>${icon('user', 12)} logged by ${escapeHtml(c.createdBy)}</span>
                  <span>${icon('clock', 12)} ${new Date(c.createdAt).toLocaleString()}</span>
                </div>
                ${c.notes ? `<p class="case-notes">&ldquo;${escapeHtml(c.notes)}&rdquo;</p>` : ''}
              </div>
              <div class="case-row-actions">
                <button class="mark-btn ${nextStatus === 'Done' ? 'to-done' : 'to-pending'}" data-action="open-status-modal" data-next="${nextStatus}">Mark ${nextStatus}</button>
                <button class="icon-btn danger" data-action="delete-case" title="Delete">${icon('trash', 13)}</button>
              </div>
            </div>
            ${
              c.history && c.history.length > 0
                ? `
              <button class="history-toggle" data-action="toggle-history">
                ${icon('chevron-down', 12)} ${c.history.length} update${c.history.length > 1 ? 's' : ''}
              </button>
              <ul class="history-list" style="display:none;">
                ${c.history
                  .map((h) => `<li>${new Date(h.timestamp).toLocaleString()} &mdash; ${escapeHtml(h.status)} by ${escapeHtml(h.agent)}${h.note ? ` (${escapeHtml(h.note)})` : ''}</li>`)
                  .join('')}
              </ul>
            `
                : ''
            }
          </div>
        `;
      });
      html += `</div>`;
    });

    slot.innerHTML = html;

    slot.querySelectorAll('.case-row').forEach((row) => {
      const caseId = row.getAttribute('data-case-id');
      const c = allCases.find((x) => x.id === caseId);

      const historyToggle = row.querySelector('[data-action="toggle-history"]');
      if (historyToggle) {
        historyToggle.addEventListener('click', () => {
          const list = row.querySelector('.history-list');
          const expanded = list.style.display !== 'none';
          list.style.display = expanded ? 'none' : 'block';
          historyToggle.classList.toggle('expanded', !expanded);
        });
      }

      const markBtn = row.querySelector('[data-action="open-status-modal"]');
      markBtn.addEventListener('click', () => {
        modalCase = { caseId, caseNumber: c.caseNumber, nextStatus: markBtn.getAttribute('data-next'), history: c.history };
        renderModal();
      });

      row.querySelector('[data-action="delete-case"]').addEventListener('click', () => {
        if (confirm('Delete this case entry?')) deleteCase(caseId);
      });
    });
  }

  function renderModal() {
    const slot = document.getElementById('case-modal-slot');
    if (!modalCase) {
      slot.innerHTML = '';
      return;
    }
    slot.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-box">
          <div class="modal-head">
            <h3>Mark case ${escapeHtml(modalCase.caseNumber)} as ${escapeHtml(modalCase.nextStatus)}</h3>
            <button data-action="close-modal">${icon('x', 18)}</button>
          </div>
          <label class="field-label accent">YOUR NAME</label>
          <input class="text-input" id="modal-agent" placeholder="Who's making this update?" style="margin-bottom:12px;" autofocus />
          <label class="field-label">NOTE (OPTIONAL)</label>
          <input class="text-input" id="modal-note" placeholder="Any context for this update?" style="margin-bottom:12px;" />
          <p class="form-error" id="modal-error" style="display:none;"></p>
          <div class="modal-actions">
            <button class="btn-secondary" data-action="close-modal">Cancel</button>
            <button class="btn-primary" id="modal-confirm">Confirm ${escapeHtml(modalCase.nextStatus)}</button>
          </div>
        </div>
      </div>
    `;

    const close = () => {
      modalCase = null;
      renderModal();
    };
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') close();
    });
    slot.querySelectorAll('[data-action="close-modal"]').forEach((el) => el.addEventListener('click', close));

    document.getElementById('modal-confirm').addEventListener('click', async () => {
      const agent = document.getElementById('modal-agent').value.trim();
      const note = document.getElementById('modal-note').value.trim();
      if (!agent) {
        const err = document.getElementById('modal-error');
        err.textContent = 'Enter your name to confirm this update.';
        err.style.display = 'block';
        return;
      }
      await updateCaseStatus(modalCase.caseId, modalCase.history, { status: modalCase.nextStatus, agent, note });
      close();
    });
  }

  const unsub = subscribeCases((cases) => {
    allCases = cases;
    renderZeroPendingBanner();
    renderList();
  });

  renderForm();
  renderFilters();
  renderZeroPendingBanner();
  renderList();
  renderModal();

  currentCleanup = () => {
    unsub();
  };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

renderShell();
subscribeGuides((guides) => {
  latestGuides = guides;
  renderSidebarNav();
  if (activeGuidesRerender) activeGuidesRerender();
});
subscribeCases((cases) => {
  latestPendingCount = cases.filter((c) => c.status === 'Pending').length;
  renderSidebarNav();
});
window.addEventListener('hashchange', onRouteChange);
onRouteChange();
