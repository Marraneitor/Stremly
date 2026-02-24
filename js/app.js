/* ============================================================
   Streamly — Main Application Logic
   CRUD para Cuentas, Clientes y Movimientos
   ============================================================ */

// ── Estado local (caché de datos) ───────────────────────────
let accountsData   = [];
let clientsData    = [];
let movementsData  = [];

// ── Plan / Suscripción ──────────────────────────────────────
let currentPlan = 'free'; // 'free' | 'lite' | 'premium'

const PLAN_CONFIG = {
  free:    { maxClients: 20,       label: 'Free',    allow: [] },
  lite:    { maxClients: 49,       label: 'Lite',    allow: ['reportes', 'calendario'] },
  premium: { maxClients: Infinity, label: 'Premium', allow: ['reportes', 'calendario', 'deudores', 'plantillas', 'logs', 'chatbot'] }
};

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
      loadMovements(),
      loadUserPlan()
    ]);
    updateDashboard();
    updateReports();
    populateAccountSelect();
    populateClientSelect();
    loadChatbotConfig();
    applyPlanRestrictions();
  } catch (error) {
    console.error('Error cargando datos:', error);
    showToast('Error cargando datos. Verifica la conexión.', 'error');
  }
}

/* ============================================================
   PLAN / SUSCRIPCIÓN
   ============================================================ */

/**
 * Cargar plan del usuario desde Firestore
 */
async function loadUserPlan() {
  if (!currentUser || !db) return;
  try {
    const doc = await db.collection('usuarios').doc(currentUser.uid).get();
    if (doc.exists && doc.data().plan) {
      currentPlan = doc.data().plan;
    } else {
      currentPlan = 'free';
    }
  } catch (err) {
    console.warn('No se pudo cargar plan, usando free:', err.message);
    currentPlan = 'free';
  }
}

/**
 * Aplicar restricciones visuales del plan (sidebar locks, badge)
 */
function applyPlanRestrictions() {
  const cfg = PLAN_CONFIG[currentPlan] || PLAN_CONFIG.free;
  const toolSections = ['reportes', 'calendario', 'deudores', 'plantillas', 'logs', 'chatbot'];

  // Mostrar/ocultar candados en el sidebar
  toolSections.forEach(s => {
    const lockEl = document.getElementById('lock' + s.charAt(0).toUpperCase() + s.slice(1));
    if (lockEl) {
      lockEl.style.display = cfg.allow.includes(s) ? 'none' : 'inline';
    }
  });

  // Actualizar badge del sidebar
  const badgeName = document.getElementById('sidebarPlanName');
  const badge = document.getElementById('sidebarPlanBadge');
  if (badgeName) badgeName.textContent = cfg.label;
  if (badge) {
    badge.className = 'plan-badge-sidebar plan-badge-' + currentPlan;
  }

  // Actualizar página "Mi Plan"
  updatePlanPage();
}

/**
 * Actualizar la página de planes
 */
function updatePlanPage() {
  const cfg = PLAN_CONFIG[currentPlan] || PLAN_CONFIG.free;
  const totalClients = clientsData.length;
  const maxC = cfg.maxClients === Infinity ? '∞' : cfg.maxClients;

  // Plan actual card
  const nameEl = document.getElementById('currentPlanName');
  const detailEl = document.getElementById('currentPlanDetail');
  const usageText = document.getElementById('planUsageText');
  const usageFill = document.getElementById('planUsageFill');
  const planCard = document.getElementById('currentPlanCard');

  if (nameEl) nameEl.textContent = cfg.label;
  if (detailEl) detailEl.textContent = cfg.maxClients === Infinity ? 'Clientes ilimitados' : `Hasta ${cfg.maxClients} clientes`;
  if (usageText) usageText.textContent = `${totalClients} / ${maxC} clientes`;
  if (planCard) planCard.className = 'current-plan-card current-plan-' + currentPlan;

  if (usageFill) {
    const pct = cfg.maxClients === Infinity ? Math.min((totalClients / 100) * 100, 100) : Math.min((totalClients / cfg.maxClients) * 100, 100);
    usageFill.style.width = pct + '%';
    if (pct >= 90) usageFill.classList.add('usage-danger');
    else if (pct >= 70) usageFill.classList.add('usage-warning');
    else usageFill.classList.remove('usage-danger', 'usage-warning');
  }

  // Highlight current plan card
  ['Free', 'Lite', 'Premium'].forEach(p => {
    const card = document.getElementById('planCard' + p);
    if (card) card.classList.toggle('pricing-card-active', currentPlan === p.toLowerCase());
  });

  // Update buttons
  const plans = ['free', 'lite', 'premium'];
  plans.forEach(p => {
    const btn = document.getElementById('btnSelect' + p.charAt(0).toUpperCase() + p.slice(1));
    if (btn) {
      if (p === currentPlan) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Plan Actual';
      } else {
        btn.disabled = false;
        const labels = { free: 'Elegir Free', lite: '<i class="fa-solid fa-arrow-up"></i> Elegir Lite', premium: '<i class="fa-solid fa-crown"></i> Elegir Premium' };
        btn.innerHTML = labels[p];
      }
    }
  });
}

/**
 * Verificar si el usuario puede acceder a una sección
 */
function canAccessSection(section) {
  const toolSections = ['reportes', 'calendario', 'deudores', 'plantillas', 'logs', 'chatbot'];
  if (!toolSections.includes(section)) return true; // dashboard, cuentas, clientes, movimientos always allowed
  const cfg = PLAN_CONFIG[currentPlan] || PLAN_CONFIG.free;
  return cfg.allow.includes(section);
}

/**
 * Verificar si puede agregar más clientes
 */
function canAddMoreClients() {
  const cfg = PLAN_CONFIG[currentPlan] || PLAN_CONFIG.free;
  return clientsData.length < cfg.maxClients;
}

/**
 * Mostrar modal de upgrade
 */
function showUpgradeModal(title, msg) {
  const modalTitle = document.getElementById('upgradeModalTitle');
  const modalMsg = document.getElementById('upgradeModalMsg');
  if (modalTitle) modalTitle.textContent = title || 'Mejora tu plan';
  if (modalMsg) modalMsg.textContent = msg || 'Esta función no está disponible en tu plan actual.';
  document.getElementById('upgradePlanModal').classList.add('active');
}

/**
 * Seleccionar un plan (guardar en Firestore)
 */
