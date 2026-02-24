/* ============================================================
   Streamly — Utilidades Compartidas
   ============================================================ */

// Build ID (debug): útil para confirmar qué versión está cargando el navegador
window.STREAMLY_BUILD_ID = '2026-02-24-micuenta';
console.log('⚡ Streamly build:', window.STREAMLY_BUILD_ID);

// ── Formateo de fechas ──────────────────────────────────────
/**
 * Convierte una fecha a string legible (dd/mm/aaaa)
 */
function formatDate(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

/**
 * Convierte fecha a string para input[type=date]
 */
function toInputDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
  return d.toISOString().split('T')[0];
}

/**
 * Calcula los días restantes desde hoy hasta una fecha dada
 */
function daysRemaining(endDate) {
  if (!endDate) return 0;
  const end = endDate instanceof Date ? new Date(endDate.getTime()) : endDate.toDate ? new Date(endDate.toDate().getTime()) : new Date(endDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const diff = end.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * Devuelve la clase CSS de badge según los días restantes
 */
function getStatusBadge(days) {
  if (days <= 0) return { class: 'badge-expired', text: 'Vencido' };
  if (days <= 3) return { class: 'badge-warning', text: `${days} día${days > 1 ? 's' : ''}` };
  return { class: 'badge-active', text: 'Activo' };
}

/**
 * Devuelve HTML del badge de estado
 */
function renderStatusBadge(days) {
  const status = getStatusBadge(days);
  return `<span class="badge ${status.class}">${status.text}</span>`;
}

/**
 * Devuelve HTML de days remaining con color
 */
function renderDaysRemaining(days) {
  let color = 'var(--success)';
  if (days <= 0) color = 'var(--danger)';
  else if (days <= 3) color = 'var(--warning)';
  else if (days <= 7) color = 'var(--warning)';
  return `<span style="color: ${color}; font-weight: 600;">${days}</span>`;
}

// ── Formateo de moneda (multi-moneda) ───────────────────────
const CURRENCY_MAP = {
  COP: { locale: 'es-CO', currency: 'COP', fractions: 0 },
  USD: { locale: 'en-US', currency: 'USD', fractions: 2 },
  EUR: { locale: 'de-DE', currency: 'EUR', fractions: 2 },
  MXN: { locale: 'es-MX', currency: 'MXN', fractions: 0 },
  ARS: { locale: 'es-AR', currency: 'ARS', fractions: 0 },
  BRL: { locale: 'pt-BR', currency: 'BRL', fractions: 2 },
  PEN: { locale: 'es-PE', currency: 'PEN', fractions: 2 },
  CLP: { locale: 'es-CL', currency: 'CLP', fractions: 0 }
};

function getSelectedCurrency() {
  return localStorage.getItem('streamly_currency') || 'COP';
}

function setCurrency(code) {
  localStorage.setItem('streamly_currency', code);
  const sel = document.getElementById('currencySelect');
  if (sel) sel.value = code;
  // Refresh UI
  if (typeof updateDashboard === 'function') updateDashboard();
  if (typeof renderClientsTable === 'function') renderClientsTable();
  if (typeof renderMovementsTable === 'function') renderMovementsTable();
  if (typeof updateReports === 'function') updateReports();
  if (typeof updatePlanPage === 'function') updatePlanPage();
}

function formatCurrency(amount) {
  const code = getSelectedCurrency();
  const cfg = CURRENCY_MAP[code] || CURRENCY_MAP.COP;
  return new Intl.NumberFormat(cfg.locale, {
    style: 'currency',
    currency: cfg.currency,
    minimumFractionDigits: cfg.fractions,
    maximumFractionDigits: cfg.fractions
  }).format(amount || 0);
}

// ── Platform tag HTML ───────────────────────────────────────
function getPlatformClass(platform) {
  const map = {
    'Netflix': 'netflix',
    'Disney+': 'disney',
    'HBO Max': 'hbo',
    'Spotify': 'spotify',
    'Amazon Prime': 'prime',
    'Crunchyroll': 'crunchyroll',
    'YouTube Premium': 'youtube',
    'Paramount+': 'paramount',
    'Apple TV+': 'apple',
    'Star+': 'disney'
  };
  return map[platform] || '';
}

function renderPlatformTag(platform) {
  const cls = getPlatformClass(platform);
  return `<span class="platform-tag ${cls}">${platform}</span>`;
}

// ── Profile Slots Visual ────────────────────────────────────
function renderProfileSlots(total, occupied) {
  let html = '<div class="profile-slots">';
  for (let i = 1; i <= total; i++) {
    if (i <= occupied) {
      html += `<div class="profile-slot occupied">${i}</div>`;
    } else {
      html += `<div class="profile-slot available">${i}</div>`;
    }
  }
  html += '</div>';
  return html;
}

// ── Plataforma personalizada ────────────────────────────────
function toggleCustomPlatform() {
  const sel = document.getElementById('accountPlatform');
  const custom = document.getElementById('accountPlatformCustom');
  if (!sel || !custom) return;
  if (sel.value === '__custom__') {
    custom.style.display = '';
    custom.required = true;
    custom.focus();
  } else {
    custom.style.display = 'none';
    custom.required = false;
    custom.value = '';
  }
}

// ── Modales ─────────────────────────────────────────────────
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    // Limpiar formulario si existe
    const form = modal.querySelector('form');
    if (form) {
      form.reset();
      // Limpiar hidden inputs de IDs para evitar conflictos editar/crear
      const hiddenInputs = form.querySelectorAll('input[type="hidden"]');
      hiddenInputs.forEach(input => input.value = '');
    }
    // Ocultar campo de plataforma personalizada al cerrar
    const customPlatform = document.getElementById('accountPlatformCustom');
    if (customPlatform) {
      customPlatform.style.display = 'none';
      customPlatform.required = false;
      customPlatform.value = '';
    }
  }
}

