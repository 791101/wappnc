const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Crear directorios de logs si no existen
const fs = require('fs');
const logDirs = ['logs/app', 'logs/error', 'logs/access', 'logs/whatsapp'];
logDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Configuración de formato
const logFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.prettyPrint()
);

// Configuración de formato para consola
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({
        format: 'HH:mm:ss'
    }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(meta).length > 0) {
            msg += ' ' + JSON.stringify(meta, null, 2);
        }
        return msg;
    })
);

// Configuración de transports
const transports = [
    // Console transport
    new winston.transports.Console({
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        format: consoleFormat,
        handleExceptions: true,
        handleRejections: true
    }),

    // App logs (rotación diaria)
    new DailyRotateFile({
        filename: 'logs/app/app-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: process.env.LOG_MAX_SIZE || '10m',
        maxFiles: process.env.LOG_MAX_FILES || '14d',
        format: logFormat,
        level: 'info'
    }),

    // Error logs (rotación diaria)
    new DailyRotateFile({
        filename: 'logs/error/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: process.env.LOG_MAX_SIZE || '10m',
        maxFiles: process.env.LOG_MAX_FILES || '14d',
        format: logFormat,
        level: 'error'
    }),

    // WhatsApp logs específicos
    new DailyRotateFile({
        filename: 'logs/whatsapp/whatsapp-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: process.env.LOG_MAX_SIZE || '10m',
        maxFiles: process.env.LOG_MAX_FILES || '14d',
        format: logFormat,
        level: 'debug'
    })
];

// Crear logger principal
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports,
    exitOnError: false
});

// Logger específico para WhatsApp
const whatsappLogger = winston.createLogger({
    level: 'debug',
    format: logFormat,
    transports: [
        new winston.transports.Console({
            format: consoleFormat,
            level: 'debug'
        }),
        new DailyRotateFile({
            filename: 'logs/whatsapp/whatsapp-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '10m',
            maxFiles: '14d',
            format: logFormat
        })
    ]
});

// Logger específico para accesos HTTP
const accessLogger = winston.createLogger({
    level: 'info',
    format: logFormat,
    transports: [
        new DailyRotateFile({
            filename: 'logs/access/access-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxSize: '10m',
            maxFiles: '14d',
            format: logFormat
        })
    ]
});

// Función para log de actividad de usuario
function logUserActivity(userId, action, details = {}) {
    logger.info('User Activity', {
        userId,
        action,
        details,
        timestamp: new Date().toISOString()
    });
}

// Función para log de WhatsApp
function logWhatsApp(type, data) {
    whatsappLogger.info(`WhatsApp ${type}`, {
        type,
        data,
        timestamp: new Date().toISOString()
    });
}

// Función para log de errores con contexto
function logError(error, context = {}) {
    logger.error('Application Error', {
        message: error.message,
        stack: error.stack,
        context,
        timestamp: new Date().toISOString()
    });
}

// Función para log de métricas
function logMetrics(metrics) {
    logger.info('System Metrics', {
        metrics,
        timestamp: new Date().toISOString()
    });
}

module.exports = {
    logger,
    whatsappLogger,
    accessLogger,
    logUserActivity,
    logWhatsApp,
    logError,
    logMetrics,
    // Alias para compatibilidad
    info: logger.info.bind(logger),
    error: logger.error.bind(logger),
    warn: logger.warn.bind(logger),
    debug: logger.debug.bind(logger)
};