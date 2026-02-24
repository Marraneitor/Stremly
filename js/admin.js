/* ============================================================
   Streamly — Admin Panel Logic
   Reads user data from Firestore (with Auth)
   ============================================================ */

// ── State ───────────────────────────────────────────────────
let allUsers      = [];
let allAccounts   = [];
let allClients    = [];
let allMovements  = [];
let adminReady    = false;
let adminUser     = null;  // Firebase Auth user
const OWNER_EMAIL = 'yoelskygold@gmail.com';
let isOwnerSession = false;

const ADMIN_BUILD_ID = '2026-02-24-regalos-allusers-2';
console.log('🔒 Admin panel cargado — build:', ADMIN_BUILD_ID);

// ── Utility helpers (standalone) ────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/'/g,'&#39;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmtDate(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtCurrency(amount) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0
  }).format(amount || 0);
}

function daysLeft(endDate) {
  if (!endDate) return 0;
  const end = endDate instanceof Date ? new Date(endDate.getTime()) : endDate.toDate ? new Date(endDate.toDate().getTime()) : new Date(endDate);
  const now = new Date();
  now.setHours(0,0,0,0);
  end.setHours(0,0,0,0);
  return Math.ceil((end - now) / 86400000);
}

function statusBadge(days) {
  if (days <= 0) return '<span class="badge badge-expired">Vencido</span>';
  if (days <= 3) return `<span class="badge badge-warning">${days}d</span>`;
  return '<span class="badge badge-active">Activo</span>';
}

function platformTag(name) {
  const map = { 'Netflix':'netflix','Disney+':'disney','HBO Max':'hbo','Spotify':'spotify',
    'Amazon Prime':'prime','Crunchyroll':'crunchyroll','YouTube Premium':'youtube',
    'Paramount+':'paramount','Apple TV+':'apple','Star+':'disney' };
  const cls = map[name] || '';
  return `<span class="platform-tag ${cls}">${escapeHtml(name)}</span>`;
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    showAdminToast('Copiado');
  }).catch(() => {
    const t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select();
    document.execCommand('copy'); t.remove();
    showAdminToast('Copiado');
  });
}

function showAdminToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#22c55e;color:#fff;padding:10px 20px;border-radius:8px;font-size:0.875rem;font-weight:600;z-index:9999;animation:fadeIn .2s';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 2000);
}

// ── Wait for Firebase ───────────────────────────────────────
function waitForFirebaseAdmin() {
  return new Promise((resolve) => {
    const check = setInterval(() => {
      if (firebaseReady && auth && db) { clearInterval(check); resolve(); }
    }, 50);
    setTimeout(() => { clearInterval(check); resolve(); }, 10000);
  });
}

// ── Auth: Check existing session or show login ──────────────
waitForFirebaseAdmin().then(() => {
  // Show loading while checking auth
  document.getElementById('gateLoading').style.display = 'block';
  document.getElementById('gateForm').style.display = 'none';

  auth.onAuthStateChanged((user) => {
    if (user) {
      // Already logged in — go directly to admin
      adminUser = user;
      document.getElementById('adminGate').classList.add('hidden');
      document.getElementById('adminLayout').classList.add('active');
      initAdmin();
    } else {
      // Show login form
      document.getElementById('gateLoading').style.display = 'none';
      document.getElementById('gateForm').style.display = 'block';
      document.getElementById('gateMessage').textContent = 'Inicia sesión con tu cuenta de Streamly';
    }
  });
});

// ── Login with email/password ───────────────────────────────
async function adminLogin() {
  const email = document.getElementById('adminEmail').value.trim();
  const pass  = document.getElementById('adminPassword').value;
  const error = document.getElementById('gateError');

  if (!email || !pass) {
    error.textContent = 'Ingresa correo y contraseña';
    error.classList.add('show');
    return;
  }

  error.classList.remove('show');

  try {
    const cred = await auth.signInWithEmailAndPassword(email, pass);
    adminUser = cred.user;
    document.getElementById('adminGate').classList.add('hidden');
    document.getElementById('adminLayout').classList.add('active');
    initAdmin();
  } catch (err) {
    console.error('Admin login error:', err);
    const messages = {
      'auth/user-not-found': 'Usuario no encontrado',
      'auth/wrong-password': 'Contraseña incorrecta',
      'auth/invalid-email': 'Correo inválido',
      'auth/too-many-requests': 'Demasiados intentos. Intenta más tarde.',
      'auth/invalid-credential': 'Credenciales inválidas'
    };
    error.textContent = messages[err.code] || `Error: ${err.message}`;
    error.classList.add('show');
  }
}