async function selectPlan(plan) {
  if (!currentUser || !db) return;
  if (plan === currentPlan) return;

  // Si baja de plan, verificar que no exceda el límite
  const newCfg = PLAN_CONFIG[plan];
  if (clientsData.length > newCfg.maxClients) {
    showToast(`No puedes cambiar a ${newCfg.label}: tienes ${clientsData.length} clientes y el límite es ${newCfg.maxClients}`, 'error');
    return;
  }

  try {
    await db.collection('usuarios').doc(currentUser.uid).update({
      plan: plan
    });
    currentPlan = plan;
    applyPlanRestrictions();
    showToast(`¡Plan cambiado a ${newCfg.label}!`, 'success');
    if (typeof logActivity === 'function') logActivity('plan', `Plan cambiado a ${newCfg.label}`);
  } catch (err) {
    console.error('Error cambiando plan:', err);
    showToast('Error al cambiar de plan', 'error');
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
        <td colspan="8" class="table-empty">
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
        <td><span style="color: var(--success); font-weight: 600;">${acc.precio_perfil ? formatCurrency(acc.precio_perfil) : '—'}</span></td>
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
    precio_perfil: parseFloat(document.getElementById('accountPricePerProfile').value) || 0,
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
  document.getElementById('accountPricePerProfile').value = acc.precio_perfil || '';
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
        <td colspan="11" class="table-empty">
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
        <td>${cl.estado_pago === 'pagado' 
          ? '<span class="badge" style="background: var(--success); color: #fff;"><i class="fa-solid fa-circle-check"></i> Pagado</span>' 
          : '<span class="badge" style="background: var(--warning); color: #000;"><i class="fa-solid fa-clock"></i> Pendiente</span>'}</td>
        <td>
          <div class="row-actions">
            <button class="btn-icon btn-send-creds" onclick="window.open('${credLink}', '_blank')" title="Enviar credenciales">
              <i class="fa-solid fa-paper-plane" style="color: var(--accent-light);"></i>
            </button>
            <button class="btn-icon" onclick="renewClient('${cl.id}')" title="Renovar (+30 días)">
              <i class="fa-solid fa-rotate-right" style="color: var(--success);"></i>
            </button>
            <button class="btn-icon" onclick="showClientHistory('${cl.id}')" title="Historial de pagos">
              <i class="fa-solid fa-clock-rotate-left" style="color: var(--info);"></i>
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

  // Verificar límite de clientes al crear (no al editar)
  if (!id && !canAddMoreClients()) {
    const cfg = PLAN_CONFIG[currentPlan];
    showUpgradeModal(
      'Límite de clientes alcanzado',
      `Tu plan ${cfg.label} permite hasta ${cfg.maxClients} clientes. Tienes ${clientsData.length}. Mejora tu plan para agregar más.`
    );
    return;
  }

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
      // Detectar cambio de estado de pago: pendiente → pagado
      const oldClient = clientsData.find(c => c.id === id);
      const switchedToPaid = oldClient && oldClient.estado_pago !== 'pagado' && data.estado_pago === 'pagado' && precio > 0;

      await db.collection('clientes').doc(id).update(data);
      showToast('Cliente actualizado', 'success');
      if (typeof logActivity === 'function') logActivity('edit', `Cliente editado: ${data.nombre}`);

      // Auto-registrar movimiento si cambió a pagado
      if (switchedToPaid) {
        try {
          await db.collection('movimientos').add({
            uid: currentUser.uid,
            cliente_id: id,
            cliente_nombre: data.nombre,
            monto: precio,
            fecha_pago: data.fecha_inicio || new Date(),
            metodo: 'Automático',
            nota: `Pago ${account?.plataforma || data.plataforma || ''} — ${data.perfil_asignado}`,
            creado_en: firebase.firestore.FieldValue.serverTimestamp()
          });
          showToast('Movimiento de pago registrado automáticamente', 'success');
          notifySaleToWhatsApp({
            clientName: data.nombre,
            platform: account?.plataforma || data.plataforma,
            profile: data.perfil_asignado,
            amount: precio,
            paymentMethod: 'Automático',
            note: `Pago ${account?.plataforma || data.plataforma || ''} — ${data.perfil_asignado}`
          });
        } catch (mErr) {
          console.error('No se pudo registrar movimiento automático:', mErr);
          showToast('Error al registrar movimiento automático', 'error');
        }
      }
    } else {
      data.creado_en = firebase.firestore.FieldValue.serverTimestamp();
      const newRef = await db.collection('clientes').add(data);
      showToast('Cliente agregado exitosamente', 'success');
      if (typeof logActivity === 'function') logActivity('create', `Cliente creado: ${data.nombre}`);

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
          // Notify sale to WhatsApp
          notifySaleToWhatsApp({
            clientName: data.nombre,
            platform: account?.plataforma,
            profile: data.perfil_asignado,
            amount: precio,
            paymentMethod: 'Automático',
            note: `Pago ${account?.plataforma || ''} — ${data.perfil_asignado}`
          });
        } catch (mErr) {
          console.error('No se pudo registrar movimiento automático:', mErr);
          showToast('Error al registrar movimiento automático', 'error');
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
    if (typeof logActivity === 'function') logActivity('delete', 'Cliente eliminado');
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
      // Notify sale to WhatsApp
      notifySaleToWhatsApp({
        clientName: data.cliente_nombre,
        amount: data.monto,
        paymentMethod: data.metodo,
        note: data.nota
      });
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

  // Auto-rellenar precio si la cuenta tiene precio por perfil configurado
  const priceField = document.getElementById('clientPrice');
  if (priceField && account.precio_perfil && (!priceField.value || priceField.value === '0')) {
    priceField.value = account.precio_perfil;
  }

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

  // Charts & profit calculator
  renderDashboardCharts();
  updateProfitCalculator();
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
  document.getElementById('botContext').value = '';
  document.getElementById('botEnabled').value = 'true';
  document.getElementById('botMaxTokens').value = '512';
}

/**
 * Cargar configuración del chatbot desde Firestore
 */
async function loadChatbotConfig() {
  if (!currentUser || !db) return;

  clearChatbotState();

  try {
    const doc = await db.collection('chatbot_config').doc(currentUser.uid).get();
    if (doc.exists) {
      const data = doc.data();
      // Support legacy multi-field configs by merging into single context
      if (data.context) {
        document.getElementById('botContext').value = data.context;
      } else if (data.businessName) {
        // Migrate old multi-field config to single context
        let migrated = '';
        if (data.businessName) migrated += `🏪 PRESENTACIÓN:\nSoy ${data.businessName}.`;
        if (data.personality) migrated += ` ${data.personality}`;
        if (data.schedule) migrated += `\nHorario de atención: ${data.schedule}`;
        migrated += '\n';
        if (data.welcomeMsg) migrated += `\n👋 MENSAJE DE BIENVENIDA:\n${data.welcomeMsg}\n`;
        if (data.fallbackMsg) migrated += `\n⚠️ SI NO SÉ RESPONDER:\n${data.fallbackMsg}\n`;
        document.getElementById('botContext').value = migrated.trim();
      }
      document.getElementById('botEnabled').value = data.enabled !== false ? 'true' : 'false';
      document.getElementById('botMaxTokens').value = data.maxTokens || '512';
    }
  } catch (err) {
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
    context: document.getElementById('botContext').value.trim(),
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
 * Mejorar contexto del bot con IA (Gemini Flash 2)
 */
async function improveContextWithAI() {
  const textarea = document.getElementById('botContext');
  const btn = document.getElementById('btnImproveContext');
  const rawContext = textarea.value.trim();

  if (!rawContext) {
    showNotification('Escribe primero el contexto que quieres mejorar', 'warning');
    return;
  }

  // Guardar estado original del botón
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mejorando...';

  try {
    const res = await fetch('/api/improve-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: rawContext })
    });

    const data = await res.json();

    if (!res.ok || !data.improvedContext) {
      throw new Error(data.error || 'No se pudo mejorar el contexto');
    }

    // Reemplazar con el contexto mejorado
    textarea.value = data.improvedContext;
    textarea.style.borderColor = 'var(--success)';
    setTimeout(() => { textarea.style.borderColor = ''; }, 3000);

    showNotification('¡Contexto mejorado con IA! Revisa el resultado y ajusta si es necesario.', 'success');
  } catch (err) {
    console.error('Error mejorando contexto:', err);
    showNotification('Error al mejorar: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
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
      context: document.getElementById('botContext').value.trim(),
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
  // Ocultar sección de mensajes programados y resetear flags
  const schedSection = document.getElementById('scheduledSection');
  if (schedSection) schedSection.style.display = 'none';
  groupsLoaded = false;
  scheduledLoaded = false;
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
      // Actualizar estado de pausa
      updatePauseButton(data.globalPaused);
      // Mostrar sección de mensajes programados y cargar datos
      const schedSection = document.getElementById('scheduledSection');
      if (schedSection) {
        schedSection.style.display = '';
        if (!groupsLoaded) loadGroups();
        if (!scheduledLoaded) { loadScheduledMessages(); scheduledLoaded = true; }
      }
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

/**
 * Notify sale to connected WhatsApp (sends message to self)
 */
async function notifySaleToWhatsApp({ clientName, platform, profile, amount, currency, paymentMethod, note }) {
  try {
    const url = getBotUrl();
    if (!url) return;
    const res = await fetch(`${url}/notify-sale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName,
        platform,
        profile,
        amount,
        currency: currency || 'MXN',
        paymentMethod,
        note,
        appUrl: window.location.origin + '/index.html'
      })
    });
    if (res.ok) {
      addBotLog('💰 Notificación de venta enviada a tu WhatsApp');
    }
  } catch (err) {
    // Silent fail — don't break the main flow
    console.warn('No se pudo enviar notificación de venta:', err.message);
  }
}

/* ============================================================
   CHATBOT — Pausa global del bot
   ============================================================ */

/**
 * Actualizar el botón de pausa según el estado actual
 */
function updatePauseButton(isPaused) {
  const btn = document.getElementById('botPauseBtn');
  if (!btn) return;
  if (isPaused) {
    btn.classList.add('paused');
    btn.innerHTML = '<i class="fa-solid fa-play"></i> Reanudar Respuestas';
  } else {
    btn.classList.remove('paused');
    btn.innerHTML = '<i class="fa-solid fa-pause"></i> Pausar Respuestas';
  }
}

/**
 * Alternar pausa global del bot
 */
async function toggleGlobalPause() {
  const url = getBotUrl();
  if (!url) return;
  const btn = document.getElementById('botPauseBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${url}/global-pause`, { method: 'POST' });
    if (!res.ok) throw new Error('Error al cambiar estado de pausa');
    const data = await res.json();
    updatePauseButton(data.globalPaused);
    addBotLog(data.globalPaused ? '⏸️ Bot pausado — no responderá mensajes' : '▶️ Bot reanudado — respondiendo mensajes');
    showToast(data.globalPaused ? 'Bot pausado' : 'Bot reanudado', data.globalPaused ? 'warning' : 'success');
  } catch (err) {
    showToast('Error al pausar/reanudar', 'error');
    addBotLog(`❌ Error pausa: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ============================================================
   CHATBOT — Mensajes programados para grupos
   ============================================================ */

let groupsLoaded = false;
let scheduledLoaded = false;

/**
 * Toggle para mostrar opciones de recurrencia
 */
function toggleRecurringOptions() {
  const sel = document.getElementById('scheduledType');
  const opts = document.getElementById('recurringOptions');
  if (sel && opts) {
    opts.style.display = sel.value === 'recurring' ? '' : 'none';
  }
}

/**
 * Cargar lista de grupos de WhatsApp desde el bot
 */
async function loadGroups() {
  const url = getBotUrl();
  if (!url) return;
  const select = document.getElementById('scheduledGroupSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Cargando grupos...</option>';
  try {
    const res = await fetch(`${url}/groups`);
    if (!res.ok) throw new Error('Error al cargar grupos');
    const data = await res.json();
    const groups = data.groups || [];
    if (groups.length === 0) {
      select.innerHTML = '<option value="">No se encontraron grupos</option>';
      return;
    }
    select.innerHTML = '<option value="">Selecciona un grupo...</option>' +
      groups.map(g => `<option value="${escapeAttr(g.jid)}" data-name="${escapeAttr(g.name)}">${escapeAttr(g.name)} (${g.participants} miembros)</option>`).join('');
    groupsLoaded = true;
  } catch (err) {
    select.innerHTML = '<option value="">Error al cargar grupos</option>';
    addBotLog(`❌ Error cargando grupos: ${err.message}`);
  }
}

/**
 * Set default datetime to Mexico timezone (America/Mexico_City)
 */
function setDefaultMexicoDateTime() {
  const dtInput = document.getElementById('scheduledDateTime');
  if (!dtInput || dtInput.value) return; // Don't overwrite if already has value
  // Get current time in Mexico City timezone formatted as YYYY-MM-DDTHH:MM
  const now = new Date();
  const mxDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  // Add 1 hour as default (schedule for one hour from now)
  mxDate.setHours(mxDate.getHours() + 1);
  mxDate.setMinutes(0, 0, 0);
  const year = mxDate.getFullYear();
  const month = String(mxDate.getMonth() + 1).padStart(2, '0');
  const day = String(mxDate.getDate()).padStart(2, '0');
  const hours = String(mxDate.getHours()).padStart(2, '0');
  const mins = String(mxDate.getMinutes()).padStart(2, '0');
  dtInput.value = `${year}-${month}-${day}T${hours}:${mins}`;
}

/**
 * Cargar mensajes programados existentes
 */
async function loadScheduledMessages() {
  setDefaultMexicoDateTime();
  const url = getBotUrl();
  if (!url) return;
  const container = document.getElementById('scheduledList');
  if (!container) return;
  try {
    const res = await fetch(`${url}/scheduled`);
    if (!res.ok) throw new Error('Error al cargar programados');
    const data = await res.json();
    const msgs = data.messages || data.scheduled || [];
    _scheduledCache = msgs;
    if (msgs.length === 0) {
      container.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:20px;"><i class="fa-solid fa-calendar-xmark"></i><p>${t('sched.no_messages', 'Sin mensajes programados')}</p></div>`;
      return;
    }
    container.innerHTML = msgs.map(m => renderScheduledCard(m)).join('');
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:20px;"><i class="fa-solid fa-triangle-exclamation"></i><p>${t('sched.load_error', 'Error al cargar mensajes')}</p></div>`;
  }
}

/**
 * Renderizar tarjeta de mensaje programado
 */
function renderScheduledCard(m) {
  const date = new Date(m.nextRun || m.scheduledTime);
  const dateStr = date.toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const isActive = m.active !== false;
  const iconClass = isActive ? 'active' : 'paused-sched';
  const iconName = isActive ? 'fa-clock' : 'fa-pause';
  const recurringLabel = m.recurring
    ? `${t('sched.every', 'Cada')} ${m.intervalMinutes >= 1440 ? (m.intervalMinutes / 1440) + ' ' + t('sched.days', 'día(s)') : m.intervalMinutes >= 60 ? (m.intervalMinutes / 60) + ' ' + t('sched.hours_label', 'hora(s)') : m.intervalMinutes + ' min'}`
    : t('sched.once', 'Una sola vez');
  
  return `<div class="scheduled-card">
    <div class="scheduled-card-icon ${iconClass}">
      <i class="fa-solid ${iconName}"></i>
    </div>
    <div class="scheduled-card-body">
      <h5>${escapeAttr(m.groupName || 'Grupo')}</h5>
      <p>${escapeAttr(m.message)}</p>
      <div class="scheduled-meta">
        <span><i class="fa-regular fa-calendar"></i> ${dateStr}</span>
        <span><i class="fa-solid fa-repeat"></i> ${recurringLabel}</span>
        <span><i class="fa-solid fa-circle" style="font-size:6px;color:${isActive ? 'var(--success)' : 'var(--warning)'}"></i> ${isActive ? 'Activo' : 'Pausado'}</span>
      </div>
    </div>
    <div class="scheduled-card-actions">
      <button onclick="editScheduledMessage(${m.id})" title="Editar">
        <i class="fa-solid fa-pen-to-square"></i>
      </button>
      <button onclick="toggleScheduledMessage(${m.id})" title="${isActive ? 'Pausar' : 'Activar'}">
        <i class="fa-solid ${isActive ? 'fa-pause' : 'fa-play'}"></i>
      </button>
      <button class="btn-delete" onclick="deleteScheduledMessage(${m.id})" title="Eliminar">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  </div>`;
}

/**
 * Crear nuevo mensaje programado
 */
async function createScheduledMessage() {
  const url = getBotUrl();
  if (!url) return;

  const select = document.getElementById('scheduledGroupSelect');
  const jid = select ? select.value : '';
  const groupName = select && select.selectedOptions[0] ? select.selectedOptions[0].dataset.name || select.selectedOptions[0].textContent : '';
  const message = (document.getElementById('scheduledMessageText')?.value || '').trim();
  const dateTimeStr = document.getElementById('scheduledDateTime')?.value || '';
  const type = document.getElementById('scheduledType')?.value || 'once';
  const interval = parseInt(document.getElementById('scheduledInterval')?.value || '60', 10);
  const unit = document.getElementById('scheduledIntervalUnit')?.value || 'minutes';

  if (!jid) return showToast(t('sched.select_group', 'Selecciona un grupo'), 'warning');
  if (!message) return showToast(t('sched.write_message', 'Escribe un mensaje'), 'warning');
  if (!dateTimeStr) return showToast(t('sched.select_datetime', 'Selecciona fecha y hora'), 'warning');

  const scheduledTime = new Date(dateTimeStr).toISOString();
  const recurring = type === 'recurring';
  let intervalMinutes = interval;
  if (unit === 'hours') intervalMinutes = interval * 60;
  if (unit === 'days') intervalMinutes = interval * 1440;

  try {
    const res = await fetch(`${url}/scheduled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid, groupName, message, scheduledTime, recurring, intervalMinutes })
    });
    if (!res.ok) throw new Error('Error al crear mensaje programado');
    showToast(t('sched.created', 'Mensaje programado creado'), 'success');
    addBotLog('📅 ' + t('sched.log_created', 'Mensaje programado para') + ' ' + groupName);
    // Limpiar formulario
    if (document.getElementById('scheduledMessageText')) document.getElementById('scheduledMessageText').value = '';
    if (document.getElementById('scheduledDateTime')) document.getElementById('scheduledDateTime').value = '';
    setDefaultMexicoDateTime();
    loadScheduledMessages();
  } catch (err) {
    showToast('Error al programar mensaje', 'error');
    addBotLog(`❌ Error programando: ${err.message}`);
  }
}

/**
 * Eliminar mensaje programado
 */
async function deleteScheduledMessage(id) {
  const url = getBotUrl();
  if (!url) return;
  try {
    const res = await fetch(`${url}/scheduled/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error');
    showToast(t('sched.deleted', 'Mensaje eliminado'), 'success');
    loadScheduledMessages();
  } catch (err) {
    showToast('Error al eliminar', 'error');
  }
}

/**
 * Editar mensaje programado — abrir modal
 */
let _scheduledCache = [];
function editScheduledMessage(id) {
  const msg = _scheduledCache.find(m => m.id === id);
  if (!msg) return showToast('Mensaje no encontrado', 'error');

  document.getElementById('editSchedId').value = id;
  document.getElementById('editSchedGroup').value = msg.groupName || 'Grupo';
  document.getElementById('editSchedMessage').value = msg.message || '';

  // Convert nextRun timestamp to datetime-local format
  const dt = new Date(msg.nextRun || Date.now());
  const offset = dt.getTimezoneOffset();
  const local = new Date(dt.getTime() - offset * 60000);
  document.getElementById('editSchedDateTime').value = local.toISOString().slice(0, 16);

  // Set type
  const typeSelect = document.getElementById('editSchedType');
  typeSelect.value = msg.recurring ? 'recurring' : 'once';

  // Set interval
  const opts = document.getElementById('editRecurringOptions');
  if (msg.recurring) {
    opts.style.display = '';
    const mins = msg.intervalMinutes || 60;
    if (mins >= 1440 && mins % 1440 === 0) {
      document.getElementById('editSchedInterval').value = mins / 1440;
      document.getElementById('editSchedIntervalUnit').value = 'days';
    } else if (mins >= 60 && mins % 60 === 0) {
      document.getElementById('editSchedInterval').value = mins / 60;
      document.getElementById('editSchedIntervalUnit').value = 'hours';
    } else {
      document.getElementById('editSchedInterval').value = mins;
      document.getElementById('editSchedIntervalUnit').value = 'minutes';
    }
  } else {
    opts.style.display = 'none';
    document.getElementById('editSchedInterval').value = 60;
    document.getElementById('editSchedIntervalUnit').value = 'minutes';
  }

  openModal('editScheduledModal');
}

function toggleEditRecurringOptions() {
  const sel = document.getElementById('editSchedType');
  const opts = document.getElementById('editRecurringOptions');
  if (sel && opts) {
    opts.style.display = sel.value === 'recurring' ? '' : 'none';
  }
}

/**
 * Guardar edición de mensaje programado
 */
async function saveScheduledEdit() {
  const url = getBotUrl();
  if (!url) return;
  const id = parseInt(document.getElementById('editSchedId').value);
  const message = (document.getElementById('editSchedMessage').value || '').trim();
  const dateTimeStr = document.getElementById('editSchedDateTime').value || '';
  const type = document.getElementById('editSchedType').value || 'once';
  const interval = parseInt(document.getElementById('editSchedInterval').value || '60', 10);
  const unit = document.getElementById('editSchedIntervalUnit').value || 'minutes';

  if (!message) return showToast(t('sched.write_message', 'Escribe un mensaje'), 'warning');
  if (!dateTimeStr) return showToast(t('sched.select_datetime', 'Selecciona fecha y hora'), 'warning');

  const scheduledTime = new Date(dateTimeStr).toISOString();
  const recurring = type === 'recurring';
  let intervalMinutes = interval;
  if (unit === 'hours') intervalMinutes = interval * 60;
  if (unit === 'days') intervalMinutes = interval * 1440;

  try {
    const res = await fetch(`${url}/scheduled/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, scheduledTime, recurring, intervalMinutes })
    });
    if (!res.ok) throw new Error('Error al editar');
    showToast(t('sched.edited', 'Mensaje editado correctamente'), 'success');
    closeModal('editScheduledModal');
    loadScheduledMessages();
  } catch (err) {
    showToast('Error al editar mensaje', 'error');
  }
}

/**
 * Activar/pausar mensaje programado
 */
async function toggleScheduledMessage(id) {
  const url = getBotUrl();
  if (!url) return;
  try {
    const res = await fetch(`${url}/scheduled/${id}/toggle`, { method: 'POST' });
    if (!res.ok) throw new Error('Error');
    const data = await res.json();
    showToast(data.active ? t('sched.toggled_on', 'Mensaje activado') : t('sched.toggled_off', 'Mensaje pausado'), 'success');
    loadScheduledMessages();
  } catch (err) {
    showToast('Error al cambiar estado', 'error');
  }
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
      context: document.getElementById('botContext').value.trim(),
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
    const pendientes = orders.filter(o => o.estado === 'pendiente');
    const navBadge = document.getElementById('navOrdersBadge');
    if (navBadge) {
      if (pendientes.length > 0) {
        navBadge.textContent = pendientes.length;
        navBadge.style.display = '';
      } else {
        navBadge.style.display = 'none';
      }
    }
  } catch (err) {
    console.warn('Error loading pending orders:', err);
  }
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

  if (pendientes.length === 0) {
    container.style.display = 'none';
    // Reset tbody to default empty state
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty"><i class="fa-solid fa-inbox"></i><p>No hay pedidos pendientes</p></td></tr>`;
    if (countEl) countEl.textContent = '0';
    return;
  }

  container.style.display = '';
  if (countEl) countEl.textContent = pendientes.length;

  tbody.innerHTML = pendientes.map(o => {
    const fecha = new Date(o.timestamp || o.fechaHora);
    const fechaStr = fecha.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' + 
                     fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const statusClass = 'order-status-pendiente';
    const statusText = 'PENDIENTE';

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

/* ============================================================
   DASHBOARD CHARTS (Chart.js)
   ============================================================ */
let chartIncome = null, chartClients = null, chartPlatforms = null;

function renderDashboardCharts() {
  // Lazy load Chart.js — only when dashboard is visible
  if (typeof Chart === 'undefined') {
    if (typeof loadChartJS === 'function') {
      loadChartJS().then(() => renderDashboardCharts());
    }
    return;
  }

  const accentColor = '#7c3aed';
  const successColor = '#22c55e';
  const dangerColor = '#ef4444';
  const warningColor = '#f59e0b';
  const infoColor = '#3b82f6';

  // ── 1. Monthly Income (last 6 months bar chart) ──
  const now = new Date();
  const monthLabels = [];
  const monthValues = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    monthLabels.push(d.toLocaleString('es', { month: 'short', year: '2-digit' }));

    // Sum from movements
    let sum = movementsData.filter(m => {
      if (!m.fecha_pago) return false;
      const md = m.fecha_pago instanceof Date ? m.fecha_pago : (m.fecha_pago.toDate ? m.fecha_pago.toDate() : new Date(m.fecha_pago));
      return md >= d && md <= end;
    }).reduce((s, m) => s + (parseFloat(m.monto) || 0), 0);

    // Also from paid clients
    const clientSum = clientsData.filter(c => {
      if (!c.precio || c.estado_pago !== 'pagado') return false;
      const cd = c.fecha_inicio instanceof Date ? c.fecha_inicio : (c.fecha_inicio?.toDate ? c.fecha_inicio.toDate() : new Date(c.fecha_inicio));
      return cd >= d && cd <= end;
    }).reduce((s, c) => s + (c.precio || 0), 0);

    monthValues.push(Math.max(sum, clientSum));
  }

  const ctxIncome = document.getElementById('chartIncome');
  if (ctxIncome) {
    if (chartIncome) chartIncome.destroy();
    chartIncome = new Chart(ctxIncome.getContext('2d'), {
      type: 'bar',
      data: {
        labels: monthLabels,
        datasets: [{
          label: 'Ingresos',
          data: monthValues,
          backgroundColor: accentColor + '88',
          borderColor: accentColor,
          borderWidth: 2,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9ca3af' } },
          x: { grid: { display: false }, ticks: { color: '#9ca3af' } }
        }
      }
    });
  }

  // ── 2. Active vs Expired (doughnut) ──
  const active = clientsData.filter(c => daysRemaining(c.fecha_fin) > 0).length;
  const expired = clientsData.filter(c => daysRemaining(c.fecha_fin) <= 0).length;
  const expiring = clientsData.filter(c => { const d = daysRemaining(c.fecha_fin); return d > 0 && d <= 3; }).length;

  const ctxClients = document.getElementById('chartClients');
  if (ctxClients) {
    if (chartClients) chartClients.destroy();
    chartClients = new Chart(ctxClients.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Activos', 'Por vencer', 'Vencidos'],
        datasets: [{
          data: [active - expiring, expiring, expired],
          backgroundColor: [successColor, warningColor, dangerColor],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#9ca3af', padding: 12 } }
        }
      }
    });
  }

  // ── 3. Platform Occupancy (horizontal bar) ──
  const platformData = {};
  accountsData.forEach(a => {
    const p = a.plataforma || 'Otra';
    if (!platformData[p]) platformData[p] = { total: 0, occupied: 0 };
    platformData[p].total += (a.perfiles_totales || 0);
  });
  clientsData.forEach(c => {
    const p = c.plataforma || 'Otra';
    if (!platformData[p]) platformData[p] = { total: 0, occupied: 0 };
    if (daysRemaining(c.fecha_fin) > 0) platformData[p].occupied++;
  });

  const platLabels = Object.keys(platformData);
  const platOccupied = platLabels.map(p => platformData[p].occupied);
  const platFree = platLabels.map(p => Math.max(0, platformData[p].total - platformData[p].occupied));

  const ctxPlatforms = document.getElementById('chartPlatforms');
  if (ctxPlatforms) {
    if (chartPlatforms) chartPlatforms.destroy();
    chartPlatforms = new Chart(ctxPlatforms.getContext('2d'), {
      type: 'bar',
      data: {
        labels: platLabels,
        datasets: [
          { label: 'Ocupados', data: platOccupied, backgroundColor: accentColor + '99', borderRadius: 4 },
          { label: 'Libres', data: platFree, backgroundColor: '#374151', borderRadius: 4 }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: { legend: { labels: { color: '#9ca3af' } } },
        scales: {
          x: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9ca3af' } },
          y: { stacked: true, grid: { display: false }, ticks: { color: '#9ca3af' } }
        }
      }
    });
  }
}

/* ============================================================
   PROFIT CALCULATOR
   ============================================================ */
function updateProfitCalculator() {
  // Gross income = sum of all active/paid client prices
  const gross = clientsData
    .filter(c => c.estado_pago === 'pagado' || daysRemaining(c.fecha_fin) > 0)
    .reduce((s, c) => s + (parseFloat(c.precio) || 0), 0);

  // Cost = sum of account costs (use costo field if exists)
  const cost = accountsData.reduce((s, a) => s + (parseFloat(a.costo) || parseFloat(a.precio_total) || 0), 0);

  const net = gross - cost;

  const elGross = document.getElementById('profitGross');
  const elCost = document.getElementById('profitCost');
  const elNet = document.getElementById('profitNet');

  if (elGross) elGross.textContent = formatCurrency(gross);
  if (elCost) elCost.textContent = formatCurrency(cost);
  if (elNet) elNet.textContent = formatCurrency(net);
}

/* ============================================================
   RENEW CLIENT — 1-click +30 days
   ============================================================ */
async function renewClient(clientId) {
  const client = clientsData.find(c => c.id === clientId);
  if (!client) return showToast('Cliente no encontrado', 'error');

  try {
    // Calculate new end date (+30 days from current end or from today if expired)
    let base = client.fecha_fin;
    if (base?.toDate) base = base.toDate();
    else if (typeof base === 'string') base = new Date(base);
    else base = new Date(base);

    if (base < new Date()) base = new Date(); // If expired, start from today
    const newEnd = new Date(base);
    newEnd.setDate(newEnd.getDate() + 30);

    const newEndStr = newEnd.toISOString().split('T')[0];

    // Update client
    await db.collection('clientes').doc(clientId).update({
      fecha_fin: newEndStr,
      estado_pago: 'pagado',
      fecha_inicio: new Date().toISOString().split('T')[0]
    });

    // Create movement
    await db.collection('movimientos').add({
      cliente_id: clientId,
      monto: client.precio || 0,
      fecha_pago: firebase.firestore.Timestamp.fromDate(new Date()),
      fecha: new Date().toISOString().split('T')[0],
      metodo: 'Renovación automática',
      nota: `Renovación +30 días → ${formatDate(newEndStr)}`,
      created_at: firebase.firestore.FieldValue.serverTimestamp()
    });

    logActivity('renew', `Renovación: ${client.nombre} → ${formatDate(newEndStr)}`);
    showToast(`${client.nombre} renovado hasta ${formatDate(newEndStr)}`, 'success');

    await loadClients();
    await loadMovements();
    updateDashboard();
    updateReports();
  } catch (err) {
    showToast('Error al renovar: ' + err.message, 'error');
  }
}

/* ============================================================
   CLIENT PAYMENT HISTORY
   ============================================================ */
function showClientHistory(clientId) {
  const client = clientsData.find(c => c.id === clientId);
  if (!client) return;

  const nameEl = document.getElementById('historyClientName');
  const tbody = document.getElementById('historyTableBody');
  const totalEl = document.getElementById('historyTotal');

  nameEl.textContent = client.nombre;

  // Find all movements for this client
  const clientMoves = movementsData.filter(m => m.cliente_id === clientId);

  if (clientMoves.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No hay pagos registrados para este cliente</td></tr>';
    totalEl.textContent = '';
  } else {
    const sorted = [...clientMoves].sort((a, b) => {
      const da = a.fecha_pago?.toDate ? a.fecha_pago.toDate() : new Date(a.fecha_pago || a.fecha);
      const db2 = b.fecha_pago?.toDate ? b.fecha_pago.toDate() : new Date(b.fecha_pago || b.fecha);
      return db2 - da;
    });

    tbody.innerHTML = sorted.map(m => `
      <tr>
        <td>${formatDate(m.fecha_pago || m.fecha)}</td>
        <td style="color:var(--success);font-weight:600;">${formatCurrency(m.monto)}</td>
        <td>${m.metodo || '—'}</td>
        <td>${m.nota || '—'}</td>
      </tr>
    `).join('');

    const total = sorted.reduce((s, m) => s + (parseFloat(m.monto) || 0), 0);
    totalEl.innerHTML = `<strong>Total: ${formatCurrency(total)}</strong>`;
  }

  openModal('historyModal');
}

/* ============================================================
   DEBTORS — Expired unpaid clients
   ============================================================ */
function renderDebtorsTable() {
  const tbody = document.getElementById('debtorsTableBody');
  if (!tbody) return;

  // Clients expired (days <= 0) and not paid
  const debtors = clientsData.filter(c => {
    const d = daysRemaining(c.fecha_fin);
    return d <= 0 && c.estado_pago !== 'pagado';
  }).sort((a, b) => daysRemaining(a.fecha_fin) - daysRemaining(b.fecha_fin));

  if (debtors.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="table-empty">
          <i class="fa-solid fa-face-smile"></i>
          <p>¡No hay deudores! Todos al día</p>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = debtors.map(cl => {
    const days = Math.abs(daysRemaining(cl.fecha_fin));
    const account = accountsData.find(a => a.id === cl.cuenta_id);
    return `
      <tr>
        <td><strong>${escapeAttr(cl.nombre)}</strong></td>
        <td>${renderPlatformTag(cl.plataforma || account?.plataforma || '—')}</td>
        <td>${formatDate(cl.fecha_fin)}</td>
        <td><span class="overdue-badge">${days} días</span></td>
        <td style="color:var(--success);font-weight:600;">${cl.precio ? formatCurrency(cl.precio) : '—'}</td>
        <td>${cl.estado_pago === 'pagado' 
          ? '<span class="badge" style="background:var(--success);color:#fff;">Pagado</span>' 
          : '<span class="badge" style="background:var(--warning);color:#000;">Pendiente</span>'}</td>
        <td>
          <div class="row-actions">
            <button class="btn-icon" onclick="sendDebtReminder('${cl.id}')" title="Enviar cobro WhatsApp">
              <i class="fa-brands fa-whatsapp" style="color:var(--whatsapp);"></i>
            </button>
            <button class="btn-icon" onclick="renewClient('${cl.id}')" title="Renovar">
              <i class="fa-solid fa-rotate-right" style="color:var(--success);"></i>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function sendDebtReminder(clientId) {
  const client = clientsData.find(c => c.id === clientId);
  if (!client) return;

  const days = Math.abs(daysRemaining(client.fecha_fin));
  const templates = JSON.parse(localStorage.getItem('streamly_templates') || '[]');
  const cobroTpl = templates.find(t => t.type === 'cobro');

  let message;
  if (cobroTpl) {
    message = applyTemplateVars(cobroTpl.message, client);
  } else {
    message = `Hola ${client.nombre} 👋\n\nTe escribo para recordarte que tu suscripción de *${client.plataforma || ''}* venció hace *${days} días*.\n\nEl precio de renovación es *${client.precio ? formatCurrency(client.precio) : ''}*.\n\n¿Deseas renovar? 😊`;
  }

  const phone = (client.whatsapp || '').replace(/[^0-9]/g, '');
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
  logActivity('payment', `Cobro enviado a ${client.nombre}`);
}

function sendBulkReminders() {
  const debtors = clientsData.filter(c => daysRemaining(c.fecha_fin) <= 0 && c.estado_pago !== 'pagado');
  if (debtors.length === 0) return showToast('No hay deudores', 'info');

  debtors.forEach((cl, i) => {
    setTimeout(() => sendDebtReminder(cl.id), i * 1500);
  });
  showToast(`Enviando cobro a ${debtors.length} clientes...`, 'info');
}

/* ============================================================
   WHATSAPP NOTIFICATIONS — Auto reminders
   ============================================================ */
async function sendExpiryNotifications() {
  const url = getBotUrl();
  if (!url) return;

  // Clients expiring in 1 day
  const expiring = clientsData.filter(c => {
    const d = daysRemaining(c.fecha_fin);
    return d === 1;
  });

  for (const cl of expiring) {
    const phone = (cl.whatsapp || '').replace(/[^0-9]/g, '');
    if (!phone) continue;

    const message = `⏰ Hola ${cl.nombre}, tu suscripción de *${cl.plataforma || ''}* vence *mañana*.\n\nRenueva por ${cl.precio ? formatCurrency(cl.precio) : ''} para no perder acceso.\n\n¿Deseas renovar? Escríbeme aquí 👇`;

    try {
      await fetch(`${url}/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message })
      });
    } catch (e) {
      console.error('Error sending notification:', e);
    }
  }

  if (expiring.length > 0) {
    showToast(`Recordatorios enviados a ${expiring.length} clientes`, 'success');
    logActivity('payment', `Recordatorios de vencimiento enviados a ${expiring.length} clientes`);
  }
}

/* ============================================================
   CALENDAR — Visual expiry calendar
   ============================================================ */
let calendarDate = new Date();

function calendarPrev() {
  calendarDate.setMonth(calendarDate.getMonth() - 1);
  renderCalendar();
}
function calendarNext() {
  calendarDate.setMonth(calendarDate.getMonth() + 1);
  renderCalendar();
}
function calendarToday() {
  calendarDate = new Date();
  renderCalendar();
}

// Store calendar events globally for modal access
let calendarDayEvents = {};

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  const label = document.getElementById('calendarMonthLabel');
  if (!grid) return;

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  label.textContent = calendarDate.toLocaleString('es', { month: 'long', year: 'numeric' });

  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  // Build map of events by day (full client data)
  calendarDayEvents = {};
  clientsData.forEach(c => {
    let end = c.fecha_fin;
    if (end?.toDate) end = end.toDate();
    else if (typeof end === 'string') end = new Date(end);
    else end = new Date(end);

    if (end.getFullYear() === year && end.getMonth() === month) {
      const day = end.getDate();
      if (!calendarDayEvents[day]) calendarDayEvents[day] = [];
      const d = daysRemaining(c.fecha_fin);
      const account = accountsData.find(a => a.id === c.cuenta_id);
      calendarDayEvents[day].push({
        id: c.id,
        name: c.nombre,
        platform: account?.plataforma || 'N/A',
        profile: c.perfil || '—',
        price: c.precio || 0,
        endDate: end,
        daysLeft: d,
        status: d <= 0 ? 'expired' : d <= 3 ? 'expiring' : 'active',
        phone: c.telefono || ''
      });
    }
  });

  // Day headers
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  let html = dayNames.map(d => `<div class="calendar-day-header">${d}</div>`).join('');

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="calendar-day empty"></div>';
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    const events = calendarDayEvents[d] || [];
    const dots = events.map(e => `<div class="cal-dot ${e.status}" title="${e.name}"></div>`).join('');
    const hasEvents = events.length > 0;

    html += `<div class="calendar-day${isToday ? ' today' : ''}${hasEvents ? ' has-events' : ''}" ${hasEvents ? `onclick="showCalendarDayModal(${d})"` : ''}>
      <span class="day-number">${d}</span>
      <div class="cal-dots">${dots}</div>
      ${hasEvents ? `<span class="cal-count">${events.length}</span>` : ''}
    </div>`;
  }

  grid.innerHTML = html;
}

/**
 * Show modal with clients expiring on a specific calendar day
 */
function showCalendarDayModal(day) {
  const events = calendarDayEvents[day];
  if (!events || events.length === 0) return;

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const dateStr = new Date(year, month, day).toLocaleDateString('es', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const titleEl = document.getElementById('calendarDayModalTitle');
  const bodyEl = document.getElementById('calendarDayModalBody');

  titleEl.innerHTML = `<i class="fa-solid fa-calendar-day"></i> ${dateStr}`;

  const expired = events.filter(e => e.status === 'expired');
  const expiring = events.filter(e => e.status === 'expiring');
  const active = events.filter(e => e.status === 'active');

  const renderClientRow = (e) => {
    const statusLabels = { expired: 'Vencido', expiring: 'Por vencer', active: 'Activo' };
    const statusIcons = { expired: 'fa-circle-xmark', expiring: 'fa-clock', active: 'fa-circle-check' };
    const priceStr = typeof formatCurrency === 'function' ? formatCurrency(e.price) : `$${e.price}`;
    const daysText = e.daysLeft <= 0 ? `Venció hace ${Math.abs(e.daysLeft)} día(s)` : `${e.daysLeft} día(s) restante(s)`;

    return `
      <div class="cal-modal-client cal-modal-${e.status}">
        <div class="cal-modal-client-header">
          <div class="cal-modal-client-info">
            <strong>${escapeAttr(e.name)}</strong>
            <span class="cal-modal-platform"><i class="fa-solid fa-tv"></i> ${escapeAttr(e.platform)} — ${escapeAttr(e.profile)}</span>
          </div>
          <span class="cal-modal-status cal-modal-status-${e.status}">
            <i class="fa-solid ${statusIcons[e.status]}"></i> ${statusLabels[e.status]}
          </span>
        </div>
        <div class="cal-modal-client-details">
          <span><i class="fa-solid fa-coins"></i> ${priceStr}</span>
          <span><i class="fa-solid fa-hourglass-half"></i> ${daysText}</span>
          ${e.phone ? `<span><i class="fa-solid fa-phone"></i> ${escapeAttr(e.phone)}</span>` : ''}
        </div>
        <div class="cal-modal-client-actions">
          ${e.status !== 'active' ? `<button class="btn btn-success btn-sm" onclick="renewClient('${e.id}'); closeModal('calendarDayModal');" title="Renovar +30 días"><i class="fa-solid fa-rotate-right"></i> Renovar</button>` : ''}
          ${e.phone ? `<a class="btn btn-secondary btn-sm" href="https://wa.me/${e.phone.replace(/[^0-9]/g, '')}" target="_blank" title="WhatsApp"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="showClientHistory('${e.id}'); closeModal('calendarDayModal');" title="Historial"><i class="fa-solid fa-clock-rotate-left"></i></button>
        </div>
      </div>
    `;
  };

  let bodyHtml = `<div class="cal-modal-summary">
    <span class="cal-modal-badge expired"><i class="fa-solid fa-circle-xmark"></i> ${expired.length} vencido(s)</span>
    <span class="cal-modal-badge expiring"><i class="fa-solid fa-clock"></i> ${expiring.length} por vencer</span>
    <span class="cal-modal-badge active"><i class="fa-solid fa-circle-check"></i> ${active.length} activo(s)</span>
  </div>
  <div class="cal-modal-clients-list">`;

  [...expired, ...expiring, ...active].forEach(e => {
    bodyHtml += renderClientRow(e);
  });

  bodyHtml += '</div>';
  bodyEl.innerHTML = bodyHtml;

  openModal('calendarDayModal');
}

/* ============================================================
   TEMPLATES — Message templates with variables
   ============================================================ */
function getTemplates() {
  return JSON.parse(localStorage.getItem('streamly_templates') || '[]');
}
function saveTemplates(templates) {
  localStorage.setItem('streamly_templates', JSON.stringify(templates));
}

function renderTemplates() {
  const container = document.getElementById('templatesList');
  if (!container) return;

  const templates = getTemplates();
  if (templates.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text-muted);">
        <i class="fa-solid fa-envelope-open-text" style="font-size:2rem;margin-bottom:8px;"></i>
        <p>No hay plantillas creadas</p>
      </div>`;
    return;
  }

  const typeLabels = { cobro: 'Cobro', bienvenida: 'Bienvenida', renovacion: 'Renovación', custom: 'Personalizado' };
  const typeColors = { cobro: 'var(--warning)', bienvenida: 'var(--success)', renovacion: 'var(--info)', custom: 'var(--accent)' };

  container.innerHTML = templates.map((t, i) => `
    <div class="template-card">
      <div class="template-card-header">
        <h4><i class="fa-solid fa-envelope"></i> ${escapeAttr(t.name)}</h4>
        <span class="badge" style="background:${typeColors[t.type] || 'var(--accent)'};color:#fff;">${typeLabels[t.type] || t.type}</span>
      </div>
      <div class="template-card-body">${escapeAttr(t.message)}</div>
      <div class="template-card-actions">
        <button class="btn btn-secondary btn-sm" onclick="editTemplate(${i})">
          <i class="fa-solid fa-pen-to-square"></i> Editar
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteTemplate(${i})">
          <i class="fa-solid fa-trash-can"></i> Eliminar
        </button>
      </div>
    </div>
  `).join('');
}

function addTemplate() {
  document.getElementById('templateId').value = '';
  document.getElementById('templateName').value = '';
  document.getElementById('templateType').value = 'cobro';
  document.getElementById('templateMessage').value = '';
  document.getElementById('templateModalTitle').textContent = 'Nueva Plantilla';
  openModal('templateModal');
}

function editTemplate(index) {
  const templates = getTemplates();
  const t = templates[index];
  if (!t) return;

  document.getElementById('templateId').value = index;
  document.getElementById('templateName').value = t.name;
  document.getElementById('templateType').value = t.type;
  document.getElementById('templateMessage').value = t.message;
  document.getElementById('templateModalTitle').textContent = 'Editar Plantilla';
  openModal('templateModal');
}

function saveTemplate() {
  const id = document.getElementById('templateId').value;
  const name = document.getElementById('templateName').value.trim();
  const type = document.getElementById('templateType').value;
  const message = document.getElementById('templateMessage').value.trim();

  if (!name || !message) return showToast('Completa nombre y mensaje', 'warning');

  const templates = getTemplates();
  const tpl = { name, type, message };

  if (id !== '') {
    templates[parseInt(id)] = tpl;
  } else {
    templates.push(tpl);
  }

  saveTemplates(templates);
  closeModal('templateModal');
  renderTemplates();
  logActivity('edit', `Plantilla guardada: ${name}`);
  showToast('Plantilla guardada', 'success');
}

function deleteTemplate(index) {
  const templates = getTemplates();
  templates.splice(index, 1);
  saveTemplates(templates);
  renderTemplates();
  showToast('Plantilla eliminada', 'success');
}

function applyTemplateVars(text, client) {
  const days = Math.abs(daysRemaining(client.fecha_fin));
  return text
    .replace(/{nombre}/g, client.nombre || '')
    .replace(/{plataforma}/g, client.plataforma || '')
    .replace(/{perfil}/g, client.perfil_asignado || '')
    .replace(/{precio}/g, client.precio ? formatCurrency(client.precio) : '')
    .replace(/{vencimiento}/g, formatDate(client.fecha_fin))
    .replace(/{dias_mora}/g, String(days));
}

/* ============================================================
   ACTIVITY LOG
   ============================================================ */
function logActivity(type, text) {
  const logs = JSON.parse(localStorage.getItem('streamly_logs') || '[]');
  logs.unshift({
    type,
    text,
    time: new Date().toISOString()
  });
  // Keep max 200 entries
  if (logs.length > 200) logs.length = 200;
  localStorage.setItem('streamly_logs', JSON.stringify(logs));
}

function renderActivityLogs() {
  const container = document.getElementById('activityLogsList');
  if (!container) return;

  const logs = JSON.parse(localStorage.getItem('streamly_logs') || '[]');

  if (logs.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text-muted);">
        <i class="fa-solid fa-clipboard-list" style="font-size:2rem;margin-bottom:8px;"></i>
        <p>No hay actividad registrada</p>
      </div>`;
    return;
  }

  const iconMap = {
    create: 'fa-solid fa-plus',
    edit: 'fa-solid fa-pen-to-square',
    delete: 'fa-solid fa-trash-can',
    renew: 'fa-solid fa-rotate-right',
    payment: 'fa-solid fa-hand-holding-dollar',
    export: 'fa-solid fa-download'
  };

  container.innerHTML = logs.map(l => {
    const icon = iconMap[l.type] || 'fa-solid fa-circle-info';
    const timeStr = new Date(l.time).toLocaleString('es-ES', { 
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' 
    });
    return `
      <div class="log-entry">
        <div class="log-icon ${l.type}"><i class="${icon}"></i></div>
        <div class="log-body">
          <div class="log-text">${escapeAttr(l.text)}</div>
          <div class="log-time">${timeStr}</div>
        </div>
      </div>`;
  }).join('');
}

function clearActivityLogs() {
  localStorage.removeItem('streamly_logs');
  renderActivityLogs();
  showToast('Registro de actividad limpiado', 'success');
}

/* ============================================================
   INIT HOOKS — Theme + Currency on load
   ============================================================
   NOTE: MutationObserver was removed — it caused infinite loops
   when renderCalendar() wrote innerHTML (triggering DOM mutations
   → observer → renderCalendar → innerHTML → observer…).
   Navigation hooks in utils.js navigateTo() handle everything.
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  if (typeof initTheme === 'function') initTheme();

  // Load default templates if none exist
  const templates = getTemplates();
  if (templates.length === 0) {
    saveTemplates([
      {
        name: 'Cobro mensual',
        type: 'cobro',
        message: 'Hola {nombre} 👋\n\nTe escribo para recordarte que tu suscripción de *{plataforma}* venció hace *{dias_mora} días*.\n\nEl precio de renovación es *{precio}*.\n\n¿Deseas renovar? 😊'
      },
      {
        name: 'Bienvenida',
        type: 'bienvenida',
        message: '¡Hola {nombre}! 🎉\n\nBienvenido/a a *{plataforma}*.\n\nTu perfil asignado es: *{perfil}*\nVencimiento: *{vencimiento}*\n\n¡Que lo disfrutes! 🎬'
      },
      {
        name: 'Renovación exitosa',
        type: 'renovacion',
        message: 'Hola {nombre} ✅\n\nTu renovación de *{plataforma}* ha sido exitosa.\n\nNueva fecha de vencimiento: *{vencimiento}*\nPrecio: *{precio}*\n\n¡Gracias por renovar! 🙏'
      }
    ]);
  }
});
