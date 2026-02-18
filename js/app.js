/* ============================================================
   Streamly — Main Application Logic
   CRUD para Cuentas, Clientes y Movimientos
   ============================================================ */

// ── Estado local (caché de datos) ───────────────────────────
let accountsData   = [];
let clientsData    = [];
let movementsData  = [];

// ── Helper: escapar strings para atributos HTML inline ──────
function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/'/g,'&#39;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Carga de todos los datos ────────────────────────────────
async function loadAllData() {
  if (!currentUser || !db) return;
  try {
    await Promise.all([
      loadAccounts(),
      loadClients(),
      loadMovements()
    ]);
    updateDashboard();
    updateReports();
    populateAccountSelect();
    populateClientSelect();
  } catch (error) {
    console.error('Error cargando datos:', error);
    showToast('Error cargando datos. Verifica la conexión.', 'error');
  }
}

/* ============================================================
   CUENTAS — CRUD
   ============================================================ */

/**
 * Cargar cuentas desde Firestore
 */
async function loadAccounts() {
  if (!currentUser || !db) return;
  
  try {
    const snapshot = await db.collection('cuentas')
      .where('uid', '==', currentUser.uid)
      .get();

    accountsData = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Ordenar localmente por fecha de creación (más recientes primero)
    accountsData.sort((a, b) => {
      const ta = a.creado_en?.toDate?.()?.getTime() || 0;
      const tb = b.creado_en?.toDate?.()?.getTime() || 0;
      return tb - ta;
    });

    renderAccountsTable();
  } catch (error) {
    console.error('Error cargando cuentas:', error);
    showToast('Error cargando cuentas', 'error');
  }
}

/**
 * Renderizar tabla de cuentas
 */
