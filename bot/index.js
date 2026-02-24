/* ============================================================
   Streamly — WhatsApp Bot v3.0 (Railway + Baileys + Gemini)
   ============================================================
   
   Bot autónomo de ventas por WhatsApp:
   - Corre 24/7 en Railway
   - Conexión a WhatsApp vía Baileys (QR en panel web)
   - Lee config + inventario de Firestore automáticamente
   - Venta inteligente con Gemini AI
   - Panel de conversaciones con respuesta manual
   - Filtros: grupos, guardados, no guardados
   - Pausa por conversación individual
   ============================================================ */

require('dotenv').config();

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const pino = require('pino');
const admin = require('firebase-admin');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const SkillManager = require('./skills');

// ── Validar variables de entorno ────────────────────────────
const REQUIRED_ENV = ['GEMINI_API_KEY', 'FIREBASE_PROJECT_ID', 'BOT_OWNER_UID'];
const missingEnv = REQUIRED_ENV.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`⚠️ Variables de entorno faltantes: ${missingEnv.join(', ')}`);
  console.error('El bot NO funcionará correctamente hasta que las configures en Railway → Variables');
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const BOT_OWNER_UID = process.env.BOT_OWNER_UID || '';
const HTTP_PORT = process.env.PORT || process.env.BOT_PORT || 3001;

// ── Skills (análisis y auto-corrección de código) ───────────
const skills = new SkillManager(GEMINI_API_KEY);

// ── Estado global del bot ───────────────────────────────────
let botState = {
  status: 'disconnected',
  qr: null,
  qrDataUrl: null,
  phone: null,
  messagesCount: 0,
  logs: [],
  startedAt: null
};

// ── Contador de reconexiones por error 440 ──────────────────
let consecutive440 = 0;
const MAX_440_BEFORE_RESET = 3;

// ── Conversaciones activas (en memoria) ─────────────────────
const conversations = new Map();

// ── Pedidos pendientes (en memoria) ─────────────────────────
const pendingOrders = [];
let orderIdCounter = 1;

// ── Ajustes del bot ─────────────────────────────────────────
let botSettings = {
  respondGroups: false,
  respondSaved: true,
  respondUnsaved: true
};

// ── Pausa global del bot ────────────────────────────────────
let botGlobalPaused = false;

// ── Mensajes programados ────────────────────────────────────
let scheduledMessages = [];
let scheduledIdCounter = 1;
let scheduledInterval = null;

function startScheduler() {
  if (scheduledInterval) return;
  scheduledInterval = setInterval(async () => {
    if (!sock || botState.status !== 'connected') return;
    const now = Date.now();
    for (const sm of scheduledMessages) {
      if (!sm.active) continue;
      if (now >= sm.nextRun) {
        try {
          await sock.sendMessage(sm.jid, { text: sm.message });
          addLog(`📨 Mensaje programado enviado a ${sm.groupName || sm.jid.split('@')[0]}`);
          sm.lastSent = now;
          sm.sendCount = (sm.sendCount || 0) + 1;
          if (sm.recurring && sm.intervalMs > 0) {
            sm.nextRun = now + sm.intervalMs;
          } else {
            sm.active = false;
            addLog(`   ✅ Mensaje programado #${sm.id} completado (una vez)`);
          }
        } catch (err) {
          addLog(`   ❌ Error enviando programado #${sm.id}: ${err.message}`);
        }
      }
    }
    // Limpiar mensajes inactivos viejos (>24h desde completados)
    const cutoff = now - 24 * 60 * 60 * 1000;
    scheduledMessages = scheduledMessages.filter(sm => sm.active || (sm.lastSent && sm.lastSent > cutoff));
  }, 10000); // Revisar cada 10 segundos
}

startScheduler();

// Circular buffer para logs — evita shift() que es O(n)
const MAX_LOGS = 150;
let logIndex = 0;

function addLog(msg) {
  const entry = { time: new Date().toISOString(), msg };
  if (botState.logs.length < MAX_LOGS) {
    botState.logs.push(entry);
  } else {
    botState.logs[logIndex] = entry;
  }
  logIndex = (logIndex + 1) % MAX_LOGS;
  console.log(msg);
}

// Helper: obtener logs ordenados del circular buffer
function getOrderedLogs(count) {
  if (botState.logs.length < MAX_LOGS) return botState.logs.slice(-count);
  const ordered = [...botState.logs.slice(logIndex), ...botState.logs.slice(0, logIndex)];
  return ordered.slice(-count);
}

// ── Firebase Admin (con soporte para Service Account JSON) ──
if (!admin.apps.length) {
  let credential = null;

  // Opción 1: Variable FIREBASE_SERVICE_ACCOUNT con JSON completo
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      credential = admin.credential.cert(serviceAccount);
      console.log('🔑 Firebase: usando Service Account desde variable de entorno');
    } catch (e) {
      console.error('❌ FIREBASE_SERVICE_ACCOUNT no es un JSON válido:', e.message);
    }
  }
  // Opción 2: Archivo de credenciales
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    credential = admin.credential.applicationDefault();
    console.log('🔑 Firebase: usando archivo de credenciales');
  }

  if (credential) {
    admin.initializeApp({
      credential,
      projectId: process.env.FIREBASE_PROJECT_ID
    });
  } else {
    // Sin credenciales — funciona solo con sync-context desde el panel
    admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
    console.warn('⚠️ Firebase: sin credenciales. El bot necesitará sync desde el panel o FIREBASE_SERVICE_ACCOUNT.');
  }
}

const db = admin.firestore();
const logger = pino({ level: 'silent' });
let firestoreAvailable = false;

// Verificar acceso a Firestore al iniciar
(async () => {
  try {
    await db.collection('chatbot_config').doc(BOT_OWNER_UID).get();
    firestoreAvailable = true;
    addLog('✅ Firestore conectado — modo autónomo activo');
  } catch (err) {
    firestoreAvailable = false;
    addLog('⚠️ Firestore no disponible — funciona solo con sync desde panel');
  }
})();

// ── Cache del contexto ──────────────────────────────────────
let botConfig = { enabled: true };
let configLastFetch = 0;
const CONFIG_CACHE_MS = 60 * 1000;

async function getConfig() {
  const now = Date.now();
  if (botConfig && (now - configLastFetch) < CONFIG_CACHE_MS) return botConfig;

  if (firestoreAvailable) {
    try {
      const doc = await db.collection('chatbot_config').doc(BOT_OWNER_UID).get();
      if (doc.exists) {
        botConfig = doc.data();
        configLastFetch = now;
        if (botConfig.botSettings) {
          botSettings = { ...botSettings, ...botConfig.botSettings };
        }
        console.log('📋 Config recargada desde Firestore');
      }
    } catch (err) {
      console.warn('⚠️ Error leyendo config:', err.message);
    }
  }
  return botConfig;
}

// ── Cache de cuentas disponibles ────────────────────────────
let availableAccountsCache = null;
let accountsCacheTime = 0;
const ACCOUNTS_CACHE_MS = 120 * 1000;

async function getAvailableAccounts() {
  const now = Date.now();
  if (availableAccountsCache && (now - accountsCacheTime) < ACCOUNTS_CACHE_MS) {
    return availableAccountsCache;
  }

  if (!firestoreAvailable) return availableAccountsCache || [];

  try {
    const [cuentasSnap, clientesSnap] = await Promise.all([
      db.collection('cuentas').where('uid', '==', BOT_OWNER_UID).get(),
      db.collection('clientes').where('uid', '==', BOT_OWNER_UID).get()
    ]);

    const cuentas = cuentasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const clientes = clientesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const platforms = {};
    for (const acc of cuentas) {
      const p = acc.plataforma;
      if (!platforms[p]) platforms[p] = { total: 0, ocupados: 0 };
      platforms[p].total += (acc.perfiles_totales || 0);
    }
    for (const cl of clientes) {
      const p = cl.plataforma || '';
      const fin = cl.fecha_fin?.toDate ? cl.fecha_fin.toDate() : (cl.fecha_fin ? new Date(cl.fecha_fin) : null);
      if (fin && fin > new Date()) {
        if (platforms[p]) platforms[p].ocupados++;
      }
    }

    const result = Object.entries(platforms).map(([name, data]) => ({
      plataforma: name,
      disponibles: Math.max(0, data.total - data.ocupados),
      total: data.total,
      ocupados: data.ocupados
    }));

    availableAccountsCache = result;
    accountsCacheTime = now;
    return result;
  } catch (err) {
    console.error('⚠️ Error leyendo cuentas:', err.message);
    return availableAccountsCache || [];
  }
}

// ── Helpers de conversación ─────────────────────────────────
function getOrCreateConversation(jid, pushName) {
  if (!conversations.has(jid)) {
    const isGroup = jid.endsWith('@g.us');
    const phone = jid.split('@')[0];
    conversations.set(jid, {
      jid,
      name: pushName || phone,
      phone,
      isGroup,
      messages: [],
      paused: false,
      lastTimestamp: Date.now(),
      unread: 0
    });
  }
  const conv = conversations.get(jid);
  if (pushName && pushName !== conv.phone) conv.name = pushName;
  return conv;
}

function addMessage(conv, from, text) {
  const msg = { from, text, timestamp: Date.now() };
  conv.messages.push(msg);
  if (conv.messages.length > 50) conv.messages.splice(0, conv.messages.length - 50);
  conv.lastTimestamp = msg.timestamp;
  return msg;
}

// Limpiar conversaciones inactivas (>24h) para liberar memoria
const CONV_CLEANUP_MS = 30 * 60 * 1000; // cada 30min
const CONV_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
setInterval(() => {
  const cutoff = Date.now() - CONV_MAX_AGE_MS;
  let cleaned = 0;
  for (const [jid, conv] of conversations) {
    if (conv.lastTimestamp < cutoff && !conv.paused) {
      conversations.delete(jid);
      cleaned++;
    }
  }
  if (cleaned > 0) addLog(`🧹 ${cleaned} conversación(es) inactiva(s) limpiada(s)`);
}, CONV_CLEANUP_MS);

// ── Gemini AI (v2 — con system_instruction y memoria real) ──
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Cache del system prompt (se regenera solo cuando cambia la config)
let cachedSystemPrompt = null;
let systemPromptConfigHash = null;

function hashConfig(config) {
  return JSON.stringify({
    name: config?.businessName,
    personality: config?.personality,
    schedule: config?.schedule,
    context: config?.context,
    fallback: config?.fallbackMsg
  });
}

