# Streamly WhatsApp Bot — Railway Deployment

Bot autónomo de ventas por WhatsApp con Baileys + Gemini AI.

## Desplegar en Railway

### 1. Crear repositorio en GitHub

Sube la carpeta `bot/` como un repositorio en GitHub (o sube toda la carpeta `streamly` y configura Railway para usar el subdirectorio `bot/`).

```bash
cd bot
git init
git add .
git commit -m "Streamly Bot v3.0"
git remote add origin https://github.com/TU_USUARIO/streamly-bot.git
git push -u origin main
```

### 2. Crear proyecto en Railway

1. Ve a [railway.app](https://railway.app) e inicia sesión
2. Click en **"New Project"** → **"Deploy from GitHub repo"**
3. Selecciona tu repositorio `streamly-bot`
4. Railway detectará automáticamente que es un proyecto Node.js

### 3. Configurar Variables de Entorno

En el panel de Railway, ve a tu servicio → **Variables** y agrega:

| Variable | Valor | Obligatoria |
|---|---|---|
| `GEMINI_API_KEY` | `AIzaSyAWCsY1tlp8A87DtvlU1TShhrubz1i9WNA` | ✅ |
| `FIREBASE_PROJECT_ID` | `accf-8b065` | ✅ |
| `BOT_OWNER_UID` | `taEa1w2QbxVPe58VfM8ObDDfOoB2` | ✅ |
| `FIREBASE_SERVICE_ACCOUNT` | *(JSON completo de la cuenta de servicio)* | ⭐ Recomendada |

> **NOTA:** `PORT` la asigna Railway automáticamente. No la configures manualmente.

### 4. Obtener la Service Account de Firebase (recomendado)

Para que el bot funcione **de forma 100% autónoma** (sin necesidad de tener el panel abierto):

1. Ve a la [Firebase Console](https://console.firebase.google.com)
2. Selecciona tu proyecto → ⚙️ → **Configuración del proyecto** → **Cuentas de servicio**
3. Click en **"Generar nueva clave privada"**
4. Se descargará un archivo JSON
5. Copia TODO el contenido de ese JSON
6. En Railway → Variables → `FIREBASE_SERVICE_ACCOUNT` → pega el JSON completo

Con esto el bot puede leer la config del chatbot y el inventario de cuentas directamente de Firestore, sin depender del panel web.

### 5. Generar dominio público

En Railway → tu servicio → **Settings** → **Networking** → **Generate Domain**

Obtendrás una URL como: `https://streamly-bot-production.up.railway.app`

### 6. Conectar el panel web

1. Abre tu panel de Streamly (index.html)
2. En la sección **Chatbot** → **Conexión WhatsApp**
3. Pega la URL de Railway en el campo de URL del servidor
4. Click en **"Conectar"**
5. Escanea el código QR con WhatsApp
6. ¡Listo! El bot está activo 24/7

## Notas importantes

### Sesión de WhatsApp
- La primera vez deberás escanear el QR
- Railway usa filesystem efímero: si el servicio se reinicia (redeploy), puede que necesites re-escanear
- Para persistencia permanente: Railway → tu servicio → **Volumes** → agrega un volumen montado en `/app/auth_session`

### Volumen persistente (opcional pero recomendado)
1. En Railway → tu servicio → **Volumes**
2. Click en **"New Volume"**
3. Mount path: `/app/auth_session`
4. Esto guarda la sesión de WhatsApp entre deploys

### Sin Service Account
Si no configuras `FIREBASE_SERVICE_ACCOUNT`, el bot funciona en modo "sync":
- Necesitas abrir el panel web y conectarte para que envíe la config al bot
- El bot no puede leer Firestore por sí solo
- Sigue funcionando, pero NO es 100% autónomo

## Estructura del proyecto

```
bot/
├── index.js          # Código principal del bot
├── package.json      # Dependencias
├── railway.json      # Config de Railway
├── .gitignore        # Archivos excluidos
└── .env              # Variables locales (no subir a git)
```

## Endpoints HTTP

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/` | Health check |
| GET | `/status` | Estado del bot |
| GET | `/qr` | Código QR en data URL |
| POST | `/chat` | Probar chat con IA |
| POST | `/disconnect` | Desconectar WhatsApp |
| POST | `/reconnect` | Reconectar WhatsApp |
| POST | `/sync-context` | Sincronizar config desde panel |
| GET | `/conversations` | Lista de conversaciones |
| GET | `/conversation/:jid` | Mensajes de una conversación |
| POST | `/send` | Enviar mensaje manual |
| POST | `/pause/:jid` | Pausar/reanudar conversación |
| GET/POST | `/settings` | Filtros del bot |
| GET | `/available-accounts` | Inventario disponible |