// Allow Enter key on password input
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !document.getElementById('adminGate').classList.contains('hidden')) {
    adminLogin();
  }
});

// ── Init: Load all data from Firestore ──────────────────────
async function initAdmin() {
  showLoading(true);

  if (!db || !adminUser) {
    showLoading(false);
    document.getElementById('adminInfoBar').innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Firebase no disponible o no autenticado.';
    document.getElementById('adminInfoBar').style.display = 'flex';
    return;
  }

  // Owner detection MUST use the ID token claim (more reliable than user.email in some cases)
  let tokenEmail = '';
  try {
    const tokenResult = await adminUser.getIdTokenResult();
    tokenEmail = String(tokenResult?.claims?.email || adminUser.email || '').trim().toLowerCase();
  } catch {
    tokenEmail = String(adminUser.email || '').trim().toLowerCase();
  }

  isOwnerSession = tokenEmail === OWNER_EMAIL.toLowerCase();

  // Hide Regalos tab for non-owners; always visible for owner
  const giftTab = document.getElementById('tabGifts');
  if (giftTab && !isOwnerSession) giftTab.style.display = 'none';

  try {
    if (isOwnerSession) {
      await loadAllDataAsOwner();
    } else {
      await Promise.all([
        loadAllUsers(),
        loadAllAccounts(),
        loadAllClients(),
        loadAllMovements()
      ]);
    }

    adminReady = true;
    updateAdminStats();
    switchTab('overview');
    updateLastRefresh();
  } catch (err) {
    console.error('Admin load error:', err);
    document.getElementById('adminInfoBar').innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Error cargando datos: ${escapeHtml(err.message)}`;
    document.getElementById('adminInfoBar').style.display = 'flex';
  }

  showLoading(false);
}

function showLoading(show) {
  const el = document.getElementById('adminLoading');
  if (el) el.style.display = show ? 'flex' : 'none';
}

function updateLastRefresh() {
  const el = document.getElementById('lastRefresh');
  if (el) el.textContent = `Última actualización: ${new Date().toLocaleTimeString('es-ES')}`;
}

// ── Owner: Load ALL data via API ────────────────────────────
async function loadAllDataAsOwner() {
  try {
    const token = await adminUser.getIdToken(true);
    const res   = await fetch('/api/admin-report', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      const json = await res.json();
      if (json.ok) {
        const data = json.data;
        allUsers     = data.usuarios    || [];
        allAccounts  = data.cuentas     || [];
        allClients   = data.clientes    || [];
        allMovements = data.movimientos || [];
        console.log('[admin] datos cargados vía API (todos los usuarios)');
        return;
      }
    }
    // API not available (local dev or missing env var) — fall back to Firestore direct
    console.warn('[admin] /api/admin-report no disponible, usando Firestore directo');
  } catch (e) {
    console.warn('[admin] /api/admin-report error, fallback a Firestore:', e.message);
  }

  // Fallback: load ALL collections without uid filter (owner sees everything)
  const [usersSnap, accountsSnap, clientsSnap, movementsSnap] = await Promise.all([
    db.collection('usuarios').get(),
    db.collection('cuentas').get(),
    db.collection('clientes').get(),
    db.collection('movimientos').get(),
  ]);

  allUsers     = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  allAccounts  = accountsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  allClients   = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  allMovements = movementsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log('[admin] datos cargados vía Firestore directo (fallback)');
}

// ── Data Loaders (filtered by authenticated user's UID) ─────
async function loadAllUsers() {
  try {
    // Load the current user's profile
    const doc = await db.collection('usuarios').doc(adminUser.uid).get();
    if (doc.exists) {
      allUsers = [{ id: doc.id, ...doc.data() }];
    } else {
      // Create a virtual user entry from auth
      allUsers = [{ id: adminUser.uid, email: adminUser.email, nombre_negocio: adminUser.displayName || 'Admin' }];
    }
  } catch (e) {
    console.warn('Could not load usuarios:', e.message);
    allUsers = [{ id: adminUser.uid, email: adminUser.email, nombre_negocio: adminUser.displayName || 'Admin' }];
  }
}

async function loadAllAccounts() {
  const snap = await db.collection('cuentas').where('uid', '==', adminUser.uid).get();
  allAccounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadAllClients() {
  const snap = await db.collection('clientes').where('uid', '==', adminUser.uid).get();
  allClients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadAllMovements() {
  const snap = await db.collection('movimientos').where('uid', '==', adminUser.uid).get();
  allMovements = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Refresh ─────────────────────────────────────────────────
async function refreshAdmin() {
  if (!db) return;
  showLoading(true);
  try {
    if (isOwnerSession) {
      await loadAllDataAsOwner();
    } else {
      await Promise.all([loadAllUsers(), loadAllAccounts(), loadAllClients(), loadAllMovements()]);
    }
    adminReady = true;
    updateAdminStats();
    const activeTab = document.querySelector('.admin-tab.active')?.dataset?.tab || 'overview';
    switchTab(activeTab);
    updateLastRefresh();
    showAdminToast('Datos actualizados');
  } catch (err) {
    console.error(err);
  }
  showLoading(false);
}

// ── Stats ───────────────────────────────────────────────────
function updateAdminStats() {
  document.getElementById('statUsers').textContent      = allUsers.length;
  document.getElementById('statAccounts').textContent    = allAccounts.length;
  document.getElementById('statClients').textContent     = allClients.length;
  document.getElementById('statMovements').textContent   = allMovements.length;

  // Revenue total (from clients' prices)
  const totalRevenue = allClients.reduce((s, c) => s + (c.precio || 0), 0);
  const totalRevenueMov = allMovements.reduce((s, m) => s + (m.monto || 0), 0);
  document.getElementById('statRevenue').textContent = fmtCurrency(Math.max(totalRevenue, totalRevenueMov));

  // Revenue this month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // From clients with fecha_inicio in current month + paid
  const clientMonthRevenue = allClients.filter(c => {
    if (!c.precio || c.precio <= 0) return false;
    if (c.estado_pago !== 'pagado') return false;
    const d = c.fecha_inicio instanceof Date ? c.fecha_inicio : c.fecha_inicio?.toDate ? c.fecha_inicio.toDate() : new Date(c.fecha_inicio);
    return d >= monthStart;
  }).reduce((s, c) => s + (c.precio || 0), 0);

  // From movements
  const movMonthRevenue = allMovements.filter(m => {
    if (!m.fecha_pago) return false;
    const d = m.fecha_pago instanceof Date ? m.fecha_pago : m.fecha_pago.toDate ? m.fecha_pago.toDate() : new Date(m.fecha_pago);
    return d >= monthStart;
  }).reduce((s, m) => s + (m.monto || 0), 0);

  document.getElementById('statMonthRevenue').textContent = fmtCurrency(Math.max(clientMonthRevenue, movMonthRevenue));

  // Active clients
  const active = allClients.filter(c => daysLeft(c.fecha_fin) > 0).length;
  document.getElementById('statActiveClients').textContent = active;

  // Expired clients
  const expired = allClients.filter(c => daysLeft(c.fecha_fin) <= 0).length;
  document.getElementById('statExpiredClients').textContent = expired;

  // Update tab counts
  document.getElementById('tabCountUsers').textContent      = allUsers.length;
  document.getElementById('tabCountAccounts').textContent    = allAccounts.length;
  document.getElementById('tabCountClients').textContent     = allClients.length;
  document.getElementById('tabCountMovements').textContent   = allMovements.length;
}

// ── Tab Switching ───────────────────────────────────────────
function switchTab(tab) {
  // Update tab buttons
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.admin-tab[data-tab="${tab}"]`)?.classList.add('active');

  // Update panels
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${tab}`)?.classList.add('active');

  // Render content
  switch (tab) {
    case 'overview':  renderOverview();  break;
    case 'users':     renderUsers();     break;
    case 'accounts':  renderAccounts();  break;
    case 'clients':   renderClients();   break;
    case 'movements': renderMovements(); break;
    case 'gifts':     renderGifts();     break;
  }
}

// ── Render: Overview ────────────────────────────────────────
function renderOverview() {
  // Revenue by platform
  const revByPlatform = {};
  allClients.forEach(cl => {
    const p = cl.plataforma || 'Sin plataforma';
    if (!revByPlatform[p]) revByPlatform[p] = { clients: 0, revenue: 0 };
    revByPlatform[p].clients++;
  });
  allMovements.forEach(mv => {
    const client = allClients.find(c => c.id === mv.cliente_id);
    const p = client?.plataforma || 'Sin plataforma';
    if (!revByPlatform[p]) revByPlatform[p] = { clients: 0, revenue: 0 };
    revByPlatform[p].revenue += mv.monto || 0;
  });

  const tbody = document.getElementById('overviewPlatformBody');
  const entries = Object.entries(revByPlatform).sort((a, b) => b[1].revenue - a[1].revenue);

  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty-admin"><i class="fa-solid fa-chart-bar"></i><br>Sin datos</td></tr>';
    return;
  }

  tbody.innerHTML = entries.map(([name, data]) => `
    <tr>
      <td>${platformTag(name)}</td>
      <td>${data.clients}</td>
      <td class="money-positive">${fmtCurrency(data.revenue)}</td>
      <td>
        ${allAccounts.filter(a => a.plataforma === name).length} cuentas
      </td>
    </tr>
  `).join('');

  // Revenue by user
  const revByUser = {};
  allMovements.forEach(mv => {
    const uid = mv.uid || 'unknown';
    if (!revByUser[uid]) revByUser[uid] = { total: 0, count: 0 };
    revByUser[uid].total += mv.monto || 0;
    revByUser[uid].count++;
  });

  const tbody2 = document.getElementById('overviewUserBody');
  const userEntries = Object.entries(revByUser).sort((a, b) => b[1].total - a[1].total);

  if (userEntries.length === 0) {
    tbody2.innerHTML = '<tr><td colspan="4" class="table-empty-admin"><i class="fa-solid fa-users"></i><br>Sin datos</td></tr>';
    return;
  }

  tbody2.innerHTML = userEntries.map(([uid, data]) => {
    const user = allUsers.find(u => u.id === uid);
    return `
      <tr>
        <td>${escapeHtml(user?.nombre_negocio || user?.email || uid)}</td>
        <td class="user-email">${escapeHtml(user?.email || '—')}</td>
        <td class="money-positive">${fmtCurrency(data.total)}</td>
        <td>${data.count} pagos</td>
      </tr>
    `;
  }).join('');
}

// ── Render: Users ───────────────────────────────────────────
function renderUsers(filter = '') {
  const tbody     = document.getElementById('usersBody');
  const thActions = document.getElementById('thUserActions');
  const thColspan = isOwnerSession ? 7 : 6;

  if (thActions) thActions.style.display = isOwnerSession ? '' : 'none';

  let items = allUsers;

  if (filter) {
    const q = filter.toLowerCase();
    items = items.filter(u =>
      (u.email || '').toLowerCase().includes(q) ||
      (u.nombre_negocio || '').toLowerCase().includes(q) ||
      (u.id || '').toLowerCase().includes(q)
    );
  }

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${thColspan}" class="table-empty-admin"><i class="fa-solid fa-users"></i><br>No se encontraron usuarios</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(u => {
    const userAccounts = allAccounts.filter(a => a.uid === u.id).length;
    const userClients  = allClients.filter(c => c.uid === u.id).length;
    const userRevenue  = allMovements.filter(m => m.uid === u.id).reduce((s, m) => s + (m.monto || 0), 0);

    const giftExpiry = u.gift && u.gift_expires_at
      ? `<br><small style="color:var(--accent);font-size:0.7rem">🎁 regalo hasta ${fmtDate(u.gift_expires_at)}</small>`
      : '';

    const planBadge = u.plan
      ? `<span class="badge ${u.plan === 'pro' ? 'badge-active' : 'badge-info'}" style="font-size:0.7rem">${u.plan.toUpperCase()}</span>`
      : '';

    const actionCell = isOwnerSession
      ? `<td><button class="btn-sm" onclick="openGiftModal('${escapeHtml(u.id)}','${escapeHtml(u.email || '')}','${escapeHtml(u.nombre_negocio || u.email || '')}')" title="Regalar suscripción"><i class="fa-solid fa-gift"></i> Regalar</button></td>`
      : '';

    return `
      <tr>
        <td>
          <strong>${escapeHtml(u.nombre_negocio || '—')}</strong>
          ${giftExpiry}
          ${planBadge}
        </td>
        <td class="user-email">${escapeHtml(u.email || '—')}</td>
        <td class="user-uid" title="${escapeHtml(u.id || '')}">${escapeHtml(u.id || '')}</td>
        <td>${userAccounts}</td>
        <td>${userClients}</td>
        <td class="money-positive">${fmtCurrency(userRevenue)}</td>
        ${actionCell}
      </tr>
    `;
  }).join('');
}

// ── Render: Accounts ────────────────────────────────────────
function renderAccounts(filter = '') {
  const tbody = document.getElementById('accountsBody');
  let items = allAccounts;

  if (filter) {
    const q = filter.toLowerCase();
    items = items.filter(a =>
      (a.plataforma || '').toLowerCase().includes(q) ||
      (a.correo_cuenta || '').toLowerCase().includes(q) ||
      (a.password || '').toLowerCase().includes(q)
    );
  }

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty-admin"><i class="fa-solid fa-tv"></i><br>No se encontraron cuentas</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(acc => {
    const days = daysLeft(acc.fecha_vencimiento_master);
    const owner = allUsers.find(u => u.id === acc.uid);
    const clientCount = allClients.filter(c => c.cuenta_id === acc.id).length;
    const safeEmail = escapeHtml(acc.correo_cuenta);
    const safePass = escapeHtml(acc.password);

    return `
      <tr>
        <td>${platformTag(acc.plataforma)}</td>
        <td>
          <div class="cred-cell">
            <div class="cred-row">
              <span class="cred-label">Email</span>
              <span class="cred-value">${safeEmail}</span>
              <button class="btn-copy" onclick="copyText('${safeEmail}')" title="Copiar"><i class="fa-regular fa-copy"></i></button>
            </div>
            <div class="cred-row">
              <span class="cred-label">Pass</span>
              <span class="cred-value">${safePass}</span>
              <button class="btn-copy" onclick="copyText('${safePass}')" title="Copiar"><i class="fa-regular fa-copy"></i></button>
            </div>
          </div>
        </td>
        <td>${clientCount} / ${acc.perfiles_totales || 0}</td>
        <td>${fmtDate(acc.fecha_vencimiento_master)}</td>
        <td>${days}</td>
        <td>${statusBadge(days)}</td>
        <td>${escapeHtml(owner?.nombre_negocio || owner?.email || acc.uid?.substring(0, 8) + '...')}</td>
        <td>${escapeHtml(acc.notas || '—')}</td>
      </tr>
    `;
  }).join('');
}

// ── Render: Clients ─────────────────────────────────────────
function renderClients(filter = '') {
  const tbody = document.getElementById('clientsBody');
  let items = allClients;

  if (filter) {
    const q = filter.toLowerCase();
    items = items.filter(c =>
      (c.nombre || '').toLowerCase().includes(q) ||
      (c.whatsapp || '').includes(q) ||
      (c.plataforma || '').toLowerCase().includes(q) ||
      (c.perfil_asignado || '').toLowerCase().includes(q)
    );
  }

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="table-empty-admin"><i class="fa-solid fa-users"></i><br>No se encontraron clientes</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(cl => {
    const days = daysLeft(cl.fecha_fin);
    const account = allAccounts.find(a => a.id === cl.cuenta_id);
    const owner = allUsers.find(u => u.id === cl.uid);
    const phone = (cl.whatsapp || '').replace(/[^0-9]/g, '');

    return `
      <tr>
        <td><strong>${escapeHtml(cl.nombre)}</strong></td>
        <td>
          <a href="https://wa.me/${phone}" target="_blank" style="color: var(--whatsapp); text-decoration: none;">
            <i class="fa-brands fa-whatsapp"></i> ${escapeHtml(cl.whatsapp)}
          </a>
        </td>
        <td>${platformTag(cl.plataforma || account?.plataforma || '—')}</td>
        <td>
          <strong>${escapeHtml(cl.perfil_asignado)}</strong>
          ${cl.pin ? `<br><small style="color:var(--text-muted)">PIN: ${escapeHtml(cl.pin)}</small>` : ''}
        </td>
        <td>${fmtDate(cl.fecha_inicio)}</td>
        <td>${fmtDate(cl.fecha_fin)}</td>
        <td style="color: ${days <= 0 ? 'var(--danger)' : days <= 3 ? 'var(--warning)' : 'var(--success)'}; font-weight:700;">${days}</td>
        <td>${statusBadge(days)}</td>
        <td>
          <span class="badge ${cl.estado_pago === 'pagado' ? 'badge-active' : 'badge-warning'}">
            ${cl.estado_pago === 'pagado' ? 'Pagado' : 'Pendiente'}
          </span>
        </td>
        <td>${escapeHtml(owner?.nombre_negocio || owner?.email || '—')}</td>
      </tr>
    `;
  }).join('');
}

// ── Render: Movements ───────────────────────────────────────
function renderMovements(filter = '') {
  const tbody = document.getElementById('movementsBody');
  
  // Sort by date descending
  let items = [...allMovements].sort((a, b) => {
    const ta = a.fecha_pago?.toDate?.()?.getTime() || a.fecha_pago?.getTime?.() || 0;
    const tb = b.fecha_pago?.toDate?.()?.getTime() || b.fecha_pago?.getTime?.() || 0;
    return tb - ta;
  });

  if (filter) {
    const q = filter.toLowerCase();
    items = items.filter(m =>
      (m.cliente_nombre || '').toLowerCase().includes(q) ||
      (m.metodo || '').toLowerCase().includes(q) ||
      (m.nota || '').toLowerCase().includes(q) ||
      String(m.monto || '').includes(q)
    );
  }

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty-admin"><i class="fa-solid fa-receipt"></i><br>No se encontraron movimientos</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(mv => {
    const owner = allUsers.find(u => u.id === mv.uid);
    return `
      <tr>
        <td>${fmtDate(mv.fecha_pago)}</td>
        <td><strong>${escapeHtml(mv.cliente_nombre || '—')}</strong></td>
        <td class="money-positive">${fmtCurrency(mv.monto)}</td>
        <td><span class="badge badge-info">${escapeHtml(mv.metodo)}</span></td>
        <td>${escapeHtml(mv.nota || '—')}</td>
        <td>${escapeHtml(owner?.nombre_negocio || owner?.email || '—')}</td>
        <td>${fmtDate(mv.creado_en)}</td>
      </tr>
    `;
  }).join('');
}

// ── Search handlers ─────────────────────────────────────────
function searchUsers()     { renderUsers(document.getElementById('searchUsers').value); }
function searchAccounts()  { renderAccounts(document.getElementById('searchAccounts').value); }
function searchClients()   { renderClients(document.getElementById('searchClients').value); }
function searchMovements() { renderMovements(document.getElementById('searchMovements').value); }

// ── Export to CSV ───────────────────────────────────────────
function exportCSV(type) {
  let csv = '';
  let filename = '';

  switch (type) {
    case 'users':
      csv = 'Negocio,Email,UID,Cuentas,Clientes,Ingresos\n';
      allUsers.forEach(u => {
        const accs = allAccounts.filter(a => a.uid === u.id).length;
        const cls  = allClients.filter(c => c.uid === u.id).length;
        const rev  = allMovements.filter(m => m.uid === u.id).reduce((s, m) => s + (m.monto || 0), 0);
        csv += `"${u.nombre_negocio || ''}","${u.email}","${u.id}",${accs},${cls},${rev}\n`;
      });
      filename = 'streamly_usuarios.csv';
      break;

    case 'accounts':
      csv = 'Plataforma,Email Cuenta,Password,Perfiles,Vencimiento,Dueño\n';
      allAccounts.forEach(a => {
        const owner = allUsers.find(u => u.id === a.uid);
        csv += `"${a.plataforma}","${a.correo_cuenta}","${a.password}",${a.perfiles_totales},"${fmtDate(a.fecha_vencimiento_master)}","${owner?.email || a.uid}"\n`;
      });
      filename = 'streamly_cuentas.csv';
      break;

    case 'clients':
      csv = 'Nombre,WhatsApp,Plataforma,Perfil,PIN,Inicio,Fin,Estado Pago,Dueño\n';
      allClients.forEach(c => {
        const owner = allUsers.find(u => u.id === c.uid);
        csv += `"${c.nombre}","${c.whatsapp}","${c.plataforma || ''}","${c.perfil_asignado}","${c.pin || ''}","${fmtDate(c.fecha_inicio)}","${fmtDate(c.fecha_fin)}","${c.estado_pago || ''}","${owner?.email || c.uid}"\n`;
      });
      filename = 'streamly_clientes.csv';
      break;

    case 'movements':
      csv = 'Fecha,Cliente,Monto,Método,Nota,Dueño\n';
      allMovements.forEach(m => {
        const owner = allUsers.find(u => u.id === m.uid);
        csv += `"${fmtDate(m.fecha_pago)}","${m.cliente_nombre || ''}",${m.monto || 0},"${m.metodo || ''}","${m.nota || ''}","${owner?.email || m.uid}"\n`;
      });
      filename = 'streamly_movimientos.csv';
      break;
  }

  // Download
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showAdminToast(`${filename} descargado`);
}

// ── Render: Gifts (subscriptions regaladas) ─────────────────
function renderGifts() {
  const select  = document.getElementById('giftUserSelect');
  const history = document.getElementById('giftHistoryBody');

  // Populate user dropdown
  if (select) {
    select.innerHTML = '<option value="">— Seleccionar usuario —</option>' +
      allUsers
        .filter(u => u.id && u.email)
        .map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.email)}${u.nombre_negocio ? ' · ' + escapeHtml(u.nombre_negocio) : ''}</option>`)
        .join('');
  }

  // Show gift history
  if (history) {
    const gifted = allUsers.filter(u => u.gift || u.gift_expires_at);
    if (gifted.length === 0) {
      history.innerHTML = '<tr><td colspan="5" class="table-empty-admin"><i class="fa-solid fa-gift"></i><br>No hay regalos registrados</td></tr>';
      return;
    }
    history.innerHTML = gifted.map(u => `
      <tr>
        <td>${escapeHtml(u.email || u.id)}</td>
        <td>${escapeHtml(u.nombre_negocio || '—')}</td>
        <td><span class="badge badge-active">${(u.plan || '').toUpperCase() || '—'}</span></td>
        <td>${fmtDate(u.gift_expires_at)}</td>
        <td>${escapeHtml(u.gift_granted_by || '—')}</td>
      </tr>
    `).join('');
  }
}