// Pre-compilar regexes de limpieza de Markdown
const MD_BOLD_RE = /\*\*(.+?)\*\*/g;
const MD_ITALIC_RE = /\*(.+?)\*/g;
const MD_HEADING_RE = /^#+\s/gm;
const MD_CODE_BLOCK_RE = /```[\s\S]*?```/g;
const ORDER_TAG_RE = /\[PEDIDO_CONFIRMADO\](\{[^}]+\})/;
const ORDER_TAG_CLEAN_RE = /\[PEDIDO_CONFIRMADO\]\{[^}]+\}/g;

async function askGemini(message, config, conversationHistory) {
  const currentConfig = config || {};
  const configHash = hashConfig(currentConfig);
  if (!cachedSystemPrompt || configHash !== systemPromptConfigHash) {
    cachedSystemPrompt = await buildSystemPrompt(currentConfig);
    systemPromptConfigHash = configHash;
  }
  const maxTokens = currentConfig.maxTokens || 600;

  // Construir historial LIMPIO de conversación (sin system prompt mezclado)
  const contents = [];
  if (conversationHistory && conversationHistory.length > 0) {
    // Tomar los últimos 20 mensajes para contexto amplio
    const recent = conversationHistory.slice(-20);
    for (const m of recent) {
      // Agrupar: customer/user → 'user', bot/agent → 'model'
      const role = (m.from === 'bot' || m.from === 'agent') ? 'model' : 'user';
      contents.push({ role, parts: [{ text: m.text }] });
    }
  }

  // Agregar el mensaje actual del usuario
  contents.push({ role: 'user', parts: [{ text: message }] });

  // Asegurar que el primer mensaje sea de 'user' (requerimiento de Gemini)
  while (contents.length > 0 && contents[0].role !== 'user') {
    contents.shift();
  }

  // Fusionar mensajes consecutivos del mismo rol (Gemini no permite duplicados)
  const mergedContents = [];
  for (const c of contents) {
    const last = mergedContents[mergedContents.length - 1];
    if (last && last.role === c.role) {
      last.parts[0].text += '\n' + c.parts[0].text;
    } else {
      mergedContents.push({ role: c.role, parts: [{ text: c.parts[0].text }] });
    }
  }

  const requestBody = {
    system_instruction: {
      parts: [{ text: cachedSystemPrompt }]
    },
    contents: mergedContents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.8,
      topP: 0.92,
      topK: 40
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
    ]
  };

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('❌ Gemini API error:', errText);
    addLog(`❌ Gemini error (${res.status}): ${errText.substring(0, 200)}`);
    return currentConfig.fallbackMsg || 'Lo siento, no pude procesar tu mensaje en este momento.';
  }

  const data = await res.json();
  let reply = data?.candidates?.[0]?.content?.parts?.[0]?.text
    || currentConfig.fallbackMsg
    || 'Lo siento, no pude generar una respuesta.';

  // Limpiar formato Markdown (regexes pre-compiladas)
  reply = reply.replace(MD_BOLD_RE, '$1')
               .replace(MD_ITALIC_RE, '$1')
               .replace(MD_HEADING_RE, '')
               .replace(MD_CODE_BLOCK_RE, '')
               .trim();

  return reply;
}

async function buildSystemPrompt(config) {
  const lines = [];

  // ── Identidad y personalidad ──
  const botName = config.businessName || 'StreamBot';
  lines.push(`Eres ${botName}, un asistente virtual de ventas de cuentas de streaming por WhatsApp.`);
  lines.push('');

  // ── Reglas de formato ──
  lines.push('REGLAS DE FORMATO (obligatorias):');
  lines.push('- Escribe SIEMPRE en español mexicano casual.');
  lines.push('- Formato WhatsApp: texto plano, sin Markdown, sin asteriscos para negritas.');
  lines.push('- Usa emojis con moderación (máximo 2-3 por mensaje).');
  lines.push('- Sé breve y directo. Máximo 3-4 líneas por respuesta.');
  lines.push('- NUNCA uses "¡Hola!" ni te presentes si ya está avanzada la conversación.');
  lines.push('');

  // ── Reglas de conversación ──
  lines.push('REGLAS DE CONVERSACIÓN (obligatorias):');
  lines.push('- RECUERDA todo lo que el cliente ya dijo. NO repitas preguntas ya respondidas.');
  lines.push('- Si el cliente ya dijo su nombre, úsalo. No vuelvas a pedirlo.');
  lines.push('- Si el cliente ya eligió una plataforma, NO vuelvas a listar todas.');
  lines.push('- Saluda SOLO en tu PRIMER mensaje de la conversación (cuando el historial está vacío).');
  lines.push('- En mensajes siguientes, ve directo al punto sin re-presentarte.');
  lines.push('- Sigue el flujo natural: saludo → interés → plataforma → precio → datos → cierre.');
  lines.push('');

  // ── Personalidad ──
  if (config.personality) {
    lines.push(`Tu personalidad: ${config.personality}`);
    lines.push('');
  }

  // ── Info del negocio ──
  if (config.schedule) lines.push(`Horarios de atención: ${config.schedule}`);
  if (config.context) {
    lines.push('');
    lines.push('INFORMACIÓN DEL NEGOCIO:');
    lines.push(config.context);
    lines.push('');
  }

  // ── Inventario en tiempo real ──
  try {
    const accounts = await getAvailableAccounts();
    if (accounts && accounts.length > 0) {
      const available = accounts.filter(a => a.disponibles > 0);
      const unavailable = accounts.filter(a => a.disponibles === 0);

      lines.push('INVENTARIO ACTUAL (datos reales, actualizado automáticamente):');
      if (available.length > 0) {
        for (const a of available) {
          lines.push(`  ✅ ${a.plataforma}: ${a.disponibles} perfil(es) disponible(s)`);
        }
      }
      if (unavailable.length > 0) {
        for (const a of unavailable) {
          lines.push(`  ❌ ${a.plataforma}: AGOTADO`);
        }
      }
      lines.push('');
    }
  } catch (_) {}

  // ── Proceso de venta ──
  lines.push('PROCESO DE VENTA:');
  lines.push('1. Si el cliente saluda/pregunta → Presenta brevemente qué plataformas hay disponibles.');
  lines.push('2. Si pregunta precios → Da precios SOLO si están en "Información del negocio". Si no los tienes, di que un agente le confirma.');
  lines.push('3. Si elige una plataforma → Confirma precio y pregunta si quiere proceder.');
  lines.push('4. Si quiere comprar → Pide nombre completo y número de WhatsApp (si no lo tienes).');
  lines.push('5. Confirma los datos y dile que un agente le contactará para el pago y enviar accesos.');
  lines.push('');

  // ── Etiqueta de pedido confirmado (OCULTA al cliente) ──
  lines.push('REGISTRO DE PEDIDOS (MUY IMPORTANTE):');
  lines.push('Cuando el cliente CONFIRMA que quiere comprar y ya tienes: nombre, teléfono (o lo puedes inferir del chat) y plataforma elegida,');
  lines.push('debes agregar AL FINAL de tu respuesta (después de tu mensaje normal) esta etiqueta EXACTA:');
  lines.push('[PEDIDO_CONFIRMADO]{"plataforma":"NOMBRE_PLATAFORMA","nombre":"NOMBRE_CLIENTE","telefono":"NUMERO","cantidad":1}');
  lines.push('- Reemplaza los valores con los datos reales del cliente.');
  lines.push('- Si el cliente no dijo su teléfono, usa el número del chat (que ya conoces).');
  lines.push('- La etiqueta NO será visible para el cliente, el sistema la procesa internamente.');
  lines.push('- Solo incluye la etiqueta UNA vez, cuando se confirma la compra.');
  lines.push('- NO incluyas la etiqueta si el cliente solo pregunta o no ha confirmado.');
  lines.push('');

  // ── Restricciones ──
  lines.push('RESTRICCIONES (nunca romper):');
  lines.push('- NUNCA compartas contraseñas, correos de acceso, PINs ni credenciales.');
  lines.push('- NUNCA ofrezcas plataformas marcadas como AGOTADO.');
  lines.push('- No inventes precios ni información que no tengas.');
  lines.push('- No reveles que eres IA a menos que pregunten directamente.');

  if (config.fallbackMsg) {
    lines.push(`- Si no puedes ayudar, responde: "${config.fallbackMsg}"`);
  }

  return lines.join('\n');
}

// ── Baileys — Conexión a WhatsApp ───────────────────────────
let sock = null;

// Directorio de sesión (en Railway usar un volumen si se quiere persistencia)
const AUTH_DIR = process.env.AUTH_DIR || './auth_session';

