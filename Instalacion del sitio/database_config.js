const { Sequelize } = require('sequelize');
const logger = require('./logger');

// Configuración de la base de datos
const sequelize = new Sequelize({
    host: process.env.DB_HOST || '10.0.0.64',
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME || 'notaria_correa_whatsapp',
    username: process.env.DB_USER || 'notaria_user',
    password: process.env.DB_PASSWORD,
    dialect: process.env.DB_DIALECT || 'mysql',

    // Configuración del pool de conexiones
    pool: {
        max: parseInt(process.env.DB_POOL_MAX) || 20,
        min: parseInt(process.env.DB_POOL_MIN) || 5,
        acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 30000,
        idle: parseInt(process.env.DB_POOL_IDLE) || 10000
    },

    // Configuración de logging
    logging: (msg) => {
        if (process.env.NODE_ENV === 'development') {
            logger.debug('DB Query:', msg);
        }
    },

    // Configuración de timezone
    timezone: process.env.BUSINESS_TIMEZONE || 'America/Mexico_City',

    // Configuración adicional
    define: {
        charset: 'utf8mb4',
        collate: 'utf8mb4_unicode_ci',
        timestamps: true,
        underscored: false,
        freezeTableName: true
    },

    // Configuración de retry
    retry: {
        max: 3,
        timeout: 5000,
        match: [
            /ETIMEDOUT/,
            /EHOSTUNREACH/,
            /ECONNRESET/,
            /ECONNREFUSED/,
            /TIMEOUT/,
            /ESOCKETTIMEDOUT/,
            /EHOSTUNREACH/,
            /EPIPE/,
            /EAI_AGAIN/,
            /SequelizeConnectionError/,
            /SequelizeConnectionRefusedError/,
            /SequelizeHostNotFoundError/,
            /SequelizeHostNotReachableError/,
            /SequelizeInvalidConnectionError/,
            /SequelizeConnectionTimedOutError/
        ]
    }
});

// Función para probar la conexión
async function testConnection() {
    try {
        await sequelize.authenticate();
        logger.info('✅ Conexión a MariaDB establecida correctamente');

        // Mostrar información de la conexión
        const [results] = await sequelize.query('SELECT VERSION() as version');
        logger.info(`📊 Versión de MariaDB: ${results[0].version}`);

        return true;
    } catch (error) {
        logger.error('❌ Error conectando a MariaDB:', error.message);

        // Información adicional para debugging
        logger.error('Configuración de conexión:', {
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            database: process.env.DB_NAME,
            username: process.env.DB_USER
        });

        throw error;
    }
}

// Función para cerrar la conexión
async function closeConnection() {
    try {
        await sequelize.close();
        logger.info('✅ Conexión a MariaDB cerrada correctamente');
    } catch (error) {
        logger.error('❌ Error cerrando conexión a MariaDB:', error);
    }
}

// Función para ejecutar queries raw
async function executeQuery(query, replacements = {}) {
    try {
        const [results, metadata] = await sequelize.query(query, {
            replacements,
            type: Sequelize.QueryTypes.SELECT
        });
        return results;
    } catch (error) {
        logger.error('Error ejecutando query:', error);
        throw error;
    }
}

// Función para obtener estadísticas de la base de datos
async function getDatabaseStats() {
    try {
        const stats = await executeQuery(`
            SELECT 
                table_name as tableName,
                table_rows as rowCount,
                ROUND(((data_length + index_length) / 1024 / 1024), 2) as sizeMB
            FROM information_schema.tables 
            WHERE table_schema = :database
            ORDER BY (data_length + index_length) DESC
        `, { database: process.env.DB_NAME });

        return stats;
    } catch (error) {
        logger.error('Error obteniendo estadísticas de BD:', error);
        return [];
    }
}

module.exports = {
    sequelize,
    testConnection,
    closeConnection,
    executeQuery,
    getDatabaseStats,
    // Alias para compatibilidad
    authenticate: testConnection,
    close: closeConnection,
    sync: (options) => sequelize.sync(options),
    query: (query, options) => sequelize.query(query, options)
};