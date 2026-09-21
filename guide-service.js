// Merges the baked-in guide content (data.js) with:
//  1. any local edits to those guides (overrides), and
//  2. any brand-new guides someone created from scratch in the app.
// Both are saved in this browser's localStorage -- no backend needed.

const GUIDE_LOCAL_KEY = 'dic_guide_overrides_v1';
const CUSTOM_GUIDES_KEY = 'dic_custom_guides_v1';
const guideBus = new EventTarget();

function readGuideOverrides() {
  try {
    const raw = localStorage.getItem(GUIDE_LOCAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function writeGuideOverrides(overrides) {
  localStorage.setItem(GUIDE_LOCAL_KEY, JSON.stringify(overrides));
  guideBus.dispatchEvent(new CustomEvent('change'));
}

function readCustomGuides() {
  try {
    const raw = localStorage.getItem(CUSTOM_GUIDES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function writeCustomGuides(guides) {
  localStorage.setItem(CUSTOM_GUIDES_KEY, JSON.stringify(guides));
  guideBus.dispatchEvent(new CustomEvent('change'));
}

function slugify(text) {
  return (
    String(text)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'guide'
  );
}

function isCustomId(id) {
  return readCustomGuides().some((g) => g.id === id);
}

function getGuides() {
  const overrides = readGuideOverrides();
  const defaults = GUIDES_DEFAULT.map((g) => (overrides[g.id] ? Object.assign({}, g, overrides[g.id]) : g));
  const custom = readCustomGuides();
  return defaults.concat(custom);
}

function getGuide(id) {
  return getGuides().find((g) => g.id === id);
}

/** Edits an existing guide -- works for both workbook guides and custom ones. */
function saveGuide(id, updated) {
  if (isCustomId(id)) {
    const customGuides = readCustomGuides();
    const idx = customGuides.findIndex((g) => g.id === id);
    if (idx === -1) return;
    customGuides[idx] = Object.assign({}, customGuides[idx], updated, { editedAt: new Date().toISOString() });
    writeCustomGuides(customGuides);
    return;
  }
  const overrides = readGuideOverrides();
  overrides[id] = Object.assign({}, updated, { editedAt: new Date().toISOString() });
  writeGuideOverrides(overrides);
}

/** Creates a brand-new guide from scratch. Returns its new id. */
function createGuide({ title, category, blocks }) {
  const base = slugify(title || 'new-guide');
  const customGuides = readCustomGuides();
  const existingIds = new Set(GUIDES_DEFAULT.map((g) => g.id).concat(customGuides.map((g) => g.id)));
  let id = base;
  let n = 2;
  while (existingIds.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  const now = new Date().toISOString();
  const guide = {
    id,
    title: title && title.trim() ? title.trim() : 'Untitled guide',
    category: category && category.trim() ? category.trim() : 'Custom',
    blocks: blocks || [],
    custom: true,
    createdAt: now,
    editedAt: now,
  };
  customGuides.push(guide);
  writeCustomGuides(customGuides);
  return id;
}

/** Only works for custom (user-created) guides -- workbook guides can only be reset, not deleted. */
function deleteGuide(id) {
  const customGuides = readCustomGuides().filter((g) => g.id !== id);
  writeCustomGuides(customGuides);
}

/** Removes local edits to a workbook guide, restoring its original content. */
function resetGuide(id) {
  const overrides = readGuideOverrides();
  delete overrides[id];
  writeGuideOverrides(overrides);
}

// Returns an unsubscribe function.
function subscribeGuides(callback) {
  const emit = () => callback(getGuides());
  emit();
  const handler = () => emit();
  guideBus.addEventListener('change', handler);
  window.addEventListener('storage', handler);
  return () => {
    guideBus.removeEventListener('change', handler);
    window.removeEventListener('storage', handler);
  };
}