async function startBot() {
  // No arrancar si faltan variables críticas
  if (missingEnv.length > 0) {
    botState.status = 'error';
    addLog(`❌ No se puede iniciar: faltan variables de entorno: ${missingEnv.join(', ')}`);
    return;
  }

  botState.status = 'reconnecting';
  botState.qr = null;
  botState.qrDataUrl = null;

  // Asegurar que el directorio de auth existe
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['Streamly Bot', 'Chrome', '10.0']
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      botState.status = 'qr';
      botState.qr = qr;
      try {
        botState.qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
      } catch (_) {}
      addLog('📱 QR generado — escanea desde el panel web o la terminal');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      botState.status = shouldReconnect ? 'reconnecting' : 'disconnected';
      botState.qr = null;
      botState.qrDataUrl = null;

      // Detectar loop de error 440 (sesión corrupta)
      if (reason === 440) {
        consecutive440++;
        addLog(`⚠️ Conexión cerrada (razón: 440, intento ${consecutive440}/${MAX_440_BEFORE_RESET})`);
        if (consecutive440 >= MAX_440_BEFORE_RESET) {
          addLog('🔄 Demasiados errores 440 — reseteando sesión automáticamente...');
          await clearAuthSession();
          consecutive440 = 0;
          setTimeout(startBot, 2000);
          return;
        }
      } else {
        consecutive440 = 0;
        addLog(`⚠️ Conexión cerrada (razón: ${reason}). ${shouldReconnect ? 'Reconectando...' : 'Deslogueado.'}`);
      }

      if (shouldReconnect) setTimeout(startBot, 3000);
    }

    if (connection === 'open') {
      consecutive440 = 0;
      botState.status = 'connected';
      botState.qr = null;
      botState.qrDataUrl = null;
      botState.startedAt = new Date().toISOString();
      try {
        botState.phone = sock.user?.id?.split(':')[0] || sock.user?.id || 'Vinculado';
      } catch (_) {
        botState.phone = 'Vinculado';
      }
      addLog(`✅ Bot conectado a WhatsApp (${botState.phone})`);

      // Al conectar, cargar config y cuentas si Firestore está disponible
      if (firestoreAvailable) {
        getConfig();
        getAvailableAccounts();
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ── Manejar mensajes entrantes ──────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;

      const sender = msg.key.remoteJid;
      const isGroup = sender.endsWith('@g.us');
      const senderShort = sender.split('@')[0];
      const pushName = msg.pushName || senderShort;

      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || '';

      if (!text.trim()) continue;

      // ── Registrar conversación ──
      const conv = getOrCreateConversation(sender, pushName);
      addMessage(conv, 'customer', text);
      conv.unread++;

      addLog(`📩 ${isGroup ? '[GRUPO] ' : ''}${pushName} (${senderShort}): ${text.substring(0, 80)}${text.length > 80 ? '...' : ''}`);

      // ── Verificar filtros ──
      if (isGroup && !botSettings.respondGroups) {
        addLog(`   ⏭️ Grupo ignorado`);
        continue;
      }
      if (!isGroup) {
        const isSaved = pushName && pushName !== senderShort && !/^\+?\d+$/.test(pushName);
        if (isSaved && !botSettings.respondSaved) {
          addLog(`   ⏭️ Contacto guardado ignorado`);
          continue;
        }
        if (!isSaved && !botSettings.respondUnsaved) {
          addLog(`   ⏭️ Contacto no guardado ignorado`);
          continue;
        }
      }

      // ── Verificar pausa ──
      if (conv.paused) {
        addLog(`   ⏸️ Chat pausado, no se responde`);
        continue;
      }

      // ── Verificar pausa global ──
      if (botGlobalPaused) {
        addLog('   ⏸️ Bot en pausa global, no se responde');
        continue;
      }

      // ── Verificar config global ──
      const config = await getConfig();
      if (config && config.enabled === false) {
        addLog('   ⏸️ Bot desactivado');
        continue;
      }

      // ── Responder con IA (con skills) ──
      try {
        await sock.readMessages([msg.key]);
        await sock.sendPresenceUpdate('composing', sender);

        // Primero verificar si una skill puede manejar el mensaje
        const skillResult = await skills.processMessage(text);
        let reply;

        if (skillResult && skillResult.handled) {
          reply = skillResult.response;
          const skillType = skillResult.optimizeResult ? 'optimización' : skillResult.fixResult ? 'corrección' : 'análisis';
          addLog(`   🔧 Skill activada: ${skillType} de código`);
        } else {
          reply = await askGemini(text, config, conv.messages);
        }

        // ── Detectar pedido confirmado (regex pre-compiladas) ──
        const orderMatch = reply.match(ORDER_TAG_RE);
        if (orderMatch) {
          try {
            const orderData = JSON.parse(orderMatch[1]);
            const now = Date.now();
            const order = {
              id: orderIdCounter++,
              plataforma: orderData.plataforma || 'Sin especificar',
              nombre: orderData.nombre || pushName || senderShort,
              telefono: orderData.telefono || senderShort,
              cantidad: orderData.cantidad || 1,
              estado: 'pendiente',
              jid: sender,
              timestamp: now,
              fechaHora: new Date(now).toISOString()
            };
            pendingOrders.push(order);
            // Limitar: mantener solo últimos 500 pedidos
            if (pendingOrders.length > 500) pendingOrders.splice(0, pendingOrders.length - 500);
            addLog(`🛒 NUEVO PEDIDO #${order.id}: ${order.nombre} — ${order.plataforma} (${order.cantidad})`);
          } catch (parseErr) {
            addLog(`⚠️ Error parseando pedido: ${parseErr.message}`);
          }
          reply = reply.replace(ORDER_TAG_CLEAN_RE, '').trim();
        }

        await new Promise(r => setTimeout(r, 800 + Math.random() * 1500));
        await sock.sendPresenceUpdate('paused', sender);
        await sock.sendMessage(sender, { text: reply });

        addMessage(conv, 'bot', reply);
        botState.messagesCount++;
        addLog(`   ✅ Respondido a ${pushName}`);
      } catch (err) {
        addLog(`   ❌ Error: ${err.message}`);
        const fallback = config?.fallbackMsg || 'Lo siento, hubo un error. Un agente te atenderá pronto.';
        try {
          await sock.sendMessage(sender, { text: fallback });
          addMessage(conv, 'bot', fallback);
        } catch (_) {}
      }
    }
  });
}

// ── Limpiar sesión de autenticación ─────────────────────────
async function clearAuthSession() {
  try {
    if (sock) {
      try { sock.end(); } catch (_) {}
      sock = null;
    }
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      addLog('🗑️ Sesión de autenticación eliminada');
    }
  } catch (err) {
    addLog(`❌ Error limpiando sesión: ${err.message}`);
  }
}

// ── HTTP API ────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));  // Limitar tamaño de payload

