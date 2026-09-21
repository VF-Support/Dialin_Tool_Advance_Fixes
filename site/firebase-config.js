// ---------------------------------------------------------------------------
// Your Firebase project is already filled in below, so the Pending Case
// Board saves and syncs live across everyone who opens this site, as long as
// you've created a Firestore Database in the Firebase console (see README).
//
// If you ever want to point this at a different Firebase project, or turn
// sync off entirely, edit the object below. Leaving apiKey blank switches
// the whole app back to browser-only local storage automatically.
// ---------------------------------------------------------------------------

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCmlMMfyMjqz8nzWqZybCW9r7NxNqHZu_c",
  authDomain: "dialin-tool.firebaseapp.com",
  databaseURL: "https://dialin-tool-default-rtdb.firebaseio.com",
  projectId: "dialin-tool",
  storageBucket: "dialin-tool.firebasestorage.app",
  messagingSenderId: "106163040864",
  appId: "1:106163040864:web:3e2df0f91ddb455e210905",
  measurementId: "G-25N2RXF9W6"
};

const FIREBASE_ENABLED = Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
