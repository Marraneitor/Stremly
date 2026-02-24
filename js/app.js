/* ============================================================
   Streamly — Main Application Logic
   CRUD para Cuentas, Clientes y Movimientos
   ============================================================ */

// ── Estado local (caché de datos) ───────────────────────────
let accountsData   = [];
let clientsData    = [];
let movementsData  = [];

// ── Utilidad: debounce para evitar re-renders excesivos en búsqueda ──
function debounce(fn, delay = 250) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Versiones debounced de los filtros (se llaman desde oninput en HTML)
const debouncedFilterAccounts  = debounce(filterAccounts, 200);
const debouncedFilterClients   = debounce(filterClients, 200);
const debouncedFilterMovements = debounce(filterMovements, 200);

// ── Helper: escapar strings para atributos HTML inline ──────
const _escapeMap = { '&': '&amp;', "'": '&#39;', '"': '&quot;', '<': '&lt;', '>': '&gt;' };
const _escapeRe  = /[&'"<>]/g;
function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(_escapeRe, ch => _escapeMap[ch]);
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
    loadChatbotConfig();
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
    plataforma: document.getElementById('accountPlatform').value === '__custom__'
      ? document.getElementById('accountPlatformCustom').value.trim()
      : document.getElementById('accountPlatform').value,
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

  // Check if the platform exists in the dropdown, otherwise use custom input
  const platformSelect = document.getElementById('accountPlatform');
  const platformOptions = Array.from(platformSelect.options).map(o => o.value);
  if (platformOptions.includes(acc.plataforma)) {
    platformSelect.value = acc.plataforma;
  } else {
    platformSelect.value = '__custom__';
    document.getElementById('accountPlatformCustom').value = acc.plataforma;
  }
  toggleCustomPlatform();
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
        <td colspan="10" class="table-empty">
          <i class="fa-solid fa-users"></i>
          <p>Agrega tu primer cliente</p>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = items.map(cl => {
    const days = daysRemaining(cl.fecha_fin);
    const account = accountsData.find(a => a.id === cl.cuenta_id);
    const credLink = escapeAttr(generateCredentialsLink(cl, account));

    return `
      <tr>
        <td>
          <strong>${escapeAttr(cl.nombre)}</strong>
        </td>
        <td>
          <button class="btn-whatsapp" onclick="window.open('${credLink}', '_blank')" title="Enviar credenciales por WhatsApp">
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
        <td><span style="color: var(--success); font-weight: 600;">${cl.precio ? formatCurrency(cl.precio) : '—'}</span></td>
        <td>${formatDate(cl.fecha_inicio)}</td>
        <td>${formatDate(cl.fecha_fin)}</td>
        <td>${renderDaysRemaining(days)}</td>
        <td>${renderStatusBadge(days)}</td>
        <td>
          <div class="row-actions">
            <button class="btn-icon btn-send-creds" onclick="window.open('${credLink}', '_blank')" title="Enviar credenciales">
              <i class="fa-solid fa-paper-plane" style="color: var(--accent-light);"></i>
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

  const precio = parseFloat(document.getElementById('clientPrice').value) || 0;
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
    precio: precio,
    estado_pago: document.getElementById('clientPaymentStatus').value
  };

  try {
    if (id) {
      await db.collection('clientes').doc(id).update(data);
      showToast('Cliente actualizado', 'success');
    } else {
      data.creado_en = firebase.firestore.FieldValue.serverTimestamp();
      const newRef = await db.collection('clientes').add(data);
      showToast('Cliente agregado exitosamente', 'success');

      // Auto-registrar movimiento si el cliente pagó y tiene precio
      if (precio > 0 && data.estado_pago === 'pagado') {
        try {
          await db.collection('movimientos').add({
            uid: currentUser.uid,
            cliente_id: newRef.id,
            cliente_nombre: data.nombre,
            monto: precio,
            fecha_pago: data.fecha_inicio,
            metodo: 'Automático',
            nota: `Pago ${account?.plataforma || ''} — ${data.perfil_asignado}`,
            creado_en: firebase.firestore.FieldValue.serverTimestamp()
          });
        } catch (mErr) {
          console.warn('No se pudo registrar movimiento automático:', mErr);
        }
      }
    }

    closeModal('clientModal');

    // Si estábamos completando un pedido, marcarlo como completado
    if (pendingOrderToComplete) {
      try {
        const botUrl = getBotUrl();
        if (!botUrl) throw new Error('Bot no configurado');
        await fetch(`${botUrl}/orders/${pendingOrderToComplete.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estado: 'completado' })
        });
        showToast(`Pedido #${pendingOrderToComplete.id} completado ✓`, 'success');
        pendingOrderToComplete = null;
        await loadPendingOrders();
      } catch (_) {}
    }

    // Si se pidió enviar credenciales después de guardar
    if (sendCredsAfterSave) {
      sendCredsAfterSave = false;
      // Construir datos del cliente recién guardado para generar link
      const clientForLink = {
        nombre: data.nombre,
        whatsapp: data.whatsapp,
        perfil_asignado: data.perfil_asignado,
        pin: data.pin,
        fecha_inicio: data.fecha_inicio,
        fecha_fin: data.fecha_fin
      };
      const credLink = generateCredentialsLink(clientForLink, account);
      window.open(credLink, '_blank');
    }

    document.getElementById('clientId').value = '';
    // Ocultar botón de enviar credenciales
    const sendCredsBtn = document.getElementById('btnSaveAndSendCreds');
    if (sendCredsBtn) sendCredsBtn.style.display = 'none';
    await loadAllData();
  } catch (error) {
    console.error('Error guardando cliente:', error);
    showToast('Error al guardar el cliente', 'error');
  }
}

/**
 * Abrir modal de nuevo cliente (sin datos de pedido)
 */
function openNewClientModal() {
  pendingOrderToComplete = null;
  sendCredsAfterSave = false;
  const sendCredsBtn = document.getElementById('btnSaveAndSendCreds');
  if (sendCredsBtn) sendCredsBtn.style.display = 'none';
  document.getElementById('clientModalTitle').innerHTML = '<i class=\"fa-solid fa-user-plus\"></i> Nuevo Cliente';
  populateAccountSelect();
  openModal('clientModal');
}

/**
 * Editar cliente — llenar formulario
 */