// Cerrar modal al hacer click fuera
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('active')) {
    e.target.classList.remove('active');
    document.body.style.overflow = '';
  }
});

// Cerrar modales con Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => {
      m.classList.remove('active');
    });
    document.body.style.overflow = '';
  }
});

// ── Toast Notifications ─────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const icons = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="fa-solid ${icons[type] || icons.info}"></i>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;

  container.appendChild(toast);

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── Sidebar Toggle (Mobile) ────────────────────────────────
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('active');
}

// Cerrar sidebar al hacer click en el overlay
document.getElementById('sidebarOverlay')?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
});

// ── Navegación entre secciones ──────────────────────────────
function navigateTo(section) {
  // Verificar acceso por plan (si la función existe y aplica)
  if (typeof canAccessSection === 'function' && !canAccessSection(section)) {
    if (typeof showUpgradeModal === 'function') {
      const sectionNames = {
        reportes: 'Reportes', calendario: 'Calendario', deudores: 'Deudores',
        plantillas: 'Plantillas', logs: 'Actividad', chatbot: 'Chatbot IA'
      };
      showUpgradeModal(
        `${sectionNames[section] || section} no disponible`,
        `Tu plan actual no incluye acceso a ${sectionNames[section] || section}. Mejora tu plan para desbloquear esta herramienta.`
      );
    }
    return;
  }

  // Ocultar todas las secciones
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  // Mostrar la sección seleccionada
  const target = document.getElementById(`section-${section}`);
  if (target) target.classList.add('active');

  // Actualizar nav items
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  const navBtn = document.querySelector(`.nav-item[data-section="${section}"]`);
  if (navBtn) navBtn.classList.add('active');

  // Actualizar título
  const titles = {
    dashboard: 'Dashboard',
    cuentas: 'Cuentas',
    clientes: 'Clientes',
    movimientos: 'Movimientos',
    reportes: 'Reportes',
    calendario: 'Calendario',
    deudores: 'Deudores',
    plantillas: 'Plantillas',
    logs: 'Actividad',
    chatbot: 'Chatbot IA',
    plan: 'Mi Plan',
    micuenta: 'Mi Cuenta'
  };
  document.getElementById('pageTitle').textContent = titles[section] || section;

  // Cerrar sidebar en mobile
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');

  // Auto-conectar al bot cuando se visita la sección chatbot
  if (section === 'chatbot' && typeof connectBotServer === 'function' && typeof botPollingInterval !== 'undefined' && !botPollingInterval) {
    setTimeout(() => connectBotServer(), 400);
  }

  // Cargar pedidos pendientes al visitar clientes
  if (section === 'clientes' && typeof loadPendingOrders === 'function') {
    setTimeout(() => loadPendingOrders(), 200);
  }

  // Recargar movimientos al visitar la sección
  if (section === 'movimientos' && typeof loadMovements === 'function') {
    setTimeout(() => loadMovements(), 200);
  }

  // Render new sections on navigation
  if (section === 'calendario' && typeof renderCalendar === 'function') {
    setTimeout(() => renderCalendar(), 100);
  }
  if (section === 'deudores' && typeof renderDebtorsTable === 'function') {
    setTimeout(() => renderDebtorsTable(), 100);
  }
  if (section === 'plantillas' && typeof renderTemplates === 'function') {
    setTimeout(() => renderTemplates(), 100);
  }
  if (section === 'logs' && typeof renderActivityLogs === 'function') {
    setTimeout(() => renderActivityLogs(), 100);
  }
  if (section === 'plan' && typeof updatePlanPage === 'function') {
    setTimeout(() => updatePlanPage(), 100);
  }
  if (section === 'micuenta' && typeof updateMyAccountPage === 'function') {
    setTimeout(() => updateMyAccountPage(), 100);
  }
}