// Health check (Railway lo necesita)
app.get('/', (req, res) => {
  res.json({
    name: 'Streamly WhatsApp Bot',
    version: '3.0',
    status: botState.status,
    uptime: process.uptime(),
    phone: botState.phone,
    missingEnv: missingEnv.length > 0 ? missingEnv : undefined
  });
});

// Estado
app.get('/status', (req, res) => {
  res.json({
    status: botState.status,
    phone: botState.phone,
    messagesCount: botState.messagesCount,
    startedAt: botState.startedAt,
    hasQr: !!botState.qrDataUrl,
    logs: getOrderedLogs(30),
    totalConversations: conversations.size,
    firestoreConnected: firestoreAvailable,
    pendingOrdersCount: pendingOrders.reduce((n, o) => n + (o.estado === 'pendiente' ? 1 : 0), 0),
    globalPaused: botGlobalPaused,
    geminiModel: GEMINI_MODEL,
    geminiKeySet: !!GEMINI_API_KEY && GEMINI_API_KEY.length > 5,
    geminiKeyPrefix: GEMINI_API_KEY ? GEMINI_API_KEY.substring(0, 8) + '...' : 'NOT SET'
  });
});

// QR
app.get('/qr', (req, res) => {
  if (botState.qrDataUrl) {
    res.json({ qr: botState.qrDataUrl });
  } else {
    res.json({ qr: null, status: botState.status });
  }
});

// Desconectar
app.post('/disconnect', async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
      sock = null;
    }
    botState.status = 'disconnected';
    botState.qr = null;
    botState.qrDataUrl = null;
    botState.phone = null;
    addLog('🛑 Bot desconectado desde el panel');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Probar chat (con memoria de sesión de prueba)
const testConversation = { messages: [] };