function editClient(id) {
  const cl = clientsData.find(c => c.id === id);
  if (!cl) return;

  populateAccountSelect();

  // Ocultar botón de enviar credenciales en edición normal
  const sendCredsBtn = document.getElementById('btnSaveAndSendCreds');
  if (sendCredsBtn) sendCredsBtn.style.display = 'none';

  document.getElementById('clientId').value = id;
  document.getElementById('clientName').value = cl.nombre;
  document.getElementById('clientWhatsapp').value = cl.whatsapp;
  document.getElementById('clientAccount').value = cl.cuenta_id;
  document.getElementById('clientProfile').value = cl.perfil_asignado;
  document.getElementById('clientPin').value = cl.pin || '';
  document.getElementById('clientStart').value = toInputDate(cl.fecha_inicio);
  document.getElementById('clientEnd').value = toInputDate(cl.fecha_fin);
  document.getElementById('clientPrice').value = cl.precio || '';
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
function populateAccountSelect(filterPlatform) {
  const select = document.getElementById('clientAccount');
  const currentVal = select.value;
  
  select.innerHTML = '<option value="">Seleccionar cuenta...</option>';

  // Si viene filtro de plataforma, mostrar primero las coincidentes
  const sorted = [...accountsData].sort((a, b) => {
    if (filterPlatform) {
      const aMatch = a.plataforma === filterPlatform ? 0 : 1;
      const bMatch = b.plataforma === filterPlatform ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }
    return 0;
  });

  sorted.forEach(acc => {
    const clientCount = clientsData.filter(c => c.cuenta_id === acc.id).length;
    const available = acc.perfiles_totales - clientCount;
    const opt = document.createElement('option');
    opt.value = acc.id;
    const matchTag = filterPlatform && acc.plataforma === filterPlatform ? '⭐ ' : '';
    opt.textContent = `${matchTag}${acc.plataforma} — ${acc.correo_cuenta} (${available} disponibles)`;
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
  // Balance total del mes — ingresos de clientes cuya fecha_inicio cae en el mes actual
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Ingresos desde clientes pagados este mes
  const clientBalance = clientsData.filter(c => {
    if (!c.precio || c.precio <= 0) return false;
    if (c.estado_pago !== 'pagado') return false;
    const d = c.fecha_inicio instanceof Date ? c.fecha_inicio : (c.fecha_inicio?.toDate ? c.fecha_inicio.toDate() : new Date(c.fecha_inicio));
    return d >= monthStart;
  }).reduce((sum, c) => sum + (c.precio || 0), 0);

  // También sumar movimientos del mes (por si hay registros manuales sin cliente)
  const movBalance = movementsData.filter(m => {
    if (!m.fecha_pago) return false;
    const d = m.fecha_pago instanceof Date ? m.fecha_pago : (m.fecha_pago.toDate ? m.fecha_pago.toDate() : new Date(m.fecha_pago));
    return d >= monthStart;
  }).reduce((sum, m) => sum + (m.monto || 0), 0);

  const balance = Math.max(clientBalance, movBalance);

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
  // Ingresos del mes — desde clientes pagados cuya fecha_inicio está en el mes actual
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Ingresos desde clientes pagados este mes
  const clientIncome = clientsData.filter(c => {
    if (!c.precio || c.precio <= 0) return false;
    if (c.estado_pago !== 'pagado') return false;
    const d = c.fecha_inicio instanceof Date ? c.fecha_inicio : (c.fecha_inicio?.toDate ? c.fecha_inicio.toDate() : new Date(c.fecha_inicio));
    return d >= monthStart;
  }).reduce((sum, c) => sum + (c.precio || 0), 0);

  // También considerar movimientos manuales del mes
  const movIncome = movementsData.filter(m => {
    if (!m.fecha_pago) return false;
    const d = m.fecha_pago instanceof Date ? m.fecha_pago : (m.fecha_pago.toDate ? m.fecha_pago.toDate() : new Date(m.fecha_pago));
    return d >= monthStart;
  }).reduce((sum, m) => sum + (m.monto || 0), 0);

  const monthIncome = Math.max(clientIncome, movIncome);
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

/* ============================================================
   CHATBOT — Configuración y prueba
   ============================================================ */

/**
 * Limpiar estado del chatbot (al cambiar de cuenta / cerrar sesión)
 */
function clearChatbotState() {
  // Limpiar campos del formulario
  document.getElementById('botBusinessName').value = '';
  document.getElementById('botSchedule').value = '';
  document.getElementById('botPersonality').value = '';
  document.getElementById('botContext').value = '';
  document.getElementById('botWelcomeMsg').value = '';
  document.getElementById('botFallbackMsg').value = '';
  document.getElementById('botEnabled').value = 'true';
  document.getElementById('botMaxTokens').value = '512';

  // Limpiar wizard state
  wizardState.step = 0;
  wizardState.history = [];
  wizardState.collected = {};
  wizardState.active = false;

  // Limpiar UI del wizard
  const messagesDiv = document.getElementById('wizardMessages');
  if (messagesDiv) messagesDiv.innerHTML = '';
  clearQuickReplies();
  document.querySelectorAll('.wizard-done-actions').forEach(el => el.remove());
  document.querySelectorAll('.wizard-config-review').forEach(el => el.remove());
}

/**
 * Cargar configuración del chatbot desde Firestore
 */
async function loadChatbotConfig() {
  if (!currentUser || !db) return;

  // Siempre limpiar datos previos antes de cargar
  clearChatbotState();

  try {
    const doc = await db.collection('chatbot_config').doc(currentUser.uid).get();
    if (doc.exists) {
      const data = doc.data();
      document.getElementById('botBusinessName').value = data.businessName || '';
      document.getElementById('botSchedule').value = data.schedule || '';
      document.getElementById('botPersonality').value = data.personality || '';
      document.getElementById('botContext').value = data.context || '';
      document.getElementById('botWelcomeMsg').value = data.welcomeMsg || '';
      document.getElementById('botFallbackMsg').value = data.fallbackMsg || '';
      document.getElementById('botEnabled').value = data.enabled !== false ? 'true' : 'false';
      document.getElementById('botMaxTokens').value = data.maxTokens || '512';
    }
    // Si ya tiene config guardada, mostrar resumen; si no, iniciar wizard
    setTimeout(() => {
      if (wizardState.active || wizardState.history.length > 0) return;
      const hasConfig = document.getElementById('botBusinessName').value.trim();
      if (hasConfig) {
        showCurrentConfigSummary();
      } else {
        startConfigWizard();
      }
    }, 500);
  } catch (err) {
    // Silenciar error de permisos (las reglas aún no incluyen chatbot_config)
    if (err.code === 'permission-denied') {
      console.warn('⚠️ Chatbot config: sin permisos. Actualiza las reglas de Firestore.');
    } else {
      console.warn('⚠️ Chatbot config no disponible:', err.message);
    }
  }
}

/**
 * Guardar configuración del chatbot en Firestore
 */
async function saveChatbotConfig(e) {
  e.preventDefault();
  if (!currentUser || !db) return;

  const config = {
    uid: currentUser.uid,
    businessName: document.getElementById('botBusinessName').value.trim(),
    schedule: document.getElementById('botSchedule').value.trim(),
    personality: document.getElementById('botPersonality').value.trim(),
    context: document.getElementById('botContext').value.trim(),
    welcomeMsg: document.getElementById('botWelcomeMsg').value.trim(),
    fallbackMsg: document.getElementById('botFallbackMsg').value.trim(),
    enabled: document.getElementById('botEnabled').value === 'true',
    maxTokens: parseInt(document.getElementById('botMaxTokens').value),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    await db.collection('chatbot_config').doc(currentUser.uid).set(config, { merge: true });
    showToast('Configuración del chatbot guardada', 'success');
  } catch (err) {
    console.error('Error guardando config chatbot:', err);
    showToast('Error al guardar la configuración', 'error');
  }
}

/**
 * Mostrar sección de prueba del chatbot
 */
function testChatbot() {
  const section = document.getElementById('chatbotTestSection');
  section.hidden = !section.hidden;
  if (!section.hidden) {
    document.getElementById('chatTestInput').focus();
  }
}

/**
 * Enviar mensaje de prueba al chatbot (via API serverless)
 */
async function sendTestMessage() {
  const input = document.getElementById('chatTestInput');
  const msg = input.value.trim();
  if (!msg) return;

  const messagesDiv = document.getElementById('chatTestMessages');

  // Mostrar mensaje del usuario
  messagesDiv.innerHTML += `<div class="chat-msg chat-msg-user"><span>${escapeAttr(msg)}</span></div>`;
  input.value = '';
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  // Mostrar "escribiendo..."
  const typingId = 'typing-' + Date.now();
  messagesDiv.innerHTML += `<div class="chat-msg chat-msg-bot" id="${typingId}"><span><i class="fa-solid fa-ellipsis fa-beat-fade"></i> Pensando...</span></div>`;
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  try {
    // Construir contexto desde el formulario
    const config = {
      businessName: document.getElementById('botBusinessName').value.trim(),
      schedule: document.getElementById('botSchedule').value.trim(),
      personality: document.getElementById('botPersonality').value.trim(),
      context: document.getElementById('botContext').value.trim(),
      fallbackMsg: document.getElementById('botFallbackMsg').value.trim(),
      maxTokens: parseInt(document.getElementById('botMaxTokens').value)
    };

    // Usar la API serverless de Vercel (funciona sin bot server)
    const apiUrl = '/api/chatbot';

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, config })
    });

    const data = await res.json();

    // Reemplazar "escribiendo" con la respuesta
    const typingEl = document.getElementById(typingId);
    if (typingEl) {
      typingEl.innerHTML = `<span>${escapeAttr(data.reply || data.error || 'Sin respuesta')}</span>`;
    }
  } catch (err) {
    const typingEl = document.getElementById(typingId);
    if (typingEl) {
      typingEl.innerHTML = `<span style="color:var(--danger);">Error: ${escapeAttr(err.message)}</span>`;
    }
  }
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

/* ============================================================
   CHATBOT — Wizard de Configuración con IA
   ============================================================ */

// Estado del wizard
const wizardState = {
  step: 0,          // paso actual
  history: [],      // historial de mensajes [{role, text}]
  collected: {},    // campos recopilados
  active: false,
  steps: [
    'greeting',
    'businessName',
    'schedule',
    'personality',
    'context',
    'welcomeMsg',
    'fallbackMsg',
    'summary'
  ]
};

/**
 * Generar resumen de inventario disponible para el wizard
 */
function getInventorySummary() {
  if (!accountsData || accountsData.length === 0) {
    return 'No hay cuentas registradas aún en el sistema.';
  }
  const platformMap = {};
  accountsData.forEach(acc => {
    const plat = acc.plataforma || 'Sin plataforma';
    if (!platformMap[plat]) platformMap[plat] = { total: 0, used: 0, accounts: 0 };
    platformMap[plat].accounts++;
    const totalSlots = acc.perfiles_totales || 0;
    const usedSlots = clientsData.filter(c => c.cuenta_id === acc.id).length;
    platformMap[plat].total += totalSlots;
    platformMap[plat].used += usedSlots;
  });
  const lines = Object.entries(platformMap).map(([plat, info]) => {
    const available = info.total - info.used;
    return `• ${plat}: ${info.accounts} cuenta(s), ${info.total} perfiles totales, ${available} disponibles`;
  });
  return 'Inventario actual:\n' + lines.join('\n');
}

/**
 * Obtener el system prompt para el wizard según el paso actual
 */
function getWizardSystemPrompt(step) {
  const inventory = getInventorySummary();

  const base = `Eres un asistente de configuración de Streamly, una plataforma de gestión de cuentas de streaming.
Estás ayudando al usuario a configurar su bot de WhatsApp paso a paso.
Responde SIEMPRE en español. Sé amable, breve y claro. Usa emojis moderadamente.
NO uses Markdown. Usa solo texto plano con emojis.

${inventory}

Lo que ya se ha configurado hasta ahora:
${JSON.stringify(wizardState.collected, null, 2)}
`;

  const prompts = {
    greeting: base + `
Este es el primer mensaje. Da la bienvenida al usuario y explícale brevemente que lo vas a guiar para configurar su bot de WhatsApp en unos simples pasos.
Luego pregúntale: ¿Cómo se llama tu negocio?
No escribas más de 4 líneas.`,

    businessName: base + `
El usuario te está dando el nombre de su negocio. Confírmalo amablemente y pregúntale:
¿Cuáles son tus horarios de atención? (ejemplo: Lun-Vie 9am-6pm, Sáb 10am-2pm)
No escribas más de 3 líneas.`,

    schedule: base + `
El usuario te está dando sus horarios de atención. Confírmalo amablemente y pregúntale:
¿Qué personalidad quieres que tenga tu bot? Explica estas opciones brevemente:
1. 🤝 Profesional y formal
2. 😊 Amigable y cercano
3. 🎉 Divertido y con emojis
4. 📋 Directo y conciso
O puede escribir una personalidad personalizada.
No escribas más de 6 líneas.`,

    personality: base + `
El usuario eligió una personalidad para el bot. Confírmalo amablemente.
Ahora pregúntale sobre el contexto de su negocio. Dile que describa:
- Qué servicios o productos vende
- Cómo es el proceso de compra
- Precios o planes si los tiene
- Cualquier información que el bot deba saber para atender bien

Muéstrale el inventario actual del sistema para que sepa qué tiene disponible.
No escribas más de 6 líneas.`,

    context: base + `
El usuario te dio el contexto de su negocio. Confírmalo.
Ahora pregúntale: ¿Qué mensaje de bienvenida quieres que envíe el bot cuando alguien escribe por primera vez?
Dale un ejemplo basado en el nombre del negocio que configuró.
No escribas más de 4 líneas.`,

    welcomeMsg: base + `
El usuario eligió su mensaje de bienvenida. Confírmalo.
Última pregunta: ¿Qué mensaje quieres que envíe el bot cuando no sepa responder algo?
Dale un ejemplo como: "Lo siento, no tengo esa información. Un agente te atenderá pronto."
No escribas más de 3 líneas.`,

    fallbackMsg: base + `
El usuario eligió su mensaje de fallback. ¡Excelente!
Ahora genera un RESUMEN COMPLETO de toda la configuración recopilada en formato lista.
Al final dile que si todo está bien puede hacer clic en "Guardar configuración" o puede decirte si quiere cambiar algo.
Incluye TODOS los campos:
- Nombre del negocio: ${wizardState.collected.businessName || '?'}
- Horarios: ${wizardState.collected.schedule || '?'}
- Personalidad: ${wizardState.collected.personality || '?'}
- Contexto: ${wizardState.collected.context || '?'}
- Mensaje de bienvenida: ${wizardState.collected.welcomeMsg || '?'}
- Mensaje de fallback: [lo que acaba de responder el usuario]`
  };

  return prompts[step] || base;
}

/**
 * Iniciar el wizard
 */
function startConfigWizard() {
  wizardState.step = 0;
  wizardState.history = [];
  wizardState.collected = {};
  wizardState.active = true;

  const messagesDiv = document.getElementById('wizardMessages');
  messagesDiv.innerHTML = '';
  clearQuickReplies();

  // Cargar config existente si la hay
  const existingName = document.getElementById('botBusinessName').value.trim();
  if (existingName) {
    wizardState.collected = {
      businessName: document.getElementById('botBusinessName').value.trim(),
      schedule: document.getElementById('botSchedule').value.trim(),
      personality: document.getElementById('botPersonality').value.trim(),
      context: document.getElementById('botContext').value.trim(),
      welcomeMsg: document.getElementById('botWelcomeMsg').value.trim(),
      fallbackMsg: document.getElementById('botFallbackMsg').value.trim()
    };
  }

  sendWizardBotMessage('greeting');
}

/**
 * Enviar mensaje del wizard (IA)
 */
async function sendWizardBotMessage(step, userMessage) {
  const messagesDiv = document.getElementById('wizardMessages');

  // Mostrar typing
  const typingId = 'wiz-typing-' + Date.now();
  messagesDiv.innerHTML += `<div class="chat-msg chat-msg-bot wizard-typing" id="${typingId}"><span><i class="fa-solid fa-ellipsis fa-beat-fade"></i> Escribiendo...</span></div>`;
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  try {
    const systemPrompt = getWizardSystemPrompt(step);
    const userMsg = userMessage || 'Hola, quiero configurar mi bot de WhatsApp.';

    const res = await fetch('/api/chatbot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userMsg,
        config: {
          wizardMode: true,
          context: systemPrompt,
          maxTokens: 600
        }
      })
    });

    const data = await res.json();
    const reply = data.reply || 'Lo siento, hubo un error. Intenta de nuevo.';

    // Reemplazar typing con respuesta
    const typingEl = document.getElementById(typingId);
    if (typingEl) {
      typingEl.classList.remove('wizard-typing');
      typingEl.innerHTML = `<span>${escapeAttr(reply)}</span>`;
    }

    wizardState.history.push({ role: 'bot', text: reply });

    // Mostrar quick replies según el paso
    showQuickRepliesForStep(step);

    // Si estamos en el paso de resumen, mostrar botones de acción
    if (step === 'fallbackMsg') {
      showWizardDoneActions();
    }

  } catch (err) {
    const typingEl = document.getElementById(typingId);
    if (typingEl) {
      typingEl.innerHTML = `<span style="color:var(--danger);">Error: ${escapeAttr(err.message)}</span>`;
    }
  }

  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

