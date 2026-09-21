// Pending Case Board data layer. Uses Firestore in real time if
// firebase-config.js has a real project key; otherwise falls back to this
// browser's localStorage so the app still works fully offline.

const CASE_LOCAL_KEY = 'dic_pending_cases_v1';
const caseBus = new EventTarget();

const CASE_TYPES = [
  'Log Pull',
  'DF',
  'Patch',
  'Malformed Batch',
  '0 Byte BatchClose',
  '0 Byte BatchConfig',
  'JIRA Ticket',
  'Other',
];

let firestoreDb = null;
if (typeof FIREBASE_ENABLED !== 'undefined' && FIREBASE_ENABLED && typeof firebase !== 'undefined') {
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    firestoreDb = firebase.firestore();
  } catch (e) {
    console.error('Firebase init failed, falling back to local storage:', e);
    firestoreDb = null;
  }
}

function caseUid() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function readLocalCases() {
  try {
    const raw = localStorage.getItem(CASE_LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function writeLocalCases(cases) {
  localStorage.setItem(CASE_LOCAL_KEY, JSON.stringify(cases));
  caseBus.dispatchEvent(new CustomEvent('change'));
}

/** Subscribes to the live list of cases, newest first. Returns an unsubscribe fn. */
function subscribeCases(callback) {
  if (firestoreDb) {
    const unsub = firestoreDb
      .collection('dicCases')
      .orderBy('createdAt', 'desc')
      .onSnapshot(
        (snap) => {
          const cases = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
          callback(cases);
        },
        (err) => {
          console.error('Firestore subscribe error:', err);
          callback([]);
        }
      );
    return unsub;
  }
  const emit = () => {
    const cases = readLocalCases().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    callback(cases);
  };
  emit();
  const handler = () => emit();
  caseBus.addEventListener('change', handler);
  window.addEventListener('storage', handler);
  return () => {
    caseBus.removeEventListener('change', handler);
    window.removeEventListener('storage', handler);
  };
}

/** Creates a new case entry. `agent` is required so we know who logged it. */
async function addCase(fields) {
  const now = new Date().toISOString();
  const payload = {
    caseType: fields.caseType,
    caseTypeOther: fields.caseTypeOther || '',
    caseNumber: fields.caseNumber,
    callbackInfo: fields.callbackInfo,
    name: fields.name,
    status: fields.status,
    notes: fields.notes || '',
    createdAt: now,
    updatedAt: now,
    createdBy: fields.agent,
    history: [{ status: fields.status, agent: fields.agent, timestamp: now, note: 'Case created' }],
  };
  if (firestoreDb) {
    await firestoreDb.collection('dicCases').add(payload);
    return;
  }
  const cases = readLocalCases();
  cases.push(Object.assign({ id: caseUid() }, payload));
  writeLocalCases(cases);
}

/**
 * Updates a case's status (Pending <-> Done). Requires the agent's name --
 * every status change is attributed so the team knows who touched it.
 * Pass the case's current `history` array so it can be appended correctly.
 */
async function updateCaseStatus(id, existingHistory, change) {
  const now = new Date().toISOString();
  const historyEntry = { status: change.status, agent: change.agent, timestamp: now, note: change.note || '' };
  const nextHistory = (existingHistory || []).concat([historyEntry]);

  if (firestoreDb) {
    await firestoreDb.collection('dicCases').doc(id).update({
      status: change.status,
      updatedAt: now,
      lastTouchedBy: change.agent,
      history: nextHistory,
    });
    return;
  }
  const cases = readLocalCases();
  const idx = cases.findIndex((c) => c.id === id);
  if (idx === -1) return;
  cases[idx] = Object.assign({}, cases[idx], {
    status: change.status,
    updatedAt: now,
    lastTouchedBy: change.agent,
    history: nextHistory,
  });
  writeLocalCases(cases);
}

async function deleteCase(id) {
  if (firestoreDb) {
    await firestoreDb.collection('dicCases').doc(id).delete();
    return;
  }
  const cases = readLocalCases().filter((c) => c.id !== id);
  writeLocalCases(cases);
}