// ── Toggle Password Visibility ──────────────────────────────
function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  const icon = btn.querySelector('i');
  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
  } else {
    input.type = 'password';
    icon.classList.remove('fa-eye-slash');
    icon.classList.add('fa-eye');
  }
}

// ── Copiar al portapapeles ──────────────────────────────────
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copiado al portapapeles', 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Copiado al portapapeles', 'success');
  });
}

// ── WhatsApp Link Generator ─────────────────────────────────
/**
 * Genera un link de WhatsApp con credenciales formateadas (envío de datos de acceso)
 */
function generateCredentialsLink(client, account) {
  const phone = (client.whatsapp || '').replace(/[^0-9]/g, '');
  
  const message = `¡Hola ${client.nombre}! 👋\n\n` +
    `Aquí están tus datos de acceso para *${account?.plataforma || 'tu cuenta'}*:\n\n` +
    `📧 *Correo:* ${account?.correo_cuenta || ''}\n` +
    `🔑 *Contraseña:* ${account?.password || ''}\n` +
    `👤 *Perfil:* ${client.perfil_asignado || ''}\n` +
    (client.pin ? `🔒 *PIN:* ${client.pin}\n` : '') +
    `\n📅 *Fecha de inicio:* ${formatDate(client.fecha_inicio)}\n` +
    `📅 *Fecha de fin:* ${formatDate(client.fecha_fin)}\n\n` +
    `¡Gracias por tu compra! Que lo disfrutes 🎬✨\n\n` +
    `_Si tienes alguna duda, escríbeme por aquí_ 😊`;

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

/**
 * Link de WhatsApp genérico (antiguo)
 */
function generateWhatsAppLink(client, account) {
  return generateCredentialsLink(client, account);
}

// ── Fecha Header ────────────────────────────────────────────
function updateHeaderDate() {
  const el = document.getElementById('headerDate');
  if (el) {
    el.textContent = new Date().toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
}

// ── Quick Add (header button) ───────────────────────────────
function openQuickAdd() {
  const activeSection = document.querySelector('.section.active')?.id || '';
  if (activeSection.includes('cuentas')) {
    openModal('accountModal');
  } else if (activeSection.includes('clientes')) {
    if (typeof openNewClientModal === 'function') openNewClientModal();
    else openModal('clientModal');
  } else if (activeSection.includes('movimientos')) {
    openModal('movementModal');
  } else {
    // Default: nuevo cliente
    if (typeof openNewClientModal === 'function') openNewClientModal();
    else openModal('clientModal');
  }
}

console.log('🛠️ Utilidades cargadas');

// ── Theme Toggle ────────────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('streamly_theme', next);
  const icon = document.getElementById('themeIcon');
  if (icon) {
    icon.className = next === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }
}

function initTheme() {
  const saved = localStorage.getItem('streamly_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  const icon = document.getElementById('themeIcon');
  if (icon) {
    icon.className = saved === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }
  // Init currency selector
  const sel = document.getElementById('currencySelect');
  if (sel) sel.value = getSelectedCurrency();
}

// ── CSV Export ───────────────────────────────────────────────
function exportCSV(type) {
  let rows = [];
  let filename = '';

  if (type === 'clientes' && typeof clientsData !== 'undefined') {
    rows.push(['Nombre', 'WhatsApp', 'Plataforma', 'Perfil', 'Precio', 'Inicio', 'Vencimiento', 'Estado Pago']);
    clientsData.forEach(c => {
      rows.push([
        c.nombre, c.whatsapp, c.plataforma || '', c.perfil_asignado,
        c.precio || 0, c.fecha_inicio, c.fecha_fin, c.estado_pago || 'pendiente'
      ]);
    });
    filename = `streamly_clientes_${new Date().toISOString().slice(0,10)}.csv`;
  } else if (type === 'movimientos' && typeof movementsData !== 'undefined') {
    rows.push(['Fecha', 'Cliente', 'Monto', 'Método', 'Nota']);
    movementsData.forEach(m => {
      const client = clientsData.find(c => c.id === m.cliente_id);
      rows.push([
        m.fecha, client?.nombre || m.cliente_id, m.monto || 0, m.metodo || '', m.nota || ''
      ]);
    });
    filename = `streamly_movimientos_${new Date().toISOString().slice(0,10)}.csv`;
  }

  if (rows.length <= 1) {
    showToast('No hay datos para exportar', 'warning');
    return;
  }

  const csvContent = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  if (typeof logActivity === 'function') logActivity('export', `Exportación CSV: ${type}`);
  showToast('CSV descargado', 'success');
}

// ── PDF Export (simple HTML print) ──────────────────────────
function exportPDF() {
  const win = window.open('', '_blank');
  const now = new Date().toLocaleDateString('es-ES', { year:'numeric', month:'long', day:'numeric' });

  let html = `<!DOCTYPE html><html><head><title>Reporte Streamly</title>
  <style>
    body{font-family:Arial,sans-serif;padding:30px;color:#222;}
    h1{color:#7c3aed;font-size:1.5rem;}
    h2{font-size:1.1rem;margin-top:20px;color:#555;}
    table{width:100%;border-collapse:collapse;margin-top:10px;font-size:0.85rem;}
    th,td{border:1px solid #ddd;padding:6px 10px;text-align:left;}
    th{background:#f3f3f8;font-weight:600;}
    .highlight{color:#7c3aed;font-weight:700;}
    @media print{body{padding:10px;} button{display:none;}}
  </style></head><body>
  <h1>📺 Streamly — Reporte</h1>
  <p>Generado: ${now}</p>
  <button onclick="window.print()" style="padding:8px 16px;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer;margin-bottom:16px;">Imprimir / Guardar PDF</button>`;

  // Stats
  if (typeof clientsData !== 'undefined') {
    const active = clientsData.filter(c => daysRemaining(c.fecha_fin) > 0).length;
    const expired = clientsData.filter(c => daysRemaining(c.fecha_fin) <= 0).length;
    const income = movementsData.reduce((s, m) => s + (parseFloat(m.monto) || 0), 0);
    html += `<h2>Resumen</h2><p>Clientes activos: <span class="highlight">${active}</span> | Vencidos: <span class="highlight">${expired}</span> | Ingresos totales: <span class="highlight">${formatCurrency(income)}</span></p>`;

    // Clients table
    html += `<h2>Clientes</h2><table><tr><th>Nombre</th><th>Plataforma</th><th>Perfil</th><th>Precio</th><th>Vencimiento</th><th>Estado</th></tr>`;
    clientsData.forEach(c => {
      const d = daysRemaining(c.fecha_fin);
      const status = d <= 0 ? 'Vencido' : d <= 3 ? 'Por vencer' : 'Activo';
      html += `<tr><td>${c.nombre}</td><td>${c.plataforma || ''}</td><td>${c.perfil_asignado || ''}</td><td>${formatCurrency(c.precio)}</td><td>${formatDate(c.fecha_fin)}</td><td>${status}</td></tr>`;
    });
    html += '</table>';

    // Platform summary
    const platforms = {};
    clientsData.forEach(c => {
      const p = c.plataforma || 'Otra';
      if (!platforms[p]) platforms[p] = { total: 0, active: 0, income: 0 };
      platforms[p].total++;
      if (daysRemaining(c.fecha_fin) > 0) platforms[p].active++;
      platforms[p].income += parseFloat(c.precio) || 0;
    });
    html += `<h2>Por Plataforma</h2><table><tr><th>Plataforma</th><th>Total</th><th>Activos</th><th>Ingresos</th></tr>`;
    Object.entries(platforms).forEach(([p, v]) => {
      html += `<tr><td>${p}</td><td>${v.total}</td><td>${v.active}</td><td>${formatCurrency(v.income)}</td></tr>`;
    });
    html += '</table>';
  }

  html += '</body></html>';
  win.document.write(html);
  win.document.close();
  if (typeof logActivity === 'function') logActivity('export', 'Exportación PDF generada');
}

// ── Backup JSON ─────────────────────────────────────────────
function exportBackupJSON() {
  const backup = {
    exportDate: new Date().toISOString(),
    accounts: typeof accountsData !== 'undefined' ? accountsData : [],
    clients: typeof clientsData !== 'undefined' ? clientsData : [],
    movements: typeof movementsData !== 'undefined' ? movementsData : [],
    templates: JSON.parse(localStorage.getItem('streamly_templates') || '[]'),
    settings: {
      currency: getSelectedCurrency(),
      theme: localStorage.getItem('streamly_theme') || 'dark',
      language: localStorage.getItem('streamly_lang') || 'es'
    }
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `streamly_backup_${new Date().toISOString().slice(0,10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  if (typeof logActivity === 'function') logActivity('export', 'Backup JSON descargado');
  showToast('Backup descargado', 'success');
}