/**
 * Enviar mensaje del usuario en el wizard
 */
async function sendWizardMessage() {
  const input = document.getElementById('wizardInput');
  const msg = input.value.trim();
  if (!msg) return;
  if (!wizardState.active) {
    startConfigWizard();
    return;
  }

  const messagesDiv = document.getElementById('wizardMessages');

  // Mostrar mensaje del usuario
  messagesDiv.innerHTML += `<div class="chat-msg chat-msg-user"><span>${escapeAttr(msg)}</span></div>`;
  input.value = '';
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  clearQuickReplies();

  wizardState.history.push({ role: 'user', text: msg });

  // Procesar según el paso actual
  const currentStep = wizardState.steps[wizardState.step];
  processWizardStep(currentStep, msg);
}

/**
 * Procesar paso del wizard
 */
function processWizardStep(step, userMsg) {
  switch (step) {
    case 'greeting':
      wizardState.collected.businessName = userMsg;
      wizardState.step = 2; // skip to schedule (businessName was just collected)
      sendWizardBotMessage('businessName', userMsg);
      break;

    case 'businessName':
      wizardState.collected.schedule = userMsg;
      wizardState.step = 3;
      sendWizardBotMessage('schedule', userMsg);
      break;

    case 'schedule':
      // Interpretar personality
      const personalityMap = {
        '1': 'Profesional y formal. Usa un tono respetuoso y serio.',
        '2': 'Amigable y cercano. Usa un tono cálido y conversacional.',
        '3': 'Divertido y expresivo. Usa emojis frecuentemente y sé entusiasta.',
        '4': 'Directo y conciso. Ve al grano sin rodeos.'
      };
      wizardState.collected.personality = personalityMap[userMsg.trim()] || userMsg;
      wizardState.step = 4;
      sendWizardBotMessage('personality', wizardState.collected.personality);
      break;

    case 'personality':
      wizardState.collected.context = userMsg;
      wizardState.step = 5;
      sendWizardBotMessage('context', userMsg);
      break;

    case 'context':
      wizardState.collected.welcomeMsg = userMsg;
      wizardState.step = 6;
      sendWizardBotMessage('welcomeMsg', userMsg);
      break;

    case 'welcomeMsg':
      wizardState.collected.fallbackMsg = userMsg;
      wizardState.step = 7;
      sendWizardBotMessage('fallbackMsg', userMsg);
      break;

    case 'fallbackMsg':
    case 'summary':
      // Conversación libre post-configuración
      handlePostConfigMessage(userMsg);
      break;
  }
}

/**
 * Manejar mensajes después de completar la configuración
 */
async function handlePostConfigMessage(msg) {
  const lower = msg.toLowerCase();

  // Si quiere guardar
  if (lower.includes('guardar') || lower.includes('listo') || lower.includes('confirmar') || lower === 'sí' || lower === 'si') {
    applyWizardConfig();
    return;
  }

  // Todo lo demás: enviar al AI para detectar/aplicar cambios
  applyFieldChange(msg);
}

/**
 * Detectar y aplicar cambio de campo desde texto libre
 */