app.post('/chat', async (req, res) => {
  try {
    const { message, config, resetHistory } = req.body;
    if (!message) return res.status(400).json({ error: 'Falta el mensaje' });

    // Resetear historial de pruebas si se pide
    if (resetHistory) testConversation.messages = [];

    // Agregar mensaje del usuario al historial de prueba
    testConversation.messages.push({ from: 'customer', text: message, timestamp: Date.now() });

    let reply = await askGemini(message, config || await getConfig() || {}, testConversation.messages);

    // Detectar pedido confirmado en chat de prueba también
    const orderMatch = reply.match(ORDER_TAG_RE);
    if (orderMatch) {
      try {
        const orderData = JSON.parse(orderMatch[1]);
        const now = Date.now();
        const order = {
          id: orderIdCounter++,
          plataforma: orderData.plataforma || 'Sin especificar',
          nombre: orderData.nombre || 'Cliente de prueba',
          telefono: orderData.telefono || 'Test',
          cantidad: orderData.cantidad || 1,
          estado: 'pendiente',
          jid: 'test@panel',
          timestamp: now,
          fechaHora: new Date(now).toISOString()
        };
        pendingOrders.push(order);
        addLog(`🛒 NUEVO PEDIDO #${order.id} (prueba): ${order.nombre} — ${order.plataforma}`);
      } catch (_) {}
      reply = reply.replace(ORDER_TAG_CLEAN_RE, '').trim();
    }

    // Agregar respuesta del bot al historial de prueba
    testConversation.messages.push({ from: 'bot', text: reply, timestamp: Date.now() });

    // Mantener solo últimos 30 mensajes
    if (testConversation.messages.length > 30) {
      testConversation.messages.splice(0, testConversation.messages.length - 30);
    }

    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sincronizar contexto desde el panel (fallback si no hay Firestore)
app.post('/sync-context', (req, res) => {
  try {
    const { config, accounts } = req.body;
    if (config) {
      botConfig = config;
      configLastFetch = Date.now();
      if (config.botSettings) {
        botSettings = { ...botSettings, ...config.botSettings };
      }
      addLog('📋 Config sincronizada desde panel');
    }
    if (accounts) {
      availableAccountsCache = accounts;
      accountsCacheTime = Date.now();
      addLog(`📦 Inventario sincronizado: ${accounts.length} plataformas`);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reconectar
app.post('/reconnect', async (req, res) => {
  try {
    if (sock) {
      try { sock.end(); } catch (_) {}
      sock = null;
    }
    addLog('🔄 Reconectando...');
    startBot();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resetear sesión (borrar auth y generar nuevo QR)
app.post('/reset-session', async (req, res) => {
  try {
    addLog('🔄 Reseteando sesión para generar nuevo QR...');
    await clearAuthSession();
    botState.status = 'disconnected';
    botState.qr = null;
    botState.qrDataUrl = null;
    botState.phone = null;
    consecutive440 = 0;
    setTimeout(() => startBot(), 1000);
    res.json({ ok: true, message: 'Sesión reseteada, generando nuevo QR...' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CONVERSACIONES ──────────────────────────────────────────

app.get('/conversations', (req, res) => {
  const list = [];
  for (const [jid, conv] of conversations) {
    const lastMsg = conv.messages.length > 0 ? conv.messages[conv.messages.length - 1] : null;
    list.push({
      jid: conv.jid,
      name: conv.name,
      phone: conv.phone,
      isGroup: conv.isGroup,
      paused: conv.paused,
      unread: conv.unread,
      lastTimestamp: conv.lastTimestamp,
      lastMessage: lastMsg ? lastMsg.text.substring(0, 100) : '',
      lastFrom: lastMsg ? lastMsg.from : '',
      messageCount: conv.messages.length
    });
  }
  list.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  res.json({ conversations: list });
});

app.get('/conversation/:jid', (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  const conv = conversations.get(jid);
  if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });
  conv.unread = 0;
  res.json({
    jid: conv.jid,
    name: conv.name,
    phone: conv.phone,
    isGroup: conv.isGroup,
    paused: conv.paused,
    messages: conv.messages
  });
});

app.post('/send', async (req, res) => {
  try {
    const { jid, message } = req.body;
    if (!jid || !message) return res.status(400).json({ error: 'Falta jid o message' });
    if (!sock || botState.status !== 'connected') {
      return res.status(400).json({ error: 'Bot no conectado' });
    }

    await sock.sendMessage(jid, { text: message });
    const conv = getOrCreateConversation(jid, null);
    addMessage(conv, 'agent', message);
    addLog(`📤 Mensaje manual enviado a ${conv.name || jid.split('@')[0]}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/pause/:jid', (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  const conv = conversations.get(jid);
  if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

  conv.paused = !conv.paused;
  addLog(`${conv.paused ? '⏸️' : '▶️'} ${conv.name} ${conv.paused ? 'pausada' : 'reanudada'}`);
  res.json({ ok: true, paused: conv.paused });
});

// ── AJUSTES ─────────────────────────────────────────────────

app.get('/settings', (req, res) => {
  res.json(botSettings);
});

app.post('/settings', async (req, res) => {
  try {
    const { respondGroups, respondSaved, respondUnsaved } = req.body;
    if (typeof respondGroups === 'boolean') botSettings.respondGroups = respondGroups;
    if (typeof respondSaved === 'boolean') botSettings.respondSaved = respondSaved;
    if (typeof respondUnsaved === 'boolean') botSettings.respondUnsaved = respondUnsaved;

    // Persistir en Firestore si disponible
    if (firestoreAvailable) {
      try {
        await db.collection('chatbot_config').doc(BOT_OWNER_UID).set(
          { botSettings },
          { merge: true }
        );
      } catch (_) {}
    }

    addLog(`⚙️ Filtros: Grupos=${botSettings.respondGroups}, Guardados=${botSettings.respondSaved}, No guardados=${botSettings.respondUnsaved}`);
    res.json({ ok: true, settings: botSettings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PEDIDOS PENDIENTES ──────────────────────────────────────
app.get('/orders', (req, res) => {
  res.json({ orders: pendingOrders });
});

app.post('/orders/:id/status', (req, res) => {
  const id = parseInt(req.params.id);
  const { estado } = req.body;
  const order = pendingOrders.find(o => o.id === id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  order.estado = estado || 'completado';
  addLog(`📋 Pedido #${id} actualizado → ${order.estado}`);
  res.json({ ok: true, order });
});

app.delete('/orders/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const idx = pendingOrders.findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Pedido no encontrado' });
  const removed = pendingOrders.splice(idx, 1)[0];
  addLog(`🗑️ Pedido #${id} eliminado (${removed.nombre} — ${removed.plataforma})`);
  res.json({ ok: true });
});

// ── SKILLS: Análisis y corrección de código ─────────────────

app.post('/analyze', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Falta el campo code' });

    const analysis = await skills.analyzer.fullAnalysis(code);
    res.json({ ok: true, analysis });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/fix', async (req, res) => {
  try {
    const { code, useAI } = req.body;
    if (!code) return res.status(400).json({ error: 'Falta el campo code' });

    const analysis = await skills.analyzer.fullAnalysis(code);
    const fixResult = await skills.fixer.autoFix(
      code, analysis.language, analysis.issues, useAI !== false
    );
    res.json({ ok: true, analysis, fix: fixResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/analyze-and-fix', async (req, res) => {
  try {
    const { code, useAI } = req.body;
    if (!code) return res.status(400).json({ error: 'Falta el campo code' });

    const analysis = await skills.analyzer.fullAnalysis(code);
    const fixResult = await skills.fixer.autoFix(
      code, analysis.language, analysis.issues, useAI !== false
    );
    res.json({
      ok: true,
      analysis,
      fix: fixResult,
      summary: analysis.summary + '\n\n' + skills.fixer.buildFixSummary(fixResult)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SKILLS: Optimización de código ──────────────────────────

app.post('/optimize', async (req, res) => {
  try {
    const { code, useAI } = req.body;
    if (!code) return res.status(400).json({ error: 'Falta el campo code' });

    const language = skills.analyzer.detectLanguage(code);
    const result = await skills.optimizer.fullOptimize(code, language, useAI !== false);
    const summary = skills.optimizer.buildOptimizeSummary(result);
    res.json({ ok: true, result, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/optimize/analysis', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Falta el campo code' });

    const language = skills.analyzer.detectLanguage(code);
    const analysis = skills.optimizer.analyzeOptimization(code, language);
    res.json({ ok: true, language, analysis });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/full-review', async (req, res) => {
  try {
    const { code, useAI } = req.body;
    if (!code) return res.status(400).json({ error: 'Falta el campo code' });

    const language = skills.analyzer.detectLanguage(code);

    // 1. Análisis de errores
    const analysis = await skills.analyzer.fullAnalysis(code);

    // 2. Corrección de errores
    const fixResult = await skills.fixer.autoFix(code, language, analysis.issues, useAI !== false);
    const codeAfterFix = fixResult.changed ? fixResult.fixed : code;

    // 3. Optimización sobre el código corregido
    const optResult = await skills.optimizer.fullOptimize(codeAfterFix, language, useAI !== false);

    res.json({
      ok: true,
      language,
      analysis,
      fix: fixResult,
      optimization: optResult,
      finalCode: optResult.changed ? optResult.optimized : codeAfterFix,
      summary: [
        analysis.summary,
        skills.fixer.buildFixSummary(fixResult),
        skills.optimizer.buildOptimizeSummary(optResult)
      ].join('\n\n')
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PAUSA GLOBAL ────────────────────────────────────────────
app.post('/global-pause', (req, res) => {
  botGlobalPaused = !botGlobalPaused;
  addLog(`${botGlobalPaused ? '⏸️' : '▶️'} Bot ${botGlobalPaused ? 'pausado globalmente' : 'reanudado'}`);
  res.json({ ok: true, paused: botGlobalPaused });
});

app.get('/global-pause', (req, res) => {
  res.json({ paused: botGlobalPaused });
});

// ── GRUPOS DE WHATSAPP ──────────────────────────────────────
app.get('/groups', async (req, res) => {
  try {
    if (!sock || botState.status !== 'connected') {
      return res.status(400).json({ error: 'Bot no conectado' });
    }
    const groups = await sock.groupFetchAllParticipating();
    const list = Object.values(groups).map(g => ({
      jid: g.id,
      name: g.subject || g.id.split('@')[0],
      participants: g.participants?.length || 0,
      creation: g.creation,
      desc: g.desc || ''
    }));
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    res.json({ groups: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MENSAJES PROGRAMADOS ────────────────────────────────────
app.get('/scheduled', (req, res) => {
  res.json({ messages: scheduledMessages });
});

app.post('/scheduled', (req, res) => {
  try {
    const { jid, groupName, message, scheduledTime, recurring, intervalMinutes } = req.body;
    if (!jid || !message) return res.status(400).json({ error: 'Faltan jid o message' });

    const nextRun = scheduledTime ? new Date(scheduledTime).getTime() : Date.now() + 60000;
    const intervalMs = recurring && intervalMinutes ? intervalMinutes * 60 * 1000 : 0;

    const sm = {
      id: scheduledIdCounter++,
      jid,
      groupName: groupName || jid.split('@')[0],
      message,
      recurring: !!recurring,
      intervalMinutes: intervalMinutes || 0,
      intervalMs,
      nextRun,
      active: true,
      createdAt: Date.now(),
      lastSent: null,
      sendCount: 0
    };
    scheduledMessages.push(sm);
    addLog(`📅 Mensaje programado #${sm.id} creado para ${sm.groupName}${sm.recurring ? ` (cada ${intervalMinutes} min)` : ' (una vez)'}`);
    res.json({ ok: true, scheduled: sm });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/scheduled/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const idx = scheduledMessages.findIndex(sm => sm.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Mensaje programado no encontrado' });
  const removed = scheduledMessages.splice(idx, 1)[0];
  addLog(`🗑️ Mensaje programado #${id} eliminado (${removed.groupName})`);
  res.json({ ok: true });
});

app.post('/scheduled/:id/toggle', (req, res) => {
  const id = parseInt(req.params.id);
  const sm = scheduledMessages.find(s => s.id === id);
  if (!sm) return res.status(404).json({ error: 'No encontrado' });
  sm.active = !sm.active;
  if (sm.active && sm.recurring && sm.intervalMs > 0) {
    sm.nextRun = Date.now() + sm.intervalMs;
  }
  addLog(`${sm.active ? '▶️' : '⏸️'} Programado #${id} ${sm.active ? 'activado' : 'pausado'}`);
  res.json({ ok: true, scheduled: sm });
});

// ── INVENTARIO ──────────────────────────────────────────────
app.get('/available-accounts', async (req, res) => {
  try {
    const accounts = await getAvailableAccounts();
    res.json({ accounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Inicio ──────────────────────────────────────────────────
const ENV = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'local';

console.log('');
console.log('═══════════════════════════════════════════');
console.log('  🤖 Streamly WhatsApp Bot v3.0');
console.log(`  🌍 Entorno: ${ENV}`);
console.log(`  🌐 Puerto: ${HTTP_PORT}`);
console.log(`  🔥 Firestore: ${process.env.FIREBASE_SERVICE_ACCOUNT ? 'con credenciales' : 'pendiente'}`);
console.log('═══════════════════════════════════════════');
console.log('');

// Iniciar HTTP primero (Railway healthcheck necesita respuesta rápida)
const server = app.listen(HTTP_PORT, '0.0.0.0', () => {
  addLog(`🌐 Servidor HTTP en puerto ${HTTP_PORT} (${ENV})`);
  // Iniciar bot DESPUÉS de que el servidor esté listo
  startBot().catch(err => {
    addLog(`❌ Error iniciando bot: ${err.message}`);
    console.error('❌ Error en startBot:', err);
    // No salir — el servidor HTTP sigue vivo para healthcheck y reconfig
  });
});