function renderAccountsTable(data = null) {
  const tbody = document.getElementById('accountsTableBody');
  const items = data || accountsData;
  
  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="table-empty">
          <i class="fa-solid fa-tv"></i>
          <p>Agrega tu primera cuenta de streaming</p>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = items.map(acc => {
    const days = daysRemaining(acc.fecha_vencimiento_master);
    // Contar clientes en esta cuenta
    const clientCount = clientsData.filter(c => c.cuenta_id === acc.id).length;
    const safeEmail = escapeAttr(acc.correo_cuenta);
    const safePass = escapeAttr(acc.password);
    
    return `
      <tr>
        <td>${renderPlatformTag(acc.plataforma)}</td>
        <td>
          <div class="credentials-cell">
            <div class="credential-row">
              <span class="label-text">Email</span>
              <span class="value-text">${safeEmail}</span>
              <button class="copy-btn" onclick="copyToClipboard('${safeEmail}')" title="Copiar">
                <i class="fa-regular fa-copy"></i>
              </button>
            </div>
            <div class="credential-row">
              <span class="label-text">Pass</span>
              <span class="value-text">${safePass}</span>
              <button class="copy-btn" onclick="copyToClipboard('${safePass}')" title="Copiar">
                <i class="fa-regular fa-copy"></i>
              </button>
            </div>
          </div>
        </td>
        <td>${renderProfileSlots(acc.perfiles_totales, clientCount)}</td>
        <td>${formatDate(acc.fecha_vencimiento_master)}</td>
        <td>${renderDaysRemaining(days)}</td>
        <td>${renderStatusBadge(days)}</td>
        <td>
          <div class="row-actions">
            <button class="btn-icon" onclick="editAccount('${acc.id}')" title="Editar">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="btn-icon" onclick="confirmDelete('account', '${acc.id}')" title="Eliminar">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

/**
 * Guardar cuenta (crear o editar)
 */
async function saveAccount(e) {
  e.preventDefault();

  const id = document.getElementById('accountId').value;
  const data = {
    uid: currentUser.uid,
    plataforma: document.getElementById('accountPlatform').value,
    correo_cuenta: document.getElementById('accountEmail').value.trim(),
    password: document.getElementById('accountPassword').value,
    perfiles_totales: parseInt(document.getElementById('accountProfiles').value),
    fecha_vencimiento_master: new Date(document.getElementById('accountExpiry').value + 'T00:00:00'),
    notas: document.getElementById('accountNotes').value.trim()
  };

  try {
    if (id) {
      // Editar
      await db.collection('cuentas').doc(id).update(data);
      showToast('Cuenta actualizada', 'success');
    } else {
      // Crear
      data.creado_en = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('cuentas').add(data);
      showToast('Cuenta creada exitosamente', 'success');
    }

    closeModal('accountModal');
    document.getElementById('accountId').value = '';
    await loadAllData();
  } catch (error) {
    console.error('Error guardando cuenta:', error);
    showToast('Error al guardar la cuenta', 'error');
  }
}

/**
 * Editar cuenta — llenar formulario
 */
function editAccount(id) {
  const acc = accountsData.find(a => a.id === id);
  if (!acc) return;

  document.getElementById('accountId').value = id;
  document.getElementById('accountPlatform').value = acc.plataforma;
  document.getElementById('accountEmail').value = acc.correo_cuenta;
  document.getElementById('accountPassword').value = acc.password;
  document.getElementById('accountProfiles').value = acc.perfiles_totales;
  document.getElementById('accountExpiry').value = toInputDate(acc.fecha_vencimiento_master);
  document.getElementById('accountNotes').value = acc.notas || '';
  document.getElementById('accountModalTitle').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Editar Cuenta';

  openModal('accountModal');
}

/**
 * Eliminar cuenta
 */
async function deleteAccount(id) {
  try {
    await db.collection('cuentas').doc(id).delete();
    showToast('Cuenta eliminada', 'success');
    await loadAllData();
  } catch (error) {
    console.error('Error eliminando cuenta:', error);
    showToast('Error al eliminar', 'error');
  }
}

/**
 * Filtrar cuentas (búsqueda)
 */
function filterAccounts() {
  const query = document.getElementById('searchAccounts').value.toLowerCase();
  if (!query) {
    renderAccountsTable();
    return;
  }
  const filtered = accountsData.filter(a =>
    a.plataforma.toLowerCase().includes(query) ||
    a.correo_cuenta.toLowerCase().includes(query)
  );
  renderAccountsTable(filtered);
}

/* ============================================================
   CLIENTES — CRUD
   ============================================================ */

/**
 * Cargar clientes desde Firestore
 */
async function loadClients() {
  if (!currentUser || !db) return;

  try {
    const snapshot = await db.collection('clientes')
      .where('uid', '==', currentUser.uid)
      .get();

    clientsData = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    clientsData.sort((a, b) => {
      const ta = a.creado_en?.toDate?.()?.getTime() || 0;
      const tb = b.creado_en?.toDate?.()?.getTime() || 0;
      return tb - ta;
    });

    renderClientsTable();
  } catch (error) {
    console.error('Error cargando clientes:', error);
    showToast('Error cargando clientes', 'error');
  }
}

/**
 * Renderizar tabla de clientes
 */
function renderClientsTable(data = null) {
  const tbody = document.getElementById('clientsTableBody');
  const items = data || clientsData;

  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="table-empty">
          <i class="fa-solid fa-users"></i>
          <p>Agrega tu primer cliente</p>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = items.map(cl => {
    const days = daysRemaining(cl.fecha_fin);
    const account = accountsData.find(a => a.id === cl.cuenta_id);
    const waLink = escapeAttr(generateWhatsAppLink(cl, account));

    return `
      <tr>
        <td>
          <strong>${escapeAttr(cl.nombre)}</strong>
        </td>
        <td>
          <button class="btn-whatsapp" onclick="window.open('${waLink}', '_blank')" title="Enviar por WhatsApp">
            <i class="fa-brands fa-whatsapp"></i>
            ${escapeAttr(cl.whatsapp)}
          </button>
        </td>
        <td>${renderPlatformTag(cl.plataforma || account?.plataforma || '—')}</td>
        <td>
          <div>
            <strong>${escapeAttr(cl.perfil_asignado)}</strong>
            ${cl.pin ? `<br><small style="color: var(--text-muted);">PIN: ${escapeAttr(cl.pin)}</small>` : ''}
          </div>
        </td>
        <td>${formatDate(cl.fecha_inicio)}</td>
        <td>${formatDate(cl.fecha_fin)}</td>
        <td>${renderDaysRemaining(days)}</td>
        <td>${renderStatusBadge(days)}</td>
        <td>
          <div class="row-actions">
            <button class="btn-icon" onclick="window.open('${waLink}', '_blank')" title="WhatsApp">
              <i class="fa-brands fa-whatsapp" style="color: var(--whatsapp);"></i>
            </button>
            <button class="btn-icon" onclick="editClient('${cl.id}')" title="Editar">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="btn-icon" onclick="confirmDelete('client', '${cl.id}')" title="Eliminar">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

/**
 * Guardar cliente (crear o editar)
 */
async function saveClient(e) {
  e.preventDefault();

  const id = document.getElementById('clientId').value;
  const accountId = document.getElementById('clientAccount').value;
  const account = accountsData.find(a => a.id === accountId);

  const data = {
    uid: currentUser.uid,
    nombre: document.getElementById('clientName').value.trim(),
    whatsapp: document.getElementById('clientWhatsapp').value.trim(),
    cuenta_id: accountId,
    plataforma: account?.plataforma || '',
    perfil_asignado: document.getElementById('clientProfile').value.trim(),
    pin: document.getElementById('clientPin').value.trim(),
    fecha_inicio: new Date(document.getElementById('clientStart').value + 'T00:00:00'),
    fecha_fin: new Date(document.getElementById('clientEnd').value + 'T00:00:00'),
    estado_pago: document.getElementById('clientPaymentStatus').value
  };

  try {
    if (id) {
      await db.collection('clientes').doc(id).update(data);
      showToast('Cliente actualizado', 'success');
    } else {
      data.creado_en = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('clientes').add(data);
      showToast('Cliente agregado exitosamente', 'success');
    }

    closeModal('clientModal');
    document.getElementById('clientId').value = '';
    await loadAllData();
  } catch (error) {
    console.error('Error guardando cliente:', error);
    showToast('Error al guardar el cliente', 'error');
  }
}

/**
 * Editar cliente — llenar formulario
 */
function editClient(id) {
  const cl = clientsData.find(c => c.id === id);
  if (!cl) return;

  populateAccountSelect();

  document.getElementById('clientId').value = id;
  document.getElementById('clientName').value = cl.nombre;
  document.getElementById('clientWhatsapp').value = cl.whatsapp;
  document.getElementById('clientAccount').value = cl.cuenta_id;
  document.getElementById('clientProfile').value = cl.perfil_asignado;
  document.getElementById('clientPin').value = cl.pin || '';
  document.getElementById('clientStart').value = toInputDate(cl.fecha_inicio);
  document.getElementById('clientEnd').value = toInputDate(cl.fecha_fin);
  document.getElementById('clientPaymentStatus').value = cl.estado_pago || 'pendiente';
  document.getElementById('clientModalTitle').innerHTML = '<i class="fa-solid fa-user-pen"></i> Editar Cliente';

  openModal('clientModal');
}

/**
 * Eliminar cliente
 */
async function deleteClient(id) {
  try {
    await db.collection('clientes').doc(id).delete();
    showToast('Cliente eliminado', 'success');
    await loadAllData();
  } catch (error) {
    console.error('Error eliminando cliente:', error);
    showToast('Error al eliminar', 'error');
  }
}

/**
 * Filtrar clientes (búsqueda)
 */
function filterClients() {
  const query = document.getElementById('searchClients').value.toLowerCase();
  if (!query) {
    renderClientsTable();
    return;
  }
  const filtered = clientsData.filter(c =>
    c.nombre.toLowerCase().includes(query) ||
    c.whatsapp.includes(query) ||
    (c.plataforma || '').toLowerCase().includes(query)
  );
  renderClientsTable(filtered);
}

/* ============================================================
   MOVIMIENTOS — CRUD
   ============================================================ */

/**
 * Cargar movimientos desde Firestore
 */
async function loadMovements() {
  if (!currentUser || !db) return;

  try {
    const snapshot = await db.collection('movimientos')
      .where('uid', '==', currentUser.uid)
      .get();

    movementsData = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    movementsData.sort((a, b) => {
      const ta = a.creado_en?.toDate?.()?.getTime() || 0;
      const tb = b.creado_en?.toDate?.()?.getTime() || 0;
      return tb - ta;
    });

    renderMovementsTable();
  } catch (error) {
    console.error('Error cargando movimientos:', error);
    showToast('Error cargando movimientos', 'error');
  }
}

/**
 * Renderizar tabla de movimientos
 */
function renderMovementsTable(data = null) {
  const tbody = document.getElementById('movementsTableBody');
  const items = data || movementsData;

  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty">
          <i class="fa-solid fa-receipt"></i>
          <p>No hay movimientos registrados</p>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = items.map(mv => {
    return `
      <tr>
        <td>${formatDate(mv.fecha_pago)}</td>
        <td><strong>${escapeAttr(mv.cliente_nombre) || '—'}</strong></td>
        <td><span style="color: var(--success); font-weight: 700;">${formatCurrency(mv.monto)}</span></td>
        <td><span class="badge badge-info">${escapeAttr(mv.metodo)}</span></td>
        <td>${escapeAttr(mv.nota) || '—'}</td>
        <td>
          <div class="row-actions">
            <button class="btn-icon" onclick="editMovement('${mv.id}')" title="Editar">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="btn-icon" onclick="confirmDelete('movement', '${mv.id}')" title="Eliminar">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

/**
 * Guardar movimiento (crear o editar)
 */
async function saveMovement(e) {
  e.preventDefault();

  const id = document.getElementById('movementId').value;
  const clientId = document.getElementById('movementClient').value;
  const client = clientsData.find(c => c.id === clientId);

  const data = {
    uid: currentUser.uid,
    cliente_id: clientId,
    cliente_nombre: client?.nombre || '',
    monto: parseFloat(document.getElementById('movementAmount').value),
    fecha_pago: new Date(document.getElementById('movementDate').value + 'T00:00:00'),
    metodo: document.getElementById('movementMethod').value,
    nota: document.getElementById('movementNote').value.trim()
  };

  try {
    if (id) {
      await db.collection('movimientos').doc(id).update(data);
      showToast('Movimiento actualizado', 'success');
    } else {
      data.creado_en = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('movimientos').add(data);
      showToast('Movimiento registrado', 'success');
    }

    closeModal('movementModal');
    document.getElementById('movementId').value = '';
    await loadAllData();
  } catch (error) {
    console.error('Error guardando movimiento:', error);
    showToast('Error al guardar el movimiento', 'error');
  }
}

/**
 * Editar movimiento — llenar formulario
 */
function editMovement(id) {
  const mv = movementsData.find(m => m.id === id);
  if (!mv) return;

  populateClientSelect();

  document.getElementById('movementId').value = id;
  document.getElementById('movementClient').value = mv.cliente_id;
  document.getElementById('movementAmount').value = mv.monto;
  document.getElementById('movementDate').value = toInputDate(mv.fecha_pago);
  document.getElementById('movementMethod').value = mv.metodo;
  document.getElementById('movementNote').value = mv.nota || '';
  document.getElementById('movementModalTitle').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Editar Movimiento';

  openModal('movementModal');
}

/**
 * Eliminar movimiento
 */
async function deleteMovement(id) {
  try {
    await db.collection('movimientos').doc(id).delete();
    showToast('Movimiento eliminado', 'success');
    await loadAllData();
  } catch (error) {
    console.error('Error eliminando movimiento:', error);
    showToast('Error al eliminar', 'error');
  }
}

/**
 * Filtrar movimientos
 */
function filterMovements() {
  const query = document.getElementById('searchMovements').value.toLowerCase();
  if (!query) {
    renderMovementsTable();
    return;
  }
  const filtered = movementsData.filter(m =>
    (m.cliente_nombre || '').toLowerCase().includes(query) ||
    (m.metodo || '').toLowerCase().includes(query) ||
    (m.nota || '').toLowerCase().includes(query)
  );
  renderMovementsTable(filtered);
}

/* ============================================================
   CONFIRM DELETE — Modal de confirmación
   ============================================================ */
let pendingDeleteType = '';
let pendingDeleteId = '';

function confirmDelete(type, id) {
  pendingDeleteType = type;
  pendingDeleteId = id;

  const titles = {
    account: '¿Eliminar esta cuenta?',
    client: '¿Eliminar este cliente?',
    movement: '¿Eliminar este movimiento?'
  };

  document.getElementById('confirmTitle').textContent = titles[type] || '¿Eliminar?';
  document.getElementById('confirmMessage').textContent = 'Esta acción no se puede deshacer.';
  
  // Asignar acción al botón
  document.getElementById('confirmDeleteBtn').onclick = async () => {
    closeModal('confirmModal');
    switch (pendingDeleteType) {
      case 'account':
        await deleteAccount(pendingDeleteId);
        break;
      case 'client':
        await deleteClient(pendingDeleteId);
        break;
      case 'movement':
        await deleteMovement(pendingDeleteId);
        break;
    }
  };

  openModal('confirmModal');
}

/* ============================================================
   SELECTS DINÁMICOS
   ============================================================ */

/**
 * Poblar selector de cuentas (para form de clientes)
 */
function populateAccountSelect() {
  const select = document.getElementById('clientAccount');
  const currentVal = select.value;
  
  select.innerHTML = '<option value="">Seleccionar cuenta...</option>';
  accountsData.forEach(acc => {
    const clientCount = clientsData.filter(c => c.cuenta_id === acc.id).length;
    const available = acc.perfiles_totales - clientCount;
    const opt = document.createElement('option');
    opt.value = acc.id;
    opt.textContent = `${acc.plataforma} — ${acc.correo_cuenta} (${available} disponibles)`;
    if (available <= 0) opt.disabled = true;
    select.appendChild(opt);
  });

  // Restaurar valor seleccionado si existía
  if (currentVal) select.value = currentVal;
}

/**
 * Poblar selector de clientes (para form de movimientos)
 */
function populateClientSelect() {
  const select = document.getElementById('movementClient');
  const currentVal = select.value;
  
  select.innerHTML = '<option value="">Seleccionar cliente...</option>';
  clientsData.forEach(cl => {
    const opt = document.createElement('option');
    opt.value = cl.id;
    opt.textContent = `${cl.nombre} — ${cl.plataforma || ''}`;
    select.appendChild(opt);
  });

  if (currentVal) select.value = currentVal;
}

/**
 * Actualizar opciones de perfil según la cuenta seleccionada
 */
function updateProfileOptions() {
  const accountId = document.getElementById('clientAccount').value;
  const account = accountsData.find(a => a.id === accountId);
  if (!account) return;

  // Sugerir el siguiente perfil disponible
  const assignedProfiles = clientsData
    .filter(c => c.cuenta_id === accountId)
    .map(c => c.perfil_asignado);

  for (let i = 1; i <= account.perfiles_totales; i++) {
    const profileName = `Perfil ${i}`;
    if (!assignedProfiles.includes(profileName)) {
      document.getElementById('clientProfile').value = profileName;
      break;
    }
  }
}

/* ============================================================
   DASHBOARD — Actualización de estadísticas
   ============================================================ */
function updateDashboard() {
  // Balance total del mes (movimientos del mes actual)
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthMovements = movementsData.filter(m => {
    if (!m.fecha_pago) return false;
    const d = m.fecha_pago instanceof Date ? m.fecha_pago : (m.fecha_pago.toDate ? m.fecha_pago.toDate() : new Date(m.fecha_pago));
    return d >= monthStart;
  });
  const balance = monthMovements.reduce((sum, m) => sum + (m.monto || 0), 0);

  // Clientes activos (días restantes > 0)
  const activeClients = clientsData.filter(c => daysRemaining(c.fecha_fin) > 0).length;
  
  // Clientes vencidos
  const expiredClients = clientsData.filter(c => daysRemaining(c.fecha_fin) <= 0).length;

  // Cuentas totales
  const totalAccounts = accountsData.length;

  // Próximos a vencer (≤ 3 días)
  const expiringSoon = clientsData.filter(c => {
    const d = daysRemaining(c.fecha_fin);
    return d > 0 && d <= 3;
  }).length;

  // Actualizar UI
  document.getElementById('statBalance').textContent = formatCurrency(balance);
  document.getElementById('statActiveClients').textContent = activeClients;
  document.getElementById('statExpiredClients').textContent = expiredClients;
  document.getElementById('statTotalAccounts').textContent = totalAccounts;
  document.getElementById('statExpiringSoon').textContent = expiringSoon;

  // Tabla de clientes próximos a vencer en dashboard
  renderDashboardClients();
}

/**
 * Renderizar los clientes próximos a vencer en el dashboard
 */
function renderDashboardClients() {
  const tbody = document.getElementById('dashboardClientsBody');
  
  // Ordenar clientes por fecha_fin ascendente, mostrar los más urgentes primero
  const sorted = [...clientsData]
    .map(cl => ({ ...cl, _days: daysRemaining(cl.fecha_fin) }))
    .sort((a, b) => a._days - b._days)
    .slice(0, 10); // Mostrar máximo 10

  if (sorted.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="table-empty">
          <i class="fa-solid fa-inbox"></i>
          <p>No hay clientes registrados aún</p>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = sorted.map(cl => {
    const account = accountsData.find(a => a.id === cl.cuenta_id);
    const waLink = escapeAttr(generateWhatsAppLink(cl, account));
    return `
      <tr>
        <td><strong>${escapeAttr(cl.nombre)}</strong></td>
        <td>${renderPlatformTag(cl.plataforma || account?.plataforma || '—')}</td>
        <td>${escapeAttr(cl.perfil_asignado)}</td>
        <td>${formatDate(cl.fecha_fin)}</td>
        <td>${renderDaysRemaining(cl._days)}</td>
        <td>${renderStatusBadge(cl._days)}</td>
        <td>
          <div class="row-actions">
            <button class="btn-icon" onclick="window.open('${waLink}', '_blank')" title="WhatsApp">
              <i class="fa-brands fa-whatsapp" style="color: var(--whatsapp);"></i>
            </button>
            <button class="btn-icon" onclick="editClient('${cl.id}')" title="Editar">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

/* ============================================================
   REPORTES — Resumen por plataforma
   ============================================================ */
function updateReports() {
  // Ingresos del mes
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthIncome = movementsData.filter(m => {
    if (!m.fecha_pago) return false;
    const d = m.fecha_pago instanceof Date ? m.fecha_pago : (m.fecha_pago.toDate ? m.fecha_pago.toDate() : new Date(m.fecha_pago));
    return d >= monthStart;
  }).reduce((sum, m) => sum + (m.monto || 0), 0);

  document.getElementById('reportMonthlyIncome').textContent = formatCurrency(monthIncome);

  // Ocupación total de perfiles
  const totalProfiles = accountsData.reduce((sum, a) => sum + (a.perfiles_totales || 0), 0);
  const occupiedProfiles = clientsData.filter(c => daysRemaining(c.fecha_fin) > 0).length;
  const occupancy = totalProfiles > 0 ? Math.round((occupiedProfiles / totalProfiles) * 100) : 0;
  document.getElementById('reportOccupancy').textContent = `${occupancy}%`;

  // Plataforma top
  const platformCount = {};
  clientsData.forEach(c => {
    const p = c.plataforma || '—';
    platformCount[p] = (platformCount[p] || 0) + 1;
  });
  const topPlatform = Object.entries(platformCount).sort((a, b) => b[1] - a[1])[0];
  document.getElementById('reportTopPlatform').textContent = topPlatform ? topPlatform[0] : '—';

  // Tabla de resumen por plataforma
  renderReportTable();
}

function renderReportTable() {
  const tbody = document.getElementById('reportTableBody');
  
  // Agrupar por plataforma
  const platforms = {};
  accountsData.forEach(acc => {
    if (!platforms[acc.plataforma]) {
      platforms[acc.plataforma] = {
        cuentas: 0,
        perfiles_totales: 0,
        perfiles_ocupados: 0
      };
    }
    platforms[acc.plataforma].cuentas++;
    platforms[acc.plataforma].perfiles_totales += acc.perfiles_totales || 0;
  });

  // Contar perfiles ocupados
  clientsData.forEach(cl => {
    const p = cl.plataforma || '';
    if (platforms[p]) {
      platforms[p].perfiles_ocupados++;
    }
  });

  const entries = Object.entries(platforms);
  if (entries.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty">
          <i class="fa-solid fa-chart-bar"></i>
          <p>Agrega cuentas y clientes para ver reportes</p>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = entries.map(([name, data]) => {
    const available = data.perfiles_totales - data.perfiles_ocupados;
    const occ = data.perfiles_totales > 0 
      ? Math.round((data.perfiles_ocupados / data.perfiles_totales) * 100) 
      : 0;
    const occColor = occ >= 80 ? 'var(--success)' : occ >= 50 ? 'var(--warning)' : 'var(--text-muted)';

    return `
      <tr>
        <td>${renderPlatformTag(name)}</td>
        <td>${data.cuentas}</td>
        <td>${data.perfiles_totales}</td>
        <td>${data.perfiles_ocupados}</td>
        <td>${available}</td>
        <td><span style="color: ${occColor}; font-weight: 700;">${occ}%</span></td>
      </tr>`;
  }).join('');
}

/* ============================================================
   RESET de títulos de modales al abrir para "nuevo"
   ============================================================ */
// Interceptar apertura de modales para resetear títulos
const originalOpenModal = openModal;
openModal = function(modalId) {
  // Si no hay ID en el hidden input, es un nuevo registro
  if (modalId === 'accountModal' && !document.getElementById('accountId').value) {
    document.getElementById('accountModalTitle').innerHTML = '<i class="fa-solid fa-tv"></i> Nueva Cuenta';
  }
  if (modalId === 'clientModal' && !document.getElementById('clientId').value) {
    document.getElementById('clientModalTitle').innerHTML = '<i class="fa-solid fa-user-plus"></i> Nuevo Cliente';
    populateAccountSelect();
    // Setear fecha de inicio como hoy
    document.getElementById('clientStart').value = toInputDate(new Date());
  }
  if (modalId === 'movementModal' && !document.getElementById('movementId').value) {
    document.getElementById('movementModalTitle').innerHTML = '<i class="fa-solid fa-receipt"></i> Nuevo Movimiento';
    populateClientSelect();
    // Setear fecha como hoy
    document.getElementById('movementDate').value = toInputDate(new Date());
  }
  originalOpenModal(modalId);
};

console.log('🚀 Aplicación principal cargada');
