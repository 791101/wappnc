#!/bin/bash
# =================================================================
# INSTALACIÓN COMPLETA DEL BACKEND - NOTARÍA CORREA
# Servidor Backend: 167.234.215.27 (10.0.0.70)
# =================================================================

echo "🚀 INICIANDO INSTALACIÓN DEL BACKEND NOTARÍA CORREA..."

# 1. ACTUALIZAR SISTEMA
echo "📦 Actualizando sistema Ubuntu..."
sudo apt update && sudo apt upgrade -y

# 2. INSTALAR NODE.JS 18 LTS
#echo "📦 Instalando Node.js 18 LTS..."
#curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
#sudo apt-get install -y nodejs

# Verificar instalación
#echo "✅ Node.js versión: $(node --version)"
#echo "✅ NPM versión: $(npm --version)"

# 3. INSTALAR PM2 GLOBALMENTE
echo "📦 Instalando PM2..."
sudo npm install -g pm2

# 4. CREAR DIRECTORIO DEL PROYECTO
echo "📁 Creando directorio del proyecto..."
sudo mkdir -p /opt/notaria-whatsapp-backend
sudo chown $USER:$USER /opt/notaria-whatsapp-backend
cd /opt/notaria-whatsapp-backend

# 5. CREAR ESTRUCTURA DE CARPETAS
echo "📁 Creando estructura de carpetas..."
mkdir -p {src,config,public,logs,uploads,backups,scripts,docs,tests}
mkdir -p src/{controllers,middleware,models,routes,services,utils,validators}
mkdir -p public/{css,js,images,uploads}
mkdir -p config/{database,whatsapp,onedrive,ssl}
mkdir -p logs/{app,error,access,whatsapp}
mkdir -p uploads/{temp,processed,onedrive-sync}
mkdir -p scripts/{backup,maintenance,deployment}
mkdir -p docs/{api,setup,user-guide}
mkdir -p tests/{unit,integration,e2e}

# 6. CREAR ARCHIVOS .gitkeep PARA CARPETAS VACÍAS
echo "📄 Creando archivos .gitkeep..."
touch logs/app/.gitkeep
touch logs/error/.gitkeep
touch logs/access/.gitkeep
touch logs/whatsapp/.gitkeep
touch uploads/temp/.gitkeep
touch uploads/processed/.gitkeep
touch backups/.gitkeep

# 7. CONFIGURAR PERMISOS
echo "🔒 Configurando permisos..."
chmod 755 /opt/notaria-whatsapp-backend
chmod -R 755 logs/
chmod -R 755 uploads/
chmod -R 755 backups/

echo "✅ ESTRUCTURA BASE CREADA"
echo "📍 Ubicación: /opt/notaria-whatsapp-backend"
echo ""
echo "🎯 PRÓXIMOS PASOS:"
echo "1. Copiar archivos del proyecto (package.json, server.js, etc.)"
echo "2. Ejecutar: npm install"
echo "3. Configurar archivo .env"
echo "4. Iniciar aplicación: npm run pm2:start"
echo ""
echo "📋 ESTRUCTURA CREADA:"
tree -L 2 /opt/notaria-whatsapp-backend || ls -la /opt/notaria-whatsapp-backend
