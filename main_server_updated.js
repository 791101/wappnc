const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const path = require('path');
require('dotenv').config();

const logger = require('./logger_config');
const db = require('./database_config');

// Importar rutas
const authRoutes = require('./src/routes/auth');
const usuariosRoutes = require('./src/routes/usuarios');
const equiposRoutes = require('./src/routes/equipos');
const contactosRoutes = require('./src/routes/contactos');
const conversacionesRoutes = require('./src/routes/conversaciones');
const mensajesRoutes = require('./src/routes/mensajes');
const whatsappRoutes = require('./src/routes/whatsapp');
const archivosRoutes = require('./src/routes/archivos');
const reportesRoutes = require('./src/routes/reportes');
const configuracionesRoutes = require('./src/routes/configuraciones');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de seguridad
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            connectSrc: ["'self'"]
        }
    }
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // máximo 100 requests por ventana
    message: {
        error: 'Demasiadas solicitudes desde esta IP, intente nuevamente en 15 minutos.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/', limiter);

// Middleware general
app.use(compression());
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware de logging
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        body: req.method !== 'GET' ? req.body : undefined
    });
    next();
});

// Servir archivos estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));
app.use('/', express.static(path.join(__dirname, 'public')));

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/equipos', equiposRoutes);
app.use('/api/contactos', contactosRoutes);
app.use('/api/conversaciones', conversacionesRoutes);
app.use('/api/mensajes', mensajesRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/archivos', archivosRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/configuraciones', configuracionesRoutes);

// Ruta de salud
app.get('/api/health', async (req, res) => {
    try {
        const dbConnected = await db.testConnection();
        const stats = await db.getStats();

        res.json({
            status: 'OK',
            timestamp: new Date().toISOString(),
            database: dbConnected ? 'Connected' : 'Disconnected',
            stats: stats || {},
            version: process.env.npm_package_version || '1.0.0',
            environment: process.env.NODE_ENV || 'development'
        });
    } catch (error) {
        logger.error('Error en health check:', error);
        res.status(500).json({
            status: 'ERROR',
            message: 'Error interno del servidor'
        });
    }
});

// Ruta para webhook de WhatsApp
app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            logger.info('Webhook de WhatsApp verificado exitosamente');
            res.status(200).send(challenge);
        } else {
            logger.warn('Token de verificación incorrecto');
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

// Ruta principal
app.get('/', (req, res) => {
    res.json({
        message: 'API WhatsApp Notaría Correa',
        version: '1.0.0',
        status: 'Active',
        endpoints: {
            health: '/api/health',
            auth: '/api/auth',
            usuarios: '/api/usuarios',
            equipos: '/api/equipos',
            contactos: '/api/contactos',
            conversaciones: '/api/conversaciones',
            mensajes: '/api/mensajes',
            whatsapp: '/api/whatsapp',
            archivos: '/api/archivos',
            reportes: '/api/reportes',
            configuraciones: '/api/configuraciones'
        }
    });
});

// Middleware de manejo de errores
app.use((err, req, res, next) => {
    logger.error('Error no manejado:', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip
    });

    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({
            error: 'JSON inválido en el cuerpo de la solicitud'
        });
    }

    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production' 
            ? 'Error interno del servidor' 
            : err.message
    });
});

// Ruta 404
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Ruta no encontrada',
        path: req.originalUrl
    });
});

// Iniciar servidor
const startServer = async () => {
    try {
        // Verificar conexión a base de datos
        const dbConnected = await db.testConnection();
        if (!dbConnected) {
            throw new Error('No se pudo conectar a la base de datos');
        }

        app.listen(PORT, () => {
            logger.info(`Servidor iniciado en puerto ${PORT}`, {
                environment: process.env.NODE_ENV,
                database: process.env.DB_NAME,
                host: process.env.DB_HOST
            });
        });
    } catch (error) {
        logger.error('Error al iniciar servidor:', error);
        process.exit(1);
    }
};

// Manejo de señales del sistema
process.on('SIGTERM', () => {
    logger.info('Recibida señal SIGTERM, cerrando servidor...');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('Recibida señal SIGINT, cerrando servidor...');
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Promesa rechazada no manejada:', { reason, promise });
});

process.on('uncaughtException', (error) => {
    logger.error('Excepción no capturada:', error);
    process.exit(1);
});

// Iniciar servidor
startServer();

module.exports = app;