async function applyFieldChange(msg) {
  const messagesDiv = document.getElementById('wizardMessages');
  const typingId = 'wiz-typing-' + Date.now();
  messagesDiv.innerHTML += `<div class="chat-msg chat-msg-bot wizard-typing" id="${typingId}"><span><i class="fa-solid fa-ellipsis fa-beat-fade"></i> Analizando...</span></div>`;
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  try {
    const res = await fetch('/api/chatbot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `El usuario dice: "${msg}"

Configuración actual del bot:
${JSON.stringify(wizardState.collected, null, 2)}

Analiza si el usuario quiere modificar algún campo. Si es así, responde en EXACTAMENTE este formato JSON seguido de un mensaje:
{"field": "CAMPO", "value": "NUEVO_VALOR"}
MENSAJE_AMABLE

Donde CAMPO es uno de: businessName, schedule, personality, context, welcomeMsg, fallbackMsg.
Si no detectas un cambio, simplemente responde amablemente y pregunta si quiere guardar la configuración.`,
        config: {
          wizardMode: true,
          context: 'Eres un asistente que analiza intenciones del usuario para configuración de chatbot. Responde en español.',
          maxTokens: 300
        }
      })
    });

    const data = await res.json();
    const reply = data.reply || '';

    // Intentar extraer JSON del cambio
    const jsonMatch = reply.match(/\{[\s]*"field"[\s]*:[\s]*"(\w+)"[\s]*,[\s]*"value"[\s]*:[\s]*"([^"]+)"[\s]*\}/);
    if (jsonMatch) {
      const field = jsonMatch[1];
      const value = jsonMatch[2];
      if (wizardState.collected.hasOwnProperty(field)) {
        wizardState.collected[field] = value;
        // Sincronizar al formulario oculto inmediatamente
        const fieldMap = {
          businessName: 'botBusinessName',
          schedule: 'botSchedule',
          personality: 'botPersonality',
          context: 'botContext',
          welcomeMsg: 'botWelcomeMsg',
          fallbackMsg: 'botFallbackMsg'
        };
        const inputId = fieldMap[field];
        if (inputId) document.getElementById(inputId).value = value;
      }
    }

    // Mostrar la parte del mensaje (sin el JSON)
    const cleanReply = reply.replace(/\{[\s]*"field"[\s]*:[\s]*"[^"]*"[\s]*,[\s]*"value"[\s]*:[\s]*"[^"]*"[\s]*\}/, '').trim();

    const typingEl = document.getElementById(typingId);
    if (typingEl) {
      typingEl.classList.remove('wizard-typing');
      typingEl.innerHTML = `<span>${escapeAttr(cleanReply || 'Entendido. ¿Quieres guardar la configuración?')}</span>`;
    }
  } catch (err) {
    const typingEl = document.getElementById(typingId);
    if (typingEl) {
      typingEl.classList.remove('wizard-typing');
      typingEl.innerHTML = `<span style="color:var(--danger);">Error: ${escapeAttr(err.message)}</span>`;
    }
  }
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  showWizardDoneActions();
}

/**
 * Mostrar quick replies según el paso
 */
function showQuickRepliesForStep(step) {
  clearQuickReplies();
  const container = document.getElementById('wizardQuickReplies');

  const replies = {
    schedule: [
      { text: '🤝 Profesional', value: '1' },
      { text: '😊 Amigable', value: '2' },
      { text: '🎉 Divertido', value: '3' },
      { text: '📋 Directo', value: '4' }
    ]
  };

  const options = replies[step];
  if (!options) return;

  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'quick-reply-btn';
    btn.textContent = opt.text;
    btn.onclick = () => {
      document.getElementById('wizardInput').value = opt.value;
      sendWizardMessage();
    };
    container.appendChild(btn);
  });
}

function clearQuickReplies() {
  const container = document.getElementById('wizardQuickReplies');
  if (container) container.innerHTML = '';
}

/**
 * Mostrar botones de acción al terminar el wizard
 */
function showWizardDoneActions() {
  // Remove existing done actions
  document.querySelectorAll('.wizard-done-actions').forEach(el => el.remove());

  const messagesDiv = document.getElementById('wizardMessages');
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'wizard-done-actions';
  actionsDiv.innerHTML = `
    <button class="btn btn-primary" onclick="applyWizardConfig()">
      <i class="fa-solid fa-floppy-disk"></i> Guardar Configuración
    </button>
    <button class="btn btn-secondary" onclick="resetConfigWizard()">
      <i class="fa-solid fa-rotate-right"></i> Empezar de nuevo
    </button>
  `;
  messagesDiv.appendChild(actionsDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

/**
 * Aplicar la configuración recopilada por el wizard al formulario y guardar
 */
async function applyWizardConfig() {
  const c = wizardState.collected;

  // Rellenar campos del formulario oculto
  if (c.businessName) document.getElementById('botBusinessName').value = c.businessName;
  if (c.schedule) document.getElementById('botSchedule').value = c.schedule;
  if (c.personality) document.getElementById('botPersonality').value = c.personality;
  if (c.context) document.getElementById('botContext').value = c.context;
  if (c.welcomeMsg) document.getElementById('botWelcomeMsg').value = c.welcomeMsg;
  if (c.fallbackMsg) document.getElementById('botFallbackMsg').value = c.fallbackMsg;

  // Guardar usando la función existente
  const fakeEvent = { preventDefault: () => {} };
  await saveChatbotConfig(fakeEvent);

  // Limpiar actions previos
  document.querySelectorAll('.wizard-done-actions').forEach(el => el.remove());

  // Mostrar confirmación + resumen visual
  const messagesDiv = document.getElementById('wizardMessages');
  messagesDiv.innerHTML += `<div class="chat-msg chat-msg-bot"><span>✅ ¡Configuración guardada exitosamente!</span></div>`;

  const summaryDiv = document.createElement('div');
  summaryDiv.className = 'wizard-config-review';
  summaryDiv.innerHTML = `
    <div class="wizard-review-header">
      <i class="fa-solid fa-clipboard-check"></i> Resumen de tu configuración
    </div>
    <div class="wizard-review-grid">
      <div class="wizard-review-item">
        <span class="wizard-review-label"><i class="fa-solid fa-store"></i> Negocio</span>
        <span class="wizard-review-value">${escapeAttr(c.businessName || '—')}</span>
      </div>
      <div class="wizard-review-item">
        <span class="wizard-review-label"><i class="fa-solid fa-clock"></i> Horarios</span>
        <span class="wizard-review-value">${escapeAttr(c.schedule || '—')}</span>
      </div>
      <div class="wizard-review-item">
        <span class="wizard-review-label"><i class="fa-solid fa-masks-theater"></i> Personalidad</span>
        <span class="wizard-review-value">${escapeAttr(c.personality || '—')}</span>
      </div>
      <div class="wizard-review-item wizard-review-wide">
        <span class="wizard-review-label"><i class="fa-solid fa-book"></i> Contexto</span>
        <span class="wizard-review-value">${escapeAttr(c.context || '—')}</span>
      </div>
      <div class="wizard-review-item">
        <span class="wizard-review-label"><i class="fa-solid fa-hand-wave"></i> Bienvenida</span>
        <span class="wizard-review-value">${escapeAttr(c.welcomeMsg || '—')}</span>
      </div>
      <div class="wizard-review-item">
        <span class="wizard-review-label"><i class="fa-solid fa-circle-exclamation"></i> Fallback</span>
        <span class="wizard-review-value">${escapeAttr(c.fallbackMsg || '—')}</span>
      </div>
    </div>
    <div class="wizard-review-actions">
      <button class="btn btn-secondary btn-sm" onclick="editConfigField()">
        <i class="fa-solid fa-pen-to-square"></i> Editar con IA
      </button>
      <button class="btn btn-secondary btn-sm" onclick="toggleManualConfig()">
        <i class="fa-solid fa-sliders"></i> Editar manualmente
      </button>
      <button class="btn btn-secondary btn-sm" onclick="resetConfigWizard()">
        <i class="fa-solid fa-rotate-right"></i> Reconfigurar todo
      </button>
    </div>
  `;
  messagesDiv.appendChild(summaryDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  wizardState.active = false;
}

/**
 * Activar edición conversacional post-guardado
 */
function editConfigField() {
  // Sincronizar estado del wizard desde los campos del formulario
  wizardState.collected = {
    businessName: document.getElementById('botBusinessName').value.trim(),
    schedule: document.getElementById('botSchedule').value.trim(),
    personality: document.getElementById('botPersonality').value.trim(),
    context: document.getElementById('botContext').value.trim(),
    welcomeMsg: document.getElementById('botWelcomeMsg').value.trim(),
    fallbackMsg: document.getElementById('botFallbackMsg').value.trim()
  };
  wizardState.active = true;
  wizardState.step = 7; // summary step — free conversation mode

  const messagesDiv = document.getElementById('wizardMessages');
  // Quitar tarjeta de resumen
  document.querySelectorAll('.wizard-config-review').forEach(el => el.remove());

  // Mostrar config actual resumida para que el usuario sepa qué tiene
  const c = wizardState.collected;
  messagesDiv.innerHTML += `<div class="chat-msg chat-msg-bot"><span>✏️ Tu configuración actual es:\n\n🏪 Negocio: ${escapeAttr(c.businessName || '—')}\n🕐 Horarios: ${escapeAttr(c.schedule || '—')}\n🎭 Personalidad: ${escapeAttr(c.personality || '—')}\n📖 Contexto: ${escapeAttr((c.context || '—').substring(0, 80))}${(c.context || '').length > 80 ? '...' : ''}\n👋 Bienvenida: ${escapeAttr(c.welcomeMsg || '—')}\n⚠️ Fallback: ${escapeAttr(c.fallbackMsg || '—')}\n\nDime qué quieres cambiar. Por ejemplo:\n• "Cambiar el nombre a MiStreaming"\n• "Quiero un tono más divertido"\n• "Actualizar los horarios a 24/7"\n\nCuando termines, escribe "guardar".</span></div>`;
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  document.getElementById('wizardInput').focus();
}

/**
 * Mostrar resumen de la config actual (sin guardar de nuevo)
 */
function showCurrentConfigSummary() {
  const c = {
    businessName: document.getElementById('botBusinessName').value.trim(),
    schedule: document.getElementById('botSchedule').value.trim(),
    personality: document.getElementById('botPersonality').value.trim(),
    context: document.getElementById('botContext').value.trim(),
    welcomeMsg: document.getElementById('botWelcomeMsg').value.trim(),
    fallbackMsg: document.getElementById('botFallbackMsg').value.trim()
  };
  wizardState.collected = { ...c };

  const messagesDiv = document.getElementById('wizardMessages');
  // Limpiar cualquier resumen previo
  document.querySelectorAll('.wizard-config-review').forEach(el => el.remove());

  const summaryDiv = document.createElement('div');
  summaryDiv.className = 'wizard-config-review';
  summaryDiv.innerHTML = `
    <div class="wizard-review-header">
      <i class="fa-solid fa-clipboard-check"></i> Configuración actual
    </div>
    <div class="wizard-review-grid">
      <div class="wizard-review-item">
        <span class="wizard-review-label"><i class="fa-solid fa-store"></i> Negocio</span>
        <span class="wizard-review-value">${escapeAttr(c.businessName || '—')}</span>
      </div>
      <div class="wizard-review-item">
        <span class="wizard-review-label"><i class="fa-solid fa-clock"></i> Horarios</span>
        <span class="wizard-review-value">${escapeAttr(c.schedule || '—')}</span>
      </div>
      <div class="wizard-review-item">
        <span class="wizard-review-label"><i class="fa-solid fa-masks-theater"></i> Personalidad</span>
        <span class="wizard-review-value">${escapeAttr(c.personality || '—')}</span>
      </div>
      <div class="wizard-review-item wizard-review-wide">
        <span class="wizard-review-label"><i class="fa-solid fa-book"></i> Contexto</span>
        <span class="wizard-review-value">${escapeAttr(c.context || '—')}</span>
      </div>
      <div class="wizard-review-item">
        <span class="wizard-review-label"><i class="fa-solid fa-hand-wave"></i> Bienvenida</span>
        <span class="wizard-review-value">${escapeAttr(c.welcomeMsg || '—')}</span>
      </div>
      <div class="wizard-review-item">
        <span class="wizard-review-label"><i class="fa-solid fa-circle-exclamation"></i> Fallback</span>
        <span class="wizard-review-value">${escapeAttr(c.fallbackMsg || '—')}</span>
      </div>
    </div>
    <div class="wizard-review-actions">
      <button class="btn btn-secondary btn-sm" onclick="editConfigField()">
        <i class="fa-solid fa-pen-to-square"></i> Editar con IA
      </button>
      <button class="btn btn-secondary btn-sm" onclick="toggleManualConfig()">
        <i class="fa-solid fa-sliders"></i> Editar manualmente
      </button>
      <button class="btn btn-secondary btn-sm" onclick="resetConfigWizard()">
        <i class="fa-solid fa-rotate-right"></i> Reconfigurar todo
      </button>
    </div>
  `;
  messagesDiv.appendChild(summaryDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

/**
 * Reiniciar el wizard — carga config existente si la hay
 */
function resetConfigWizard() {
  const hasConfig = document.getElementById('botBusinessName').value.trim();

  wizardState.step = 0;
  wizardState.history = [];
  wizardState.active = true;

  // Cargar config existente del formulario
  if (hasConfig) {
    wizardState.collected = {
      businessName: document.getElementById('botBusinessName').value.trim(),
      schedule: document.getElementById('botSchedule').value.trim(),
      personality: document.getElementById('botPersonality').value.trim(),
      context: document.getElementById('botContext').value.trim(),
      welcomeMsg: document.getElementById('botWelcomeMsg').value.trim(),
      fallbackMsg: document.getElementById('botFallbackMsg').value.trim()
    };
  } else {
    wizardState.collected = {};
  }

  const messagesDiv = document.getElementById('wizardMessages');
  messagesDiv.innerHTML = '';
  clearQuickReplies();
  document.querySelectorAll('.wizard-done-actions').forEach(el => el.remove());
  document.querySelectorAll('.wizard-config-review').forEach(el => el.remove());

  if (hasConfig) {
    // Ya tiene config — ir directo a modo edición
    editConfigField();
  } else {
    // Sin config — iniciar wizard desde cero
    sendWizardBotMessage('greeting');
  }
}

/**
 * Alternar entre wizard y modo manual
 */
function toggleManualConfig() {
  const wizard = document.getElementById('configWizardChat');
  const form = document.getElementById('chatbotConfigForm');
  const btn = document.getElementById('btnToggleManual');

  if (form.style.display === 'none') {
    // Mostrar manual, ocultar wizard
    form.style.display = '';
    wizard.style.display = 'none';
    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Modo IA';
  } else {
    // Mostrar wizard, ocultar manual
    form.style.display = 'none';
    wizard.style.display = '';
    btn.innerHTML = '<i class="fa-solid fa-sliders"></i> Modo Manual';
    if (!wizardState.active && wizardState.history.length === 0) {
      startConfigWizard();
    }
  }
}

/* ============================================================
   CHATBOT — Conexión con el servidor del bot (HTTP API)
   ============================================================ */
const BOT_DEFAULT_URL = 'https://stremly-production.up.railway.app';
let botPollingInterval = null;

// Limpiar URLs corruptas guardadas anteriormente
(function cleanStaleBotUrl() {
  const saved = localStorage.getItem('streamly_bot_url');
  if (saved && (saved.includes(':8080') || saved.includes(':5500') || !saved.startsWith('http'))) {
    localStorage.removeItem('streamly_bot_url');
  }
})();

function getBotUrl() {
  // 1. Si el usuario escribió algo en el input avanzado, usarlo
  const input = document.getElementById('botServerUrl');
  const inputVal = input?.value?.trim().replace(/\/+$/, '') || '';
  if (inputVal && inputVal.startsWith('http')) return inputVal;
  // 2. Valor guardado en localStorage (ya validado por cleanStaleBotUrl)
  const saved = localStorage.getItem('streamly_bot_url');
  if (saved && saved.startsWith('http')) return saved;
  // 3. Default
  return BOT_DEFAULT_URL;
}

function saveBotUrl() {
  const input = document.getElementById('botServerUrl');
  const url = input?.value?.trim().replace(/\/+$/, '') || '';
  if (url && url.startsWith('http') && !url.includes(':8080')) {
    localStorage.setItem('streamly_bot_url', url);
  }
}

/**
 * Conectar al servidor del bot y empezar a hacer polling
 */
async function connectBotServer() {
  const url = getBotUrl();
  const statusEl = document.getElementById('botConnectionStatus');
  const dotEl = document.getElementById('botStatusDot');
  const autoConn = document.getElementById('botAutoConnecting');
  const connError = document.getElementById('botConnectionError');

  // Si no hay URL del bot configurada, no intentar conectar
  if (!url) {
    if (autoConn) autoConn.style.display = 'none';
    if (connError) connError.style.display = '';
    statusEl.textContent = 'No configurado';
    dotEl.className = 'bot-status-indicator disconnected';
    addBotLog('⚠️ URL del bot no configurada. Ingresa la URL de tu servidor Railway.');
    return;
  }

  // Mostrar estado "conectando"
  if (autoConn) autoConn.style.display = '';
  if (connError) connError.style.display = 'none';
  statusEl.textContent = 'Conectando...';
  dotEl.className = 'bot-status-indicator connecting';

  try {
    const res = await fetch(`${url}/status`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('No se pudo conectar');
    
    // Ocultar estado inicial, mostrar logs
    if (autoConn) autoConn.style.display = 'none';
    if (connError) connError.style.display = 'none';
    addBotLog(`🔗 Conectado al servidor: ${url}`);
    
    // Iniciar polling cada 2 segundos
    if (botPollingInterval) clearInterval(botPollingInterval);
    botPollingInterval = setInterval(() => pollBotStatus(), 2000);
    pollBotStatus(); // Primera consulta inmediata

    const logsEl = document.getElementById('botLogs');
    if (logsEl) logsEl.style.display = '';
  } catch (err) {
    // Mostrar panel de error con botón de reintentar
    if (autoConn) autoConn.style.display = 'none';
    if (connError) connError.style.display = '';
    statusEl.textContent = 'Desconectado';
    dotEl.className = 'bot-status-indicator disconnected';
    addBotLog(`❌ No se pudo conectar a ${url}. ¿Está corriendo el bot?`);
    const logsEl = document.getElementById('botLogs');
    if (logsEl) logsEl.style.display = '';
  }
}

/**
 * Detener polling y desconectar
 */
function disconnectBotServer() {
  if (botPollingInterval) {
    clearInterval(botPollingInterval);
    botPollingInterval = null;
  }
  document.getElementById('botConnectionStatus').textContent = 'Desconectado';
  document.getElementById('botStatusDot').className = 'bot-status-indicator disconnected';
  document.getElementById('botQrContainer').style.display = 'none';
  document.getElementById('botConnectedInfo').style.display = 'none';
  const autoConn = document.getElementById('botAutoConnecting');
  const connError = document.getElementById('botConnectionError');
  if (autoConn) autoConn.style.display = 'none';
  if (connError) connError.style.display = '';
  document.getElementById('botStatus').textContent = 'Desconectado';
  addBotLog('🔌 Desconectado del servidor del bot');
}

/**
 * Resetear sesión del bot para generar un nuevo QR
 */
async function resetBotSession() {
  const url = getBotUrl();
  if (!url) return;
  const statusEl = document.getElementById('botConnectionStatus');
  const dotEl = document.getElementById('botStatusDot');

  statusEl.textContent = 'Reseteando sesión...';
  dotEl.className = 'bot-status-indicator connecting';
  addBotLog('🔄 Reseteando sesión para nuevo QR...');

  try {
    const res = await fetch(`${url}/reset-session`, { method: 'POST' });
    if (!res.ok) throw new Error('No se pudo resetear la sesión');
    addBotLog('✅ Sesión reseteada, esperando nuevo QR...');
    // El polling detectará el nuevo QR automáticamente
    if (!botPollingInterval) {
      botPollingInterval = setInterval(() => pollBotStatus(), 2000);
      pollBotStatus();
    }
  } catch (err) {
    statusEl.textContent = 'Error al resetear sesión';
    dotEl.className = 'bot-status-indicator disconnected';
    addBotLog(`❌ Error: ${err.message}`);
  }
}

/**
 * Polling: consultar estado del bot
 */
async function pollBotStatus() {
  const url = getBotUrl();
  if (!url) return;
  try {
    const res = await fetch(`${url}/status`);
    if (!res.ok) throw new Error('Bot no responde');
    const data = await res.json();

    const statusEl = document.getElementById('botConnectionStatus');
    const dotEl = document.getElementById('botStatusDot');
    const qrContainer = document.getElementById('botQrContainer');
    const connectedInfo = document.getElementById('botConnectedInfo');

    // Actualizar stat card del dashboard
    document.getElementById('botStatus').textContent = 
      data.status === 'connected' ? 'Conectado' :
      data.status === 'qr' ? 'Esperando QR' :
      data.status === 'reconnecting' ? 'Reconectando...' : 'Desconectado';
    
    document.getElementById('botMessagesCount').textContent = data.messagesCount || 0;

    if (data.status === 'connected') {
      statusEl.textContent = `Conectado — ${data.phone || 'WhatsApp'}`;
      dotEl.className = 'bot-status-indicator connected';
      qrContainer.style.display = 'none';
      connectedInfo.style.display = '';
      // Ocultar otros paneles
      const autoConn = document.getElementById('botAutoConnecting');
      const connError = document.getElementById('botConnectionError');
      if (autoConn) autoConn.style.display = 'none';
      if (connError) connError.style.display = 'none';
      document.getElementById('botPhoneNumber').textContent = 
        `${data.phone || ''} — ${data.messagesCount} mensajes respondidos`;
    } else if (data.status === 'qr') {
      statusEl.textContent = 'Esperando escaneo de QR...';
      dotEl.className = 'bot-status-indicator qr';
      connectedInfo.style.display = 'none';
      qrContainer.style.display = '';
      // Ocultar otros paneles
      const autoConn = document.getElementById('botAutoConnecting');
      const connError = document.getElementById('botConnectionError');
      if (autoConn) autoConn.style.display = 'none';
      if (connError) connError.style.display = 'none';
      // Cargar imagen del QR
      fetchBotQr();
    } else if (data.status === 'reconnecting') {
      statusEl.textContent = 'Reconectando...';
      dotEl.className = 'bot-status-indicator connecting';
      qrContainer.style.display = 'none';
      connectedInfo.style.display = 'none';
    } else {
      statusEl.textContent = 'Bot desconectado';
      dotEl.className = 'bot-status-indicator disconnected';
      qrContainer.style.display = 'none';
      connectedInfo.style.display = 'none';
    }

    // Actualizar logs
    if (data.logs && data.logs.length > 0) {
      const logsEl = document.getElementById('botLogsContent');
      logsEl.innerHTML = data.logs.map(l => 
        `<div class="bot-log-entry"><span class="bot-log-time">${new Date(l.time).toLocaleTimeString()}</span> ${escapeAttr(l.msg)}</div>`
      ).join('');
      logsEl.scrollTop = logsEl.scrollHeight;
    }

  } catch (err) {
    // Bot no responde, parar polling
    disconnectBotServer();
    addBotLog('❌ Se perdió la conexión con el servidor del bot');
  }
}

/**
 * Obtener imagen del QR
 */
async function fetchBotQr() {
  const url = getBotUrl();
  if (!url) return;
  try {
    const res = await fetch(`${url}/qr`);
    const data = await res.json();
    if (data.qr) {
      document.getElementById('botQrCode').innerHTML = `<img src="${data.qr}" alt="QR WhatsApp" />`;
    }
  } catch (_) {}
}

/**
 * Agregar log local
 */
function addBotLog(msg) {
  const logsEl = document.getElementById('botLogsContent');
  if (!logsEl) return;
  logsEl.innerHTML += `<div class="bot-log-entry"><span class="bot-log-time">${new Date().toLocaleTimeString()}</span> ${escapeAttr(msg)}</div>`;
  logsEl.scrollTop = logsEl.scrollHeight;
}

/* ============================================================
   CHATBOT — Conversaciones activas
   ============================================================ */
let currentConvJid = null;
let convPollingInterval = null;

/**
 * Cargar lista de conversaciones desde el bot server
 */
async function loadConversations() {
  const url = getBotUrl();
  if (!url) return;
  try {
    const res = await fetch(`${url}/conversations`);
    if (!res.ok) return;
    const data = await res.json();
    renderConversationList(data.conversations || []);
  } catch (err) {
    console.warn('No se pudieron cargar conversaciones:', err.message);
  }
}

/**
 * Renderizar lista de conversaciones
 */
function renderConversationList(convs) {
  const el = document.getElementById('convList');
  if (!convs || convs.length === 0) {
    el.innerHTML = `
      <div class="conv-list-empty">
        <i class="fa-solid fa-inbox"></i>
        <p>Sin conversaciones aún</p>
        <small>Los chats aparecerán aquí cuando lleguen mensajes</small>
      </div>`;
    return;
  }

  el.innerHTML = convs.map(c => {
    const active = c.jid === currentConvJid ? 'active' : '';
    const timeStr = c.lastTimestamp ? new Date(c.lastTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const icon = c.isGroup ? 'fa-people-group' : 'fa-user';
    const pauseIcon = c.paused ? '<span class="conv-paused-badge" title="Bot pausado"><i class="fa-solid fa-pause"></i></span>' : '';
    const unreadBadge = c.unread > 0 ? `<span class="conv-unread-badge">${c.unread}</span>` : '';
    const lastFrom = c.lastFrom === 'bot' ? '🤖 ' : c.lastFrom === 'agent' ? '👤 ' : '';
    const preview = c.lastMessage ? `${lastFrom}${escapeAttr(c.lastMessage)}` : '<i>Sin mensajes</i>';

    return `
      <div class="conv-item ${active}" onclick="openConversation('${escapeAttr(c.jid)}')">
        <div class="conv-item-avatar">
          <i class="fa-solid ${icon}"></i>
        </div>
        <div class="conv-item-info">
          <div class="conv-item-top">
            <strong class="conv-item-name">${escapeAttr(c.name || c.phone)}</strong>
            <span class="conv-item-time">${timeStr}</span>
          </div>
          <div class="conv-item-bottom">
            <span class="conv-item-preview">${preview}</span>
            <div class="conv-item-badges">
              ${pauseIcon}
              ${unreadBadge}
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
}

/**
 * Abrir una conversación específica
 */
async function openConversation(jid) {
  currentConvJid = jid;
  const url = getBotUrl();
  if (!url) return;

  // Mostrar loading
  document.getElementById('convChatHeader').style.display = 'flex';
  document.getElementById('convMessages').style.display = 'flex';
  document.getElementById('convReply').style.display = 'flex';
  document.querySelector('.conv-chat-placeholder').style.display = 'none';

  try {
    const res = await fetch(`${url}/conversation/${encodeURIComponent(jid)}`);
    if (!res.ok) throw new Error('No se pudo cargar la conversación');
    const data = await res.json();

    // Header
    document.getElementById('convChatName').textContent = data.name || data.phone;
    document.getElementById('convChatPhone').textContent = data.phone;
    if (data.isGroup) {
      document.getElementById('convChatAvatar').innerHTML = '<i class="fa-solid fa-people-group"></i>';
    } else {
      document.getElementById('convChatAvatar').innerHTML = '<i class="fa-solid fa-user"></i>';
    }

    // Pause button
    updatePauseButton(data.paused);

    // Mensajes
    renderConvMessages(data.messages || []);

    // Refrescar lista para quitar unread
    loadConversations();

    // Iniciar polling de esta conversación
    if (convPollingInterval) clearInterval(convPollingInterval);
    convPollingInterval = setInterval(() => refreshCurrentConversation(), 3000);
  } catch (err) {
    document.getElementById('convMessages').innerHTML = `<div style="text-align:center; color:var(--danger); padding:20px;">${escapeAttr(err.message)}</div>`;
  }
}

/**
 * Refrescar mensajes de la conversación actual
 */
async function refreshCurrentConversation() {
  if (!currentConvJid) return;
  const url = getBotUrl();
  if (!url) return;
  try {
    const res = await fetch(`${url}/conversation/${encodeURIComponent(currentConvJid)}`);
    if (!res.ok) return;
    const data = await res.json();
    renderConvMessages(data.messages || []);
    updatePauseButton(data.paused);
    // También refrescar la lista
    loadConversations();
  } catch (_) {}
}

/**
 * Renderizar mensajes de un chat
 */
function renderConvMessages(messages) {
  const el = document.getElementById('convMessages');
  const wasAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;

  el.innerHTML = messages.map(m => {
    const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let cssClass, label;
    if (m.from === 'customer') {
      cssClass = 'conv-msg-customer';
      label = '';
    } else if (m.from === 'bot') {
      cssClass = 'conv-msg-bot';
      label = '<span class="conv-msg-label">🤖 Bot</span>';
    } else {
      cssClass = 'conv-msg-agent';
      label = '<span class="conv-msg-label">👤 Tú</span>';
    }
    return `
      <div class="conv-msg ${cssClass}">
        ${label}
        <span class="conv-msg-text">${escapeAttr(m.text)}</span>
        <span class="conv-msg-time">${time}</span>
      </div>`;
  }).join('');

  if (wasAtBottom) el.scrollTop = el.scrollHeight;
}

/**
 * Enviar respuesta manual
 */
async function sendConvReply() {
  if (!currentConvJid) return;
  const input = document.getElementById('convReplyInput');
  const message = input.value.trim();
  if (!message) return;

  const url = getBotUrl();
  if (!url) { showToast('Bot no configurado', 'error'); return; }
  input.value = '';
  input.disabled = true;

  try {
    const res = await fetch(`${url}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid: currentConvJid, message })
    });

    if (!res.ok) {
      const err = await res.json();
      showToast(err.error || 'Error al enviar', 'error');
    } else {
      // Refrescar inmediatamente
      await refreshCurrentConversation();
    }
  } catch (err) {
    showToast('Error al enviar: ' + err.message, 'error');
  }
  input.disabled = false;
  input.focus();
}

/**
 * Pausar / Reanudar conversación
 */
async function toggleConvPause() {
  if (!currentConvJid) return;
  const url = getBotUrl();
  if (!url) return;
  try {
    const res = await fetch(`${url}/pause/${encodeURIComponent(currentConvJid)}`, { method: 'POST' });
    const data = await res.json();
    updatePauseButton(data.paused);
    showToast(data.paused ? 'Bot pausado para este chat' : 'Bot reanudado para este chat', 'info');
    loadConversations();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

function updatePauseButton(paused) {
  const btn = document.getElementById('convPauseBtn');
  const label = document.getElementById('convPauseLabel');
  if (paused) {
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-warning');
    btn.querySelector('i').className = 'fa-solid fa-play';
    label.textContent = 'Reanudar';
  } else {
    btn.classList.remove('btn-warning');
    btn.classList.add('btn-secondary');
    btn.querySelector('i').className = 'fa-solid fa-pause';
    label.textContent = 'Pausar';
  }
}

/* ============================================================
   CHATBOT — Ajustes del Bot (filtros)
   ============================================================ */

/**
 * Cargar ajustes del bot desde el servidor
 */
async function loadBotSettings() {
  const url = getBotUrl();
  if (!url) return;
  try {
    const res = await fetch(`${url}/settings`);
    if (!res.ok) return;
    const settings = await res.json();
    document.getElementById('settingRespondGroups').checked = !!settings.respondGroups;
    document.getElementById('settingRespondSaved').checked = settings.respondSaved !== false;
    document.getElementById('settingRespondUnsaved').checked = settings.respondUnsaved !== false;
  } catch (_) {}
}

/**
 * Guardar ajustes del bot
 */
async function saveBotSettings() {
  const url = getBotUrl();
  if (!url) { showToast('Bot no configurado', 'error'); return; }
  const settings = {
    respondGroups: document.getElementById('settingRespondGroups').checked,
    respondSaved: document.getElementById('settingRespondSaved').checked,
    respondUnsaved: document.getElementById('settingRespondUnsaved').checked
  };
  try {
    const res = await fetch(`${url}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    if (res.ok) {
      showToast('Filtros actualizados', 'success');
    }
  } catch (err) {
    showToast('Error guardando filtros: ' + err.message, 'error');
  }
}

/* ============================================================
   CHATBOT — Cuentas disponibles (inventario para venta)
   ============================================================ */

/**
 * Cargar cuentas disponibles desde el bot server
 */
async function loadAvailableAccounts() {
  const url = getBotUrl();
  const el = document.getElementById('availableAccountsList');
  if (!url) {
    // Sin bot server, calcular desde datos locales
    if (accountsData.length > 0) {
      const platforms = {};
      accountsData.forEach(acc => {
        const p = acc.plataforma;
        if (!platforms[p]) platforms[p] = { total: 0, ocupados: 0 };
        platforms[p].total += (acc.perfiles_totales || 0);
      });
      clientsData.forEach(cl => {
        const p = cl.plataforma || '';
        if (platforms[p]) platforms[p].ocupados++;
      });
      const accounts = Object.entries(platforms).map(([name, data]) => ({
        plataforma: name,
        disponibles: Math.max(0, data.total - data.ocupados),
        total: data.total,
        ocupados: data.ocupados
      }));
      renderAvailableAccounts(accounts);
    }
    return;
  }
  try {
    const res = await fetch(`${url}/available-accounts`);
    if (!res.ok) throw new Error('No se pudo cargar');
    const data = await res.json();
    renderAvailableAccounts(data.accounts || []);
  } catch (err) {
    // Fallback: calcular desde datos locales
    if (accountsData.length > 0) {
      const platforms = {};
      accountsData.forEach(acc => {
        const p = acc.plataforma;
        if (!platforms[p]) platforms[p] = { total: 0, ocupados: 0 };
        platforms[p].total += (acc.perfiles_totales || 0);
      });
      clientsData.forEach(cl => {
        const p = cl.plataforma || '';
        if (platforms[p]) platforms[p].ocupados++;
      });
      const accounts = Object.entries(platforms).map(([name, data]) => ({
        plataforma: name,
        disponibles: Math.max(0, data.total - data.ocupados),
        total: data.total,
        ocupados: data.ocupados
      }));
      renderAvailableAccounts(accounts);
    } else {
      el.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:20px;">No se pudo cargar — ¿Está conectado el bot?</div>`;
    }
  }
}

/**
 * Renderizar tarjetas de inventario
 */
function renderAvailableAccounts(accounts) {
  const el = document.getElementById('availableAccountsList');
  if (!accounts || accounts.length === 0) {
    el.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:20px;"><i class="fa-solid fa-box-open"></i><p>No hay cuentas registradas</p></div>`;
    return;
  }

  el.innerHTML = accounts.map(a => {
    const avail = a.disponibles;
    const statusClass = avail > 0 ? 'available' : 'sold-out';
    const statusText = avail > 0 ? `${avail} disponible${avail > 1 ? 's' : ''}` : 'Agotado';
    const icon = avail > 0 ? 'fa-circle-check' : 'fa-circle-xmark';
    const iconColor = avail > 0 ? 'var(--success)' : 'var(--danger)';

    return `
      <div class="avail-card ${statusClass}">
        <div class="avail-card-header">
          <strong>${escapeAttr(a.plataforma)}</strong>
          <i class="fa-solid ${icon}" style="color:${iconColor};"></i>
        </div>
        <div class="avail-card-body">
          <div class="avail-stat">
            <span>${a.ocupados}</span>
            <small>Ocupados</small>
          </div>
          <div class="avail-stat">
            <span>${avail}</span>
            <small>Libres</small>
          </div>
          <div class="avail-stat">
            <span>${a.total}</span>
            <small>Total</small>
          </div>
        </div>
        <div class="avail-card-status ${statusClass}">${statusText}</div>
      </div>`;
  }).join('');
}

/* ============================================================
   CHATBOT — Integración con polling del bot
   ============================================================ */

/**
 * Sincronizar contexto desde el panel hacia el bot server.
 * Esto permite que el bot tenga la config y las cuentas disponibles
 * aunque el Firebase Admin SDK no tenga credenciales.
 */
async function syncContextToBot() {
  const url = getBotUrl();
  if (!url) { showToast('Configura la URL del bot primero', 'warning'); return; }
  try {
    // Construir la config desde el formulario o desde Firestore
    const config = {
      businessName: document.getElementById('botBusinessName').value.trim(),
      schedule: document.getElementById('botSchedule').value.trim(),
      personality: document.getElementById('botPersonality').value.trim(),
      context: document.getElementById('botContext').value.trim(),
      welcomeMsg: document.getElementById('botWelcomeMsg').value.trim(),
      fallbackMsg: document.getElementById('botFallbackMsg').value.trim(),
      enabled: document.getElementById('botEnabled').value === 'true',
      maxTokens: parseInt(document.getElementById('botMaxTokens').value)
    };

    // Calcular cuentas disponibles desde los datos locales
    const platforms = {};
    accountsData.forEach(acc => {
      const p = acc.plataforma;
      if (!platforms[p]) platforms[p] = { total: 0, ocupados: 0 };
      platforms[p].total += (acc.perfiles_totales || 0);
    });
    clientsData.forEach(cl => {
      const p = cl.plataforma || '';
      const fin = cl.fecha_fin instanceof Date ? cl.fecha_fin :
        (cl.fecha_fin?.toDate ? cl.fecha_fin.toDate() : new Date(cl.fecha_fin));
      if (fin && fin > new Date() && platforms[p]) {
        platforms[p].ocupados++;
      }
    });
    const accounts = Object.entries(platforms).map(([name, data]) => ({
      plataforma: name,
      disponibles: Math.max(0, data.total - data.ocupados),
      total: data.total,
      ocupados: data.ocupados
    }));

    await fetch(`${url}/sync-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, accounts })
    });
    console.log('📋 Contexto sincronizado al bot');
  } catch (err) {
    console.warn('No se pudo sincronizar contexto al bot:', err.message);
  }
}

// Extender connectBotServer para cargar conversaciones y settings
const _originalConnectBotServer = connectBotServer;
connectBotServer = async function() {
  await _originalConnectBotServer();
  // Solo cargar datos si la conexión fue exitosa (botPollingInterval se setea en éxito)
  if (!botPollingInterval) return;
  setTimeout(() => {
    syncContextToBot();
    loadConversations();
    loadBotSettings();
    loadAvailableAccounts();
    loadPendingOrders();
  }, 1000);
  // Polling de conversaciones cada 5s
  if (!window._convListPolling) {
    window._convListPolling = setInterval(loadConversations, 5000);
  }
  // Polling de pedidos cada 4s
  if (!window._ordersPolling) {
    window._ordersPolling = setInterval(loadPendingOrders, 4000);
  }
};

// Re-sincronizar cuando se guarda la config del chatbot
const _originalSaveChatbotConfig = saveChatbotConfig;
saveChatbotConfig = async function(e) {
  await _originalSaveChatbotConfig(e);
  setTimeout(syncContextToBot, 500);
};

const _originalDisconnectBotServer = disconnectBotServer;
disconnectBotServer = function() {
  _originalDisconnectBotServer();
  if (window._convListPolling) {
    clearInterval(window._convListPolling);
    window._convListPolling = null;
  }
  if (convPollingInterval) {
    clearInterval(convPollingInterval);
    convPollingInterval = null;
  }
  if (window._ordersPolling) {
    clearInterval(window._ordersPolling);
    window._ordersPolling = null;
  }
};

/* ============================================================
   PEDIDOS PENDIENTES — Notificación con sonido
   ============================================================ */

// Sonido de notificación usando Web Audio API
let audioCtx = null;
function playOrderNotificationSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Melodía de 3 notas ascendentes (do-mi-sol)
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + i * 0.15 + 0.4);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + i * 0.15);
      osc.stop(audioCtx.currentTime + i * 0.15 + 0.4);
    });
    // Segundo acorde más fuerte para llamar atención
    setTimeout(() => {
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.value = 1046.5; // C6
      gain2.gain.setValueAtTime(0.25, audioCtx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.start(audioCtx.currentTime);
      osc2.stop(audioCtx.currentTime + 0.5);
    }, 500);
  } catch (_) {
    console.warn('No se pudo reproducir sonido de notificación');
  }
}

// Rastrear IDs de pedidos ya notificados para no repetir
let knownOrderIds = new Set();
let lastOrdersData = [];

/**
 * Cargar pedidos pendientes desde el bot
 */
async function loadPendingOrders() {
  const url = getBotUrl();
  if (!url) return;
  try {
    const res = await fetch(`${url}/orders`);
    if (!res.ok) return;
    const data = await res.json();
    const orders = data.orders || [];
    lastOrdersData = orders;

    // Detectar nuevos pedidos para notificar
    const newOrders = orders.filter(o => !knownOrderIds.has(o.id) && o.estado === 'pendiente');
    
    // Registrar todos los IDs conocidos
    orders.forEach(o => knownOrderIds.add(o.id));

    // Notificar nuevos pedidos
    if (newOrders.length > 0) {
      playOrderNotificationSound();
      for (const order of newOrders) {
        showOrderNotification(order);
      }
    }

    renderPendingOrders(orders);

    // Actualizar badge en el nav
    const navBadge = document.getElementById('navOrdersBadge');
    if (navBadge) {
      if (pendientes.length > 0) {
        navBadge.textContent = pendientes.length;
        navBadge.style.display = '';
      } else {
        navBadge.style.display = 'none';
      }
    }
  } catch (_) {}
}

/**
 * Mostrar notificación visual de nuevo pedido
 */
function showOrderNotification(order) {
  // Quitar notificaciones anteriores si hay muchas
  document.querySelectorAll('.order-notification').forEach(n => n.remove());

  const notif = document.createElement('div');
  notif.className = 'order-notification';
  notif.innerHTML = `
    <div class="order-notification-icon">
      <i class="fa-solid fa-cart-shopping"></i>
    </div>
    <div class="order-notification-body">
      <div class="order-notification-title">🛒 Nuevo Pedido #${order.id}</div>
      <div class="order-notification-detail">
        <strong>${escapeAttr(order.nombre)}</strong> quiere <strong>${escapeAttr(order.plataforma)}</strong>
      </div>
    </div>
    <button class="order-notification-close" onclick="event.stopPropagation(); this.parentElement.remove();">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;

  // Click en la notificación navega a Clientes
  notif.addEventListener('click', () => {
    navigateTo('clientes');
    notif.remove();
  });

  document.body.appendChild(notif);

  // Auto-remove en 8 segundos
  setTimeout(() => {
    if (notif.parentElement) {
      notif.style.animation = 'slideOutRight 0.4s ease-in forwards';
      setTimeout(() => notif.remove(), 400);
    }
  }, 8000);
}

/**
 * Renderizar tabla de pedidos pendientes
 */
function renderPendingOrders(orders) {
  const container = document.getElementById('pendingOrdersContainer');
  const tbody = document.getElementById('pendingOrdersBody');
  const countEl = document.getElementById('pendingOrdersCount');

  if (!container || !tbody) return;

  const pendientes = orders.filter(o => o.estado === 'pendiente');

  if (orders.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = '';
  countEl.textContent = pendientes.length;

  tbody.innerHTML = orders.map(o => {
    const fecha = new Date(o.timestamp || o.fechaHora);
    const fechaStr = fecha.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' + 
                     fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const statusClass = o.estado === 'pendiente' ? 'order-status-pendiente' : 'order-status-completado';
    const statusText = o.estado === 'pendiente' ? 'PENDIENTE' : o.estado.toUpperCase();

    const waPhone = (o.telefono || '').replace(/[^0-9]/g, '');
    const waLink = waPhone ? `https://wa.me/${waPhone}` : '#';

    return `
      <tr>
        <td><strong>#${o.id}</strong></td>
        <td><strong>${escapeAttr(o.nombre)}</strong></td>
        <td>
          <button class="btn-whatsapp" onclick="window.open('${escapeAttr(waLink)}', '_blank')" title="Abrir WhatsApp">
            <i class="fa-brands fa-whatsapp"></i>
            ${escapeAttr(o.telefono)}
          </button>
        </td>
        <td>${renderPlatformTag(o.plataforma)}</td>
        <td>${o.cantidad || 1}</td>
        <td>${fechaStr}</td>
        <td><span class="${statusClass}">${statusText}</span></td>
        <td>
          <div class="order-actions">
            ${o.estado === 'pendiente' ? `
              <button class="btn btn-sm" style="background: var(--success); color: #fff; padding: 4px 10px; font-size: 0.75rem; border-radius: 6px; display: flex; align-items: center; gap: 4px;" onclick="completeOrder(${o.id})" title="Asignar cuenta y completar pedido">
                <i class="fa-solid fa-circle-check"></i> Asignar
              </button>
            ` : '<span class="order-status-completado">COMPLETADO</span>'}
            <button class="btn-icon" onclick="deleteOrder(${o.id})" title="Eliminar pedido">
              <i class="fa-solid fa-trash-can" style="color: var(--danger);"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

/**
 * Completar pedido → abrir formulario de cliente pre-llenado
 */
let pendingOrderToComplete = null;

async function completeOrder(id) {
  // Buscar el pedido en lastOrdersData
  const order = lastOrdersData.find(o => o.id === id);
  if (!order) {
    showToast('Pedido no encontrado', 'error');
    return;
  }

  // Guardar referencia al pedido que estamos procesando
  pendingOrderToComplete = order;

  // Navegar a la sección de clientes
  navigateTo('clientes');

  // Esperar un poco para que la sección sea visible, luego abrir modal
  setTimeout(() => {
    populateAccountSelect(order.plataforma);

    // Pre-llenar formulario con datos del pedido
    document.getElementById('clientId').value = '';
    document.getElementById('clientName').value = order.nombre || '';
    document.getElementById('clientWhatsapp').value = order.telefono || '';
    document.getElementById('clientProfile').value = '';
    document.getElementById('clientPin').value = '';
    document.getElementById('clientPrice').value = '';

    // Fechas: hoy → +30 días
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 30);
    document.getElementById('clientStart').value = toInputDate(today);
    document.getElementById('clientEnd').value = toInputDate(endDate);

    document.getElementById('clientPaymentStatus').value = 'pendiente';
    document.getElementById('clientModalTitle').innerHTML = `<i class="fa-solid fa-cart-shopping" style="color: var(--warning);"></i> Asignar Pedido #${order.id} — ${escapeAttr(order.plataforma)}`;

    // Auto-seleccionar primera cuenta que coincida con la plataforma
    const matchingAccount = accountsData.find(acc => {
      const clientCount = clientsData.filter(c => c.cuenta_id === acc.id).length;
      return acc.plataforma === order.plataforma && (acc.perfiles_totales - clientCount) > 0;
    });
    if (matchingAccount) {
      document.getElementById('clientAccount').value = matchingAccount.id;
      updateProfileOptions();
    }

    openModal('clientModal');

    // Mostrar botón "Guardar y Enviar Credenciales"
    const sendCredsBtn = document.getElementById('btnSaveAndSendCreds');
    if (sendCredsBtn) sendCredsBtn.style.display = '';

    // Scroll al formulario
    document.getElementById('section-clientes').scrollIntoView({ behavior: 'smooth' });
  }, 300);
}

/**
 * Guardar cliente Y abrir WhatsApp con credenciales
 */
let sendCredsAfterSave = false;

async function saveAndSendCredentials() {
  sendCredsAfterSave = true;
  document.getElementById('clientForm').requestSubmit();
}

/**
 * Eliminar pedido
 */
async function deleteOrder(id) {
  const url = getBotUrl();
  if (!url) return;
  try {
    const res = await fetch(`${url}/orders/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Pedido eliminado', 'success');
      knownOrderIds.delete(id);
      await loadPendingOrders();
    }
  } catch (err) {
    showToast('Error eliminando pedido: ' + err.message, 'error');
  }
}
