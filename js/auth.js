/* ============================================================
   Streamly — Authentication Module
   ============================================================ */

// ── Proveedor de Google ─────────────────────────────────────
const googleProvider = new firebase.auth.GoogleAuthProvider();

// ── Estado de autenticación ─────────────────────────────────
let currentUser = null;

/**
 * Observer de Firebase Auth — detecta login/logout
 */
if (auth) {
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      currentUser = user;
      await showApp(user);
    } else {
      currentUser = null;
      showLogin();
    }
  });
} else {
  console.error('❌ Firebase Auth no disponible');
}

/**
 * Muestra la app principal y oculta login
 */
async function showApp(user) {
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('registerPage').classList.add('hidden');
  document.getElementById('appLayout').classList.remove('hidden');

  // Actualizar UI del usuario
  const initial = (user.displayName || user.email || 'U')[0].toUpperCase();
  document.getElementById('userAvatar').textContent = initial;
  document.getElementById('userName').textContent = user.displayName || 'Admin';
  document.getElementById('userEmail').textContent = user.email;

  // Actualizar fecha del header
  updateHeaderDate();

  // Cargar datos del dashboard (con guard para Firestore)
  try {
    await loadAllData();
  } catch (error) {
    console.error('Error cargando datos iniciales:', error);
    showToast('Error conectando con la base de datos. Verifica tu conexión.', 'warning');
  }
}

/**
 * Muestra la pantalla de login
 */
function showLogin() {
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('registerPage').classList.add('hidden');
  document.getElementById('appLayout').classList.add('hidden');
}

// ── Formulario de Login ─────────────────────────────────────
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');
  const errorDiv = document.getElementById('loginError');
  const errorMsg = document.getElementById('loginErrorMsg');

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Ingresando...';
  errorDiv.classList.remove('show');

  try {
    await auth.signInWithEmailAndPassword(email, password);
    showToast('¡Bienvenido!', 'success');
  } catch (error) {
    console.error('Login error:', error);
    const msg = getAuthErrorMessage(error.code, 'Error al iniciar sesión');
    errorMsg.textContent = msg;
    errorDiv.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Iniciar Sesión';
  }
});

// ── Formulario de Registro ──────────────────────────────────
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const businessName = document.getElementById('regBusinessName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const btn = document.getElementById('registerBtn');
  const errorDiv = document.getElementById('registerError');
  const errorMsg = document.getElementById('registerErrorMsg');

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creando cuenta...';
  errorDiv.classList.remove('show');

  try {
    // Crear usuario en Firebase Auth
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    
    // Actualizar displayName
    await cred.user.updateProfile({ displayName: businessName });

    // Guardar datos adicionales en Firestore (con try/catch aislado)
    try {
      await db.collection('usuarios').doc(cred.user.uid).set({
        email: email,
        nombre_negocio: businessName,
        creado_en: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (firestoreError) {
      console.warn('⚠️ Usuario creado en Auth pero Firestore no disponible:', firestoreError.message);
    }

    showToast('¡Cuenta creada exitosamente!', 'success');
  } catch (error) {
    console.error('Register error:', error);
    const msg = getAuthErrorMessage(error.code, 'Error al crear la cuenta');
    errorMsg.textContent = msg;
    errorDiv.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Crear Cuenta';
  }
});

// ── Toggle Login/Register ───────────────────────────────────
document.getElementById('showRegister').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('loginError').classList.remove('show');
  document.getElementById('registerError').classList.remove('show');
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('registerPage').classList.remove('hidden');
});

document.getElementById('showLogin').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('loginError').classList.remove('show');
  document.getElementById('registerError').classList.remove('show');
  document.getElementById('registerPage').classList.add('hidden');
  document.getElementById('loginPage').classList.remove('hidden');
});

// ── Google Sign-In ──────────────────────────────────────────
async function signInWithGoogle() {
  try {
    const result = await auth.signInWithPopup(googleProvider);
    const user = result.user;

    // Si es usuario nuevo, guardar datos en Firestore
    const isNewUser = result.additionalUserInfo?.isNewUser;
    if (isNewUser) {
      try {
        await db.collection('usuarios').doc(user.uid).set({
          email: user.email,
          nombre_negocio: user.displayName || 'Mi Negocio',
          creado_en: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (firestoreError) {
        console.warn('⚠️ Usuario Google creado pero Firestore no disponible:', firestoreError.message);
      }
    }

    showToast('¡Bienvenido con Google!', 'success');
  } catch (error) {
    // Ignorar cancelaciones silenciosas
    if (error.code === 'auth/cancelled-popup-request' || 
        error.code === 'auth/popup-closed-by-user') {
      return;
    }
    console.error('Google sign-in error:', error);
    const msg = getAuthErrorMessage(error.code, 'Error al iniciar sesión con Google');
    showToast(msg, 'error');
  }
}

// ── Sign Out ────────────────────────────────────────────────
async function signOut() {
  try {
    await auth.signOut();
    showToast('Sesión cerrada', 'info');
  } catch (error) {
    console.error('Sign out error:', error);
    showToast('Error al cerrar sesión', 'error');
  }
}

// ── Mensajes de error centralizados ─────────────────────────
function getAuthErrorMessage(code, fallback) {
  const messages = {
    'auth/user-not-found': 'No existe una cuenta con este correo',
    'auth/wrong-password': 'Contraseña incorrecta',
    'auth/invalid-email': 'Correo electrónico inválido',
    'auth/too-many-requests': 'Demasiados intentos. Intenta más tarde',
    'auth/invalid-credential': 'Credenciales inválidas. Verifica correo y contraseña',
    'auth/email-already-in-use': 'Este correo ya está registrado',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres',
    'auth/popup-blocked': 'El navegador bloqueó la ventana. Permite popups e intenta de nuevo',
    'auth/network-request-failed': 'Error de red. Verifica tu conexión a internet',
    'auth/internal-error': 'Error interno. Intenta de nuevo'
  };
  return messages[code] || fallback;
}

console.log('🔐 Módulo de autenticación cargado');
