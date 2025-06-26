const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const logger = require('./utils/logger');
const database = require('./utils/database');
const errorHandler = require('./middleware/errorHandler');

// Importar rutas
const authRoutes = require('./routes/auth');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
const contactRoutes = require('./routes/contacts');
const fileRoutes = require('./routes/files');
const dashboardRoutes = require('./routes/dashboard');
const webhookRoutes = require('./routes/webhook');
const userRoutes = require('./routes/users');
const teamRoutes = require('./routes/teams');

class NotariaWhatsAppServer {
    constructor() {
        this.app = express();
        this.server = createServer(this.app);
        this.io = new Server(this.server, {
            cors: {
                origin: process.env.CORS_ORIGIN?.split(',') || ["http://localhost:3001"],
                credentials: true
            }
        });
        this.port = process.env.PORT || 3000;
        this.host = process.env.HOST || '0.0.0.0';

        this.initializeMiddleware();
        this.initializeRoutes();
        this.initializeErrorHandling();
        this.initializeSocketIO();
    }

    initializeMiddleware() {
        // Seguridad básica
        this.app.use(helmet({
            contentSecurityPolicy: false,
            crossOriginEmbedderPolicy: false
        }));

        // CORS
        this.app.use(cors({
            origin: process.env.CORS_ORIGIN?.split(',') || ["http://localhost:3001"],
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
        }));

        // Compresión
        this.app.use(compression());

        // Logging
        this.app.use(morgan('combined', {
            stream: { write: message => logger.info(message.trim()) }
        }));

        // Rate limiting general
        const generalLimiter = rateLimit({
            windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
            max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
            message: {
                error: 'Demasiadas solicitudes, intenta de nuevo más tarde'
            },
            standardHeaders: true,
            legacyHeaders: false
        });
        this.app.use(generalLimiter);

        // Rate limiting específico para WhatsApp
        const whatsappLimiter = rateLimit({
            windowMs: 60 * 1000, // 1 minuto
            max: parseInt(process.env.RATE_LIMIT_WHATSAPP_MAX) || 80,
            message: {
                error: 'Límite de mensajes WhatsApp excedido'
            }
        });
        this.app.use('/api/messages', whatsappLimiter);

        // Parseo de JSON
        this.app.use(express.json({ 
            limit: '10mb',
            verify: (req, res, buf) => {
                req.rawBody = buf;
            }
        }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

        // Archivos estáticos
        this.app.use('/public', express.static('public'));
        this.app.use('/uploads', express.static('uploads/processed'));
    }

    initializeRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'OK',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                environment: process.env.NODE_ENV,
                version: process.env.npm_package_version || '1.0.0'
            });
        });

        // API Routes
        this.app.use('/api/auth', authRoutes);
        this.app.use('/api/conversations', conversationRoutes);
        this.app.use('/api/messages', messageRoutes);
        this.app.use('/api/contacts', contactRoutes);
        this.app.use('/api/files', fileRoutes);
        this.app.use('/api/dashboard', dashboardRoutes);
        this.app.use('/api/users', userRoutes);
        this.app.use('/api/teams', teamRoutes);

        // Webhook de WhatsApp (sin autenticación)
        this.app.use('/webhook', webhookRoutes);

        // Ruta por defecto
        this.app.get('/', (req, res) => {
            res.json({
                message: 'Notaría Correa - WhatsApp Business API',
                version: '1.0.0',
                status: 'running',
                endpoints: {
                    health: '/health',
                    api: '/api',
                    webhook: '/webhook/whatsapp'
                }
            });
        });

        // 404 handler
        this.app.use('*', (req, res) => {
            res.status(404).json({
                error: 'Endpoint no encontrado',
                path: req.originalUrl,
                method: req.method
            });
        });
    }

    initializeErrorHandling() {
        this.app.use(errorHandler);

        // Manejo de errores no capturados
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error);
            process.exit(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
            process.exit(1);
        });
    }

    initializeSocketIO() {
        this.io.on('connection', (socket) => {
            logger.info(`Cliente conectado: ${socket.id}`);

            // Unirse a sala por equipo
            socket.on('join-team', (teamId) => {
                socket.join(`team-${teamId}`);
                logger.info(`Cliente ${socket.id} se unió al equipo ${teamId}`);
            });

            // Unirse a sala por conversación
            socket.on('join-conversation', (conversationId) => {
                socket.join(`conversation-${conversationId}`);
                logger.info(`Cliente ${socket.id} se unió a la conversación ${conversationId}`);
            });

            socket.on('disconnect', () => {
                logger.info(`Cliente desconectado: ${socket.id}`);
            });
        });

        // Hacer io disponible globalmente
        global.io = this.io;
    }

    async start() {
        try {
            // Conectar a la base de datos
            await database.authenticate();
            logger.info('✅ Conexión a base de datos establecida');

            // Sincronizar modelos (solo en desarrollo)
            if (process.env.NODE_ENV === 'development') {
                await database.sync({ alter: true });
                logger.info('✅ Modelos sincronizados con la base de datos');
            }

            // Iniciar servidor
            this.server.listen(this.port, this.host, () => {
                logger.info(`🚀 Servidor iniciado en http://${this.host}:${this.port}`);
                logger.info(`📊 Dashboard disponible en http://${this.host}:${this.port}/dashboard`);
                logger.info(`🔗 Webhook WhatsApp: http://${this.host}:${this.port}/webhook/whatsapp`);
                logger.info(`🌐 Entorno: ${process.env.NODE_ENV}`);
                logger.info(`💾 Base de datos: ${process.env.DB_HOST}:${process.env.DB_PORT}`);
            });

        } catch (error) {
            logger.error('❌ Error al iniciar el servidor:', error);
            process.exit(1);
        }
    }

    async stop() {
        logger.info('🛑 Cerrando servidor...');

        // Cerrar conexiones de Socket.IO
        this.io.close();

        // Cerrar servidor HTTP
        this.server.close(() => {
            logger.info('✅ Servidor cerrado correctamente');
        });

        // Cerrar conexión a base de datos
        await database.close();
        logger.info('✅ Conexión a base de datos cerrada');
    }
}

// Crear e iniciar servidor
const server = new NotariaWhatsAppServer();

// Manejo de señales del sistema
process.on('SIGTERM', async () => {
    logger.info('SIGTERM recibido, cerrando servidor...');
    await server.stop();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('SIGINT recibido, cerrando servidor...');
    await server.stop();
    process.exit(0);
});

// Iniciar servidor
server.start();

module.exports = server;