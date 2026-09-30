/* Облачное хранилище для «Слайд-учёта»: вход по почте и паролю (Firebase Auth)
   и база Firestore с офлайн-кэшем. Если в config.js нет настроек, файл ничего не делает
   и приложение хранит данные только на этом устройстве. */
const cfg = window.FIREBASE_CONFIG;
const done = v => { if (window.__resolveDb) { window.__resolveDb(v); window.__resolveDb = null; } };

if (!cfg) {
  done(null);
} else {
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import('./vendor/firebase-app.js'),
      import('./vendor/firebase-auth.js'),
      import('./vendor/firebase-firestore.js'),
    ]);
    const app = appMod.initializeApp(cfg);
    const auth = authMod.getAuth(app);

    // Persistent cache: data opens without internet, writes made offline are sent later by Firestore itself.
    let fs;
    try {
      fs = fsMod.initializeFirestore(app, {
        localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
      });
    } catch (e) {
      fs = fsMod.getFirestore(app);
    }

    const report = e => {
      console.error(e);
      if (window.__toast) {
        window.__toast('Не сохранилось: ' + (e && e.code === 'permission-denied'
          ? 'нет доступа, проверь правила Firestore' : ((e && e.code) || 'ошибка')));
      }
    };
    const wrap = d => ({ id: d.id, exists: d.exists(), data: () => d.data() });

    // The app talks to a tiny doc/collection interface; every user gets a private subtree users/<uid>/…
    const makeDb = uid => {
      const base = 'users/' + uid + '/';
      return {
        doc(path) {
          const ref = fsMod.doc(fs, base + path);
          return {
            // resolve at once: Firestore keeps the write locally and syncs it when it can
            set(body) { fsMod.setDoc(ref, JSON.parse(JSON.stringify(body))).catch(report); return Promise.resolve(); },
            delete() { fsMod.deleteDoc(ref).catch(report); return Promise.resolve(); },
            onSnapshot(cb, err) {
              return fsMod.onSnapshot(ref, { includeMetadataChanges: true }, s => cb(wrap(s)), err);
            },
          };
        },
        collection(name) {
          const ref = fsMod.collection(fs, base + name);
          return {
            onSnapshot(cb, err) {
              return fsMod.onSnapshot(ref, { includeMetadataChanges: true }, s => {
                if (window.__onPending) window.__onPending(s.metadata.hasPendingWrites);
                cb({ docs: s.docs.map(wrap), size: s.size, empty: s.empty });
              }, err);
            },
          };
        },
      };
    };

    window.__auth = {
      signIn: (email, password) => authMod.signInWithEmailAndPassword(auth, email, password),
      signUp: (email, password) => authMod.createUserWithEmailAndPassword(auth, email, password),
      reset: email => authMod.sendPasswordResetEmail(auth, email),
      signOut: () => authMod.signOut(auth),
    };

    let resolved = false;
    authMod.onAuthStateChanged(auth, user => {
      if (window.__onAuth) window.__onAuth(user ? { email: user.email, uid: user.uid } : null);
      if (user && !resolved) { resolved = true; done(makeDb(user.uid)); }
    });
  } catch (e) {
    console.error('Облачное хранилище не запустилось', e);
    done(null);
  }
}
