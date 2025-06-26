
#!/bin/bash
# =================================================================
# ESTRUCTURA DEL BACKEND - NOTARÍA CORREA WHATSAPP
# Servidor Backend: 167.234.215.27 (10.0.0.70)
# Servidor DB: 64.181.231.37 (10.0.0.64)
# =================================================================

echo "🚀 CREANDO ESTRUCTURA DEL BACKEND NOTARÍA CORREA..."

# Crear directorio principal del proyecto
mkdir -p /opt/notaria-whatsapp-backend
cd /opt/notaria-whatsapp-backend

# Estructura de carpetas principal
mkdir -p {src,config,public,logs,uploads,backups,scripts,docs,tests}

# Estructura del código fuente
mkdir -p src/{controllers,middleware,models,routes,services,utils,validators}

# Estructura de archivos públicos
mkdir -p public/{css,js,images,uploads}

# Estructura de configuración
mkdir -p config/{database,whatsapp,onedrive,ssl}

# Estructura de logs
mkdir -p logs/{app,error,access,whatsapp}

# Estructura de uploads temporales
mkdir -p uploads/{temp,processed,onedrive-sync}

# Estructura de scripts de mantenimiento
mkdir -p scripts/{backup,maintenance,deployment}

# Estructura de documentación
mkdir -p docs/{api,setup,user-guide}

# Estructura de tests
mkdir -p tests/{unit,integration,e2e}

echo "✅ Estructura de carpetas creada"

# Crear archivos principales
touch src/app.js
touch src/server.js
touch package.json
touch .env
touch .env.example
touch .gitignore
touch README.md
touch docker-compose.yml
touch Dockerfile

# Crear archivos de configuración
touch config/database.js
touch config/whatsapp.js
touch config/onedrive.js
touch config/logger.js

# Crear controladores principales
touch src/controllers/authController.js
touch src/controllers/conversationController.js
touch src/controllers/messageController.js
touch src/controllers/contactController.js
touch src/controllers/fileController.js
touch src/controllers/dashboardController.js
touch src/controllers/userController.js
touch src/controllers/teamController.js

# Crear middleware
touch src/middleware/auth.js
touch src/middleware/validation.js
touch src/middleware/rateLimiter.js
touch src/middleware/errorHandler.js
touch src/middleware/logger.js
touch src/middleware/cors.js

# Crear modelos
touch src/models/User.js
touch src/models/Team.js
touch src/models/Contact.js
touch src/models/Conversation.js
touch src/models/Message.js
touch src/models/File.js
touch src/models/Tag.js
touch src/models/Subject.js

# Crear rutas
touch src/routes/auth.js
touch src/routes/conversations.js
touch src/routes/messages.js
touch src/routes/contacts.js
touch src/routes/files.js
touch src/routes/dashboard.js
touch src/routes/users.js
touch src/routes/teams.js
touch src/routes/webhook.js

# Crear servicios
touch src/services/whatsappService.js
touch src/services/onedriveService.js
touch src/services/notificationService.js
touch src/services/emailService.js
touch src/services/fileService.js
touch src/services/metricsService.js
touch src/services/backupService.js

# Crear utilidades
touch src/utils/database.js
touch src/utils/logger.js
touch src/utils/helpers.js
touch src/utils/constants.js
touch src/utils/encryption.js
touch src/utils/validation.js

# Crear validadores
touch src/validators/authValidator.js
touch src/validators/conversationValidator.js
touch src/validators/messageValidator.js
touch src/validators/contactValidator.js

# Crear scripts de mantenimiento
touch scripts/backup/backup-database.sh
touch scripts/backup/backup-files.sh
touch scripts/maintenance/cleanup-logs.sh
touch scripts/maintenance/optimize-database.sh
touch scripts/deployment/deploy.sh
touch scripts/deployment/rollback.sh

echo "✅ Archivos base creados"

# Mostrar estructura creada
echo ""
echo "📁 ESTRUCTURA DEL PROYECTO:"
tree -L 3 /opt/notaria-whatsapp-backend || find /opt/notaria-whatsapp-backend -type d | head -20

echo ""
echo "🎯 ESTRUCTURA CREADA EXITOSAMENTE"
echo "📍 Ubicación: /opt/notaria-whatsapp-backend"
echo "🔗 Conexión DB: 10.0.0.64:3306"
echo "🌐 Servidor Backend: 10.0.0.70"
