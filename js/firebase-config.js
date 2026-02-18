/* ============================================================
   Streamly — Firebase Configuration
   ============================================================
   
   INSTRUCCIONES:
   1. Ve a https://console.firebase.google.com/
   2. Crea un nuevo proyecto o selecciona uno existente
   3. En "Configuración del proyecto" > "General" → agrega una app web
   4. Copia la configuración y reemplaza los valores de abajo
   5. En "Authentication" → habilita "Correo/Contraseña" y "Google"
   6. En "Firestore Database" → crea una base de datos
   7. IMPORTANTE → Habilita la API de Firestore en Google Cloud:
      https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=accf-8b065

   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyBU-GbRvIie3n5jepmRurFjjyRCWQiqN0U",
  authDomain: "accf-8b065.firebaseapp.com",
  projectId: "accf-8b065",
  storageBucket: "accf-8b065.firebasestorage.app",
  messagingSenderId: "98637958746",
  appId: "1:98637958746:web:ed4d82044fa3c95f2ad263",
  measurementId: "G-KD0JN83598"
};

// ── Inicialización de Firebase ──────────────────────────────
let auth = null;
let db   = null;
let firebaseReady = false;

try {
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db   = firebase.firestore();

  // Persistencia offline: la app funciona incluso sin conexión a Firestore
  db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn('⚠️ Persistencia offline no disponible: múltiples tabs abiertas.');
    } else if (err.code === 'unimplemented') {
      console.warn('⚠️ Persistencia offline no soportada en este navegador.');
    }
  });

  firebaseReady = true;
  console.log('🔥 Firebase inicializado correctamente');
} catch (error) {
  console.error('❌ Error inicializando Firebase:', error);
}