// ── Gift: open modal inline (from Regalos tab) ───────────────
function openGiftModal(uid, email, name) {
  // Switch to gifts tab and pre-select user
  switchTab('gifts');
  const select = document.getElementById('giftUserSelect');
  if (select) select.value = uid;
  showAdminToast(`Seleccionado: ${name || email}`);
}

// ── Gift: do Regalo ─────────────────────────────────────────
async function doGiftSubscription() {
  const select   = document.getElementById('giftUserSelect');
  const duration = document.querySelector('input[name="giftDuration"]:checked');
  const btn      = document.getElementById('giftSubmitBtn');
  const result   = document.getElementById('giftResult');

  if (!select || !select.value) {
    if (result) { result.textContent = '⚠️ Selecciona un usuario.'; result.style.color = 'var(--warning)'; }
    return;
  }
  if (!duration) {
    if (result) { result.textContent = '⚠️ Selecciona la duración.'; result.style.color = 'var(--warning)'; }
    return;
  }

  const targetUid    = select.value;
  const durationType = duration.value;

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enviando...'; }
  if (result) result.textContent = '';

  try {
    const token = await adminUser.getIdToken(true);
    const res   = await fetch('/api/gift-subscription', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ targetUid, durationType }),
    });
    const json = await res.json();

    if (!res.ok || !json.ok) {
      throw new Error(json.error || `Error ${res.status}`);
    }

    const userEmail = select.options[select.selectedIndex]?.text || targetUid;
    if (result) {
      result.textContent = `✅ Suscripción Pro (${json.durationLabel}) regalada a ${userEmail}. Vence: ${new Date(json.expiresAt).toLocaleDateString('es-ES')}`;
      result.style.color = 'var(--success)';
    }
    showAdminToast('🎁 Suscripción regalada');

    // Refresh data so history updates
    await refreshAdmin();
    switchTab('gifts');
  } catch (err) {
    console.error('gift error:', err);
    if (result) { result.textContent = `❌ ${err.message}`; result.style.color = 'var(--danger)'; }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-gift"></i> Regalar Suscripción'; }
  }
}

// ── Logout from admin ───────────────────────────────────────
async function exitAdmin() {
  try { await auth.signOut(); } catch (_) {}
  window.location.href = 'index.html';
}

console.log('🔒 Admin panel cargado');
