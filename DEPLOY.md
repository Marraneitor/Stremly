# 🚀 Streamly — Guía de Despliegue

Streamly usa **3 servicios** para funcionar en producción:

| Servicio | Qué aloja | URL resultante |
|----------|-----------|----------------|
| **Firebase** | Base de datos (Firestore) + Autenticación | — (backend) |
| **Vercel** | Frontend (HTML/CSS/JS) + API serverless | `https://streamly.vercel.app` |
| **Railway** | Bot de WhatsApp (Node.js 24/7) | `https://tu-bot.up.railway.app` |

---

## 1️⃣ Firebase — Base de datos y autenticación

### 1.1 Crear proyecto

1. Ve a [Firebase Console](https://console.firebase.google.com)
2. **Agregar proyecto** → nombre: `streamly` (o el que prefieras)
3. Desactiva Google Analytics si no lo necesitas → **Crear proyecto**

### 1.2 Activar Authentication

1. En el panel izquierdo: **Authentication** → **Comenzar**
2. Pestaña **Método de inicio de sesión**:
   - Activa **Correo electrónico/contraseña**
   - Activa **Google** (opcional, para inicio rápido)
3. Ve a **Users** → **Agregar usuario** → crea tu cuenta de admin
4. **Copia tu UID** (lo necesitarás para Railway como `BOT_OWNER_UID`)

### 1.3 Activar Firestore

1. En el panel izquierdo: **Firestore Database** → **Crear base de datos**
2. Elige la ubicación más cercana a tus usuarios
3. Inicia en **modo de producción** (usaremos reglas personalizadas)

### 1.4 Desplegar reglas de seguridad

Las reglas ya están configuradas en `firestore.rules`. Para desplegarlas:

```bash
# Instalar Firebase CLI (si no lo tienes)
npm install -g firebase-tools

# Iniciar sesión
firebase login

# Desplegar solo las reglas (desde la raíz del proyecto)
firebase deploy --only firestore:rules
```

> **Alternativa rápida:** Copia el contenido de `firestore.rules` directamente en Firebase Console → Firestore → Reglas → Publicar.

### 1.5 Registrar app web

1. En **Project Settings** (⚙️) → **General** → desplaza hasta **Tus apps**
2. Haz clic en **</>** (Web) → nombre: `Streamly Web` → **Registrar app**
3. Copia estos valores (los necesitarás en Vercel):
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `storageBucket`
   - `messagingSenderId`
   - `appId`
   - `measurementId`

### 1.6 Generar Service Account (para Railway)

1. **Project Settings** → **Service Accounts**
2. Clic en **"Generar nueva clave privada"**
3. Se descargará un archivo JSON — **guárdalo en un lugar seguro**
4. Copia TODO el contenido del JSON (lo usarás en Railway como `FIREBASE_SERVICE_ACCOUNT`)

---

## 2️⃣ Vercel — Frontend + API

### 2.1 Conectar repositorio

1. Sube tu código a **GitHub** (asegúrate de que `.gitignore` está OK)
2. Ve a [vercel.com](https://vercel.com) → **New Project**
3. Importa tu repositorio de GitHub
4. Framework Preset: **Other** (es un sitio estático)
5. Root Directory: `.` (raíz)
6. **No cambies** Build Command ni Output Directory — Vercel usa `vercel.json`

### 2.2 Configurar variables de entorno

En Vercel → tu proyecto → **Settings** → **Environment Variables**, agrega:

| Variable | Valor | Dónde obtenerla |
|----------|-------|-----------------|
| `FIREBASE_API_KEY` | `AIzaSy...` | Firebase Console → Project Settings → Your apps |
| `FIREBASE_AUTH_DOMAIN` | `tu-proyecto.firebaseapp.com` | Mismo lugar |
| `FIREBASE_PROJECT_ID` | `tu-proyecto-id` | Mismo lugar |
| `FIREBASE_STORAGE_BUCKET` | `tu-proyecto.appspot.com` | Mismo lugar |
| `FIREBASE_MESSAGING_SENDER_ID` | `123456789` | Mismo lugar |
| `FIREBASE_APP_ID` | `1:123...:web:abc...` | Mismo lugar |
| `FIREBASE_MEASUREMENT_ID` | `G-XXXXXXXXXX` | Mismo lugar |
| `GEMINI_API_KEY` | `tu_api_key` | [AI Studio](https://aistudio.google.com/apikey) |
| `ALLOWED_ORIGIN` | `https://streamly.vercel.app` | Tu dominio en Vercel |
| `STRIPE_SECRET_KEY` | `sk_live_...` o `sk_test_...` | Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Stripe Dashboard → Developers → Webhooks |
| `FIREBASE_SERVICE_ACCOUNT` | `{...}` (JSON en una sola línea) | Firebase Console → Project Settings → Service Accounts |

> 🔐 **Seguridad (importante):**
> - **Nunca** pegues claves (`sk_*`, `pk_*`, `whsec_*`) en el código ni las subas a GitHub.
> - Si ya compartiste una clave por chat o la subiste sin querer, **rotála** en Stripe inmediatamente.
> - La clave **publicable** (`pk_*`) no es tan crítica como la secreta, pero igual evita hardcodearla.

> ℹ️ En este proyecto, para Stripe Checkout **solo necesitas** `STRIPE_SECRET_KEY` en el backend.
> La `pk_*` se usaría únicamente si integras Stripe.js (tarjeta embebida), no para redirección a Checkout.

> ⚠️ Después de agregar las variables, ve a **Deployments** → haz clic en **⋮** del último deploy → **Redeploy** para que tome efecto.

### 2.3 Verificar despliegue

- `https://tu-dominio.vercel.app` → Debe mostrar la página de login
- `https://tu-dominio.vercel.app/admin` → Panel de administración
- `https://tu-dominio.vercel.app/api/firebase-config` → Debe devolver JSON con la config
- `https://tu-dominio.vercel.app/api/chatbot` → Debe devolver error 405 (solo acepta POST)
- `https://tu-dominio.vercel.app/api/create-checkout-session` → Debe devolver 405 (solo acepta POST)

### 2.4 Configurar Webhook de Stripe (para activar plan automático)

1. Ve a Stripe Dashboard → **Developers** → **Webhooks** → **Add endpoint**
2. Endpoint URL:
   - `https://tu-dominio.vercel.app/api/stripe-webhook`
3. Events:
   - Selecciona **`checkout.session.completed`**
4. Copia el **Signing secret** (`whsec_...`) y guárdalo en Vercel como `STRIPE_WEBHOOK_SECRET`

> ⚠️ El webhook necesita `FIREBASE_SERVICE_ACCOUNT` en Vercel para poder activar el plan en Firestore.

---

## 3️⃣ Railway — Bot de WhatsApp

### 3.1 Crear servicio

1. Ve a [railway.app](https://railway.app) → **New Project**
2. **Deploy from GitHub repo** → selecciona tu repositorio
3. Railway detectará el repositorio. Ve a **Settings**:
   - **Root Directory**: `bot` (MUY IMPORTANTE — el bot está en la subcarpeta)
   - **Start Command**: `node index.js` (ya está en `railway.json`)
   - **Build Command**: `npm install` (automático)

### 3.2 Configurar variables de entorno

En Railway → tu servicio → **Variables**, agrega:

| Variable | Valor | Dónde obtenerla |
|----------|-------|-----------------|
| `GEMINI_API_KEY` | `tu_api_key` | [AI Studio](https://aistudio.google.com/apikey) |
| `FIREBASE_PROJECT_ID` | `tu-proyecto-id` | Firebase Console → Project Settings |
| `BOT_OWNER_UID` | `abc123...` | Firebase Console → Authentication → Users → tu UID |
| `FIREBASE_SERVICE_ACCOUNT` | `{"type":"service_account",...}` | El JSON completo del paso 1.6 |

> **`PORT`**: Railway lo asigna automáticamente — **no lo agregues**.

### 3.3 Generar dominio público

1. En Railway → tu servicio → **Settings** → **Networking**
2. Clic en **"Generate Domain"**
3. Obtendrás algo como: `https://streamly-bot-production.up.railway.app`
4. **Copia esta URL** — la necesitarás en el paso 4

### 3.4 Verificar despliegue

- Abre `https://tu-bot.up.railway.app/` → Debe responder `{"status":"..."}`
- Revisa los logs en Railway para confirmar que arrancó correctamente

---

## 4️⃣ Conectar todo — Post-Despliegue

### 4.1 Vincular el bot al panel web

1. Inicia sesión en `https://tu-dominio.vercel.app`
2. Ve a la sección **Bot de WhatsApp**
3. Abre **Ajustes avanzados**
4. Pega la URL de Railway: `https://tu-bot.up.railway.app`
5. Haz clic en **Conectar**

### 4.2 Escanear QR de WhatsApp

1. Una vez conectado al servidor del bot, aparecerá un **código QR**
2. En tu teléfono: **WhatsApp** → **Dispositivos vinculados** → **Vincular un dispositivo**
3. Escanea el QR
4. El bot estará activo y responderá mensajes automáticamente

### 4.3 Configurar el chatbot

1. En el panel web, ve a **Chatbot** (sección de configuración)
2. Configura:
   - **Nombre del negocio**
   - **Horarios de atención**
   - **Personalidad del bot**
   - **Contexto** (productos, precios, etc.)
   - **Mensaje de fallback**
3. Guarda la configuración — se sincroniza automáticamente con el bot

---

## 🔧 Desarrollo Local

### Frontend (Vercel dev)
```bash
# Desde la raíz del proyecto
npx serve . -l 8080
```
O usa la CLI de Vercel:
```bash
npm i -g vercel
vercel dev
```

### Bot (Railway local)
```bash
cd bot
cp .env.example .env
# Rellena .env con tus valores
npm install
node index.js
```

---

## 📋 Checklist Final

- [ ] Firebase: Authentication activado con correo y/o Google
- [ ] Firebase: Firestore creado con reglas de seguridad desplegadas
- [ ] Firebase: Service Account generado (JSON para Railway)
- [ ] Vercel: Repositorio conectado y desplegado
- [ ] Vercel: Todas las variables de entorno configuradas
- [ ] Vercel: `/api/firebase-config` devuelve JSON válido
- [ ] Railway: Servicio creado con Root Directory = `bot`
- [ ] Railway: Todas las variables de entorno configuradas
- [ ] Railway: Dominio público generado
- [ ] Panel web: URL de Railway configurada en ajustes avanzados
- [ ] WhatsApp: QR escaneado y bot respondiendo

---

## ❓ Solución de Problemas

### El frontend no carga / error de Firebase
- Verifica que todas las variables `FIREBASE_*` estén en Vercel
- Haz **Redeploy** después de agregar variables
- Revisa la consola del navegador (F12) para errores

### El bot no conecta desde el panel
- Verifica que la URL del bot sea correcta (HTTPS, sin `/` al final)
- Revisa que Railway tenga un dominio público generado
- Revisa los logs de Railway para errores de arranque

### Error "Firebase: sin credenciales"
- Asegúrate de que `FIREBASE_SERVICE_ACCOUNT` tenga el JSON completo
- El JSON debe estar en **una sola línea** sin saltos de línea
- Verifica que no tenga comillas extra alrededor

### El QR no aparece
- Borra la carpeta `auth_session/` en Railway (si migras de local)
- En los logs de Railway busca errores de Baileys
- Reconecta desde el panel

### Error CORS en el chatbot del panel
- Verifica `ALLOWED_ORIGIN` en Vercel
- El valor debe ser tu dominio exacto: `https://streamly.vercel.app`
