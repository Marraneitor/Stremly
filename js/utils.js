/* ============================================================
   Streamly — Utilidades Compartidas
   ============================================================ */

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

// ── Formateo de moneda ──────────────────────────────────────
function formatCurrency(amount) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
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
    reportes: 'Reportes'
  };
  document.getElementById('pageTitle').textContent = titles[section] || section;

  // Cerrar sidebar en mobile
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
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
 * Genera un link de WhatsApp con credenciales formateadas
 */
function generateWhatsAppLink(client, account) {
  const phone = (client.whatsapp || '').replace(/[^0-9]/g, '');
  
  const message = `¡Hola ${client.nombre}! 👋\n\n` +
    `📺 *Datos de tu cuenta ${account?.plataforma || ''}:*\n\n` +
    `📧 Correo: ${account?.correo_cuenta || ''}\n` +
    `🔑 Contraseña: ${account?.password || ''}\n` +
    `👤 Perfil: ${client.perfil_asignado || ''}\n` +
    `🔒 PIN: ${client.pin || 'Sin PIN'}\n\n` +
    `📅 Vigente hasta: ${formatDate(client.fecha_fin)}\n\n` +
    `_Enviado desde Streamly_ ⚡`;

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
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
    openModal('clientModal');
  } else if (activeSection.includes('movimientos')) {
    openModal('movementModal');
  } else {
    // Default: nuevo cliente
    openModal('clientModal');
  }
}

console.log('🛠️ Utilidades cargadas');
