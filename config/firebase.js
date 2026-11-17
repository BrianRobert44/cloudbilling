const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const path = require("path");
const fs = require("fs");

let firestoreInstance = null;
let isFirebaseInitialized = false;

function initFirebase() {
  if (isFirebaseInitialized && firestoreInstance) {
    return firestoreInstance;
  }

  try {
    const configuredPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./serviceAccountKey.json";
    const keyPath = path.isAbsolute(configuredPath)
      ? configuredPath
      : (fs.existsSync(path.resolve(__dirname, "..", configuredPath))
          ? path.resolve(__dirname, "..", configuredPath)
          : path.resolve(process.cwd(), configuredPath));

    let credential;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      let serviceAccount;
      try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      } catch (e) {
        const decoded = Buffer.from(
          process.env.FIREBASE_SERVICE_ACCOUNT,
          "base64"
        ).toString("utf8");
        serviceAccount = JSON.parse(decoded);
      }
      credential = cert(serviceAccount);
    } else if (fs.existsSync(keyPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
      credential = cert(serviceAccount);
    }

    if (credential) {
      if (!getApps().length) {
        initializeApp({ credential });
      }
      firestoreInstance = getFirestore();
      firestoreInstance.settings({ ignoreUndefinedProperties: true });
      isFirebaseInitialized = true;
      console.log("Firebase Firestore successfully initialized!");
    } else {
      console.warn(
        "WARNING: Firebase credentials not found. Place 'serviceAccountKey.json' in backend/ or set FIREBASE_SERVICE_ACCOUNT."
      );
    }
  } catch (error) {
    console.error("Firebase Initialization Error:", error.message);
  }

  return firestoreInstance;
}

initFirebase();

module.exports = {
  getFirestore: () => {
    if (!firestoreInstance) {
      return initFirebase();
    }
    return firestoreInstance;
  },
  getAuth: () => {
    if (!isFirebaseInitialized) {
      initFirebase();
    }
    return getAuth();
  },
  isConfigured: () => isFirebaseInitialized,
};
