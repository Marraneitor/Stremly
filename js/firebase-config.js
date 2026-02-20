/* ============================================================
   Streamly — Firebase Configuration (Segura)
   ============================================================
   
   La configuración se carga desde la API serverless de Vercel
   (variables de entorno) para no exponer las claves en el código.

   INSTRUCCIONES PARA VERCEL:
   1. Ve a tu proyecto en https://vercel.com/dashboard
   2. Settings → Environment Variables
   3. Agrega cada variable (ver .env.example)
   4. Redeploy el proyecto

   INSTRUCCIONES FIREBASE:
   1. En "Authentication" → habilita "Correo/Contraseña" y "Google"
   2. En "Firestore Database" → crea una base de datos
   3. Configura las Firestore Security Rules (ver firestore.rules)
   4. En Google Cloud Console → restringe tu API Key a tu dominio

   ============================================================ */

// ── Inicialización de Firebase ──────────────────────────────
let auth = null;
let db   = null;
let firebaseReady = false;

/**
 * Carga la config de Firebase desde la API serverless o usa fallback local.
 * En producción (Vercel) se usa /api/firebase-config (env vars seguras).
 * En desarrollo local se usa la config embebida como fallback.
 */
async function initFirebase() {
  let config = null;

  // Intentar la API serverless primero (funciona si las env vars están en Vercel)
  try {
    const res = await fetch('/api/firebase-config');
    if (res.ok) {
      config = await res.json();
      console.log('🔒 Config cargada desde API segura');
    }
  } catch (_) {
    // Si falla, usar fallback
  }

  // Fallback: config embebida (para desarrollo local o si la API no está configurada)
  if (!config) {
    console.warn('⚠️ Usando config embebida como fallback.');
    config = {
      apiKey: "AIzaSyBU-GbRvIie3n5jepmRurFjjyRCWQiqN0U",
      authDomain: "accf-8b065.firebaseapp.com",
      projectId: "accf-8b065",
      storageBucket: "accf-8b065.firebasestorage.app",
      messagingSenderId: "98637958746",
      appId: "1:98637958746:web:ed4d82044fa3c95f2ad263",
      measurementId: "G-KD0JN83598"
    };
  }

  try {
    firebase.initializeApp(config);
    auth = firebase.auth();
    db   = firebase.firestore();

    // Persistencia offline (API moderna)
    db.settings({
      cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED,
      merge: true
    });

    firebaseReady = true;
    console.log('🔥 Firebase inicializado correctamente');
  } catch (error) {
    console.error('❌ Error inicializando Firebase:', error);
  }
}

// Iniciar Firebase inmediatamente
initFirebase();
