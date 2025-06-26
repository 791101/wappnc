const mysql = require('mysql2/promise');
const logger = require('./logger_config');

// Configuración de la base de datos
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'notaria_correa_whatsapp',
    port: process.env.DB_PORT || 3306,
    charset: 'utf8mb4',
    timezone: '+00:00',
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: false
};

// Pool de conexiones
let pool;

const createPool = () => {
    try {
        pool = mysql.createPool(dbConfig);
        logger.info('Pool de conexiones MySQL creado exitosamente');

        // Evento para manejar conexiones
        pool.on('connection', (connection) => {
            logger.info(`Nueva conexión establecida como id ${connection.threadId}`);
        });

        pool.on('error', (err) => {
            logger.error('Error en el pool de conexiones:', err);
            if (err.code === 'PROTOCOL_CONNECTION_LOST') {
                createPool();
            } else {
                throw err;
            }
        });

        return pool;
    } catch (error) {
        logger.error('Error al crear el pool de conexiones:', error);
        throw error;
    }
};

// Función para obtener una conexión
const getConnection = async () => {
    try {
        if (!pool) {
            createPool();
        }
        return await pool.getConnection();
    } catch (error) {
        logger.error('Error al obtener conexión:', error);
        throw error;
    }
};

// Función para ejecutar consultas
const query = async (sql, params = []) => {
    let connection;
    try {
        connection = await getConnection();
        const [results] = await connection.execute(sql, params);
        return results;
    } catch (error) {
        logger.error('Error en consulta SQL:', { sql, params, error: error.message });
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Función para transacciones
const transaction = async (callback) => {
    let connection;
    try {
        connection = await getConnection();
        await connection.beginTransaction();

        const result = await callback(connection);

        await connection.commit();
        return result;
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        logger.error('Error en transacción:', error);
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Función para verificar conexión
const testConnection = async () => {
    try {
        const result = await query('SELECT 1 as test');
        logger.info('Conexión a base de datos verificada exitosamente');
        return true;
    } catch (error) {
        logger.error('Error al verificar conexión:', error);
        return false;
    }
};

// Función para obtener estadísticas de la BD
const getStats = async () => {
    try {
        const stats = await query(`
            SELECT 
                (SELECT COUNT(*) FROM usuarios WHERE activo = 1) as usuarios_activos,
                (SELECT COUNT(*) FROM contactos WHERE activo = 1) as contactos_activos,
                (SELECT COUNT(*) FROM conversaciones WHERE estado != 'cerrado') as conversaciones_abiertas,
                (SELECT COUNT(*) FROM mensajes WHERE DATE(fecha_envio) = CURDATE()) as mensajes_hoy,
                (SELECT COUNT(*) FROM equipos WHERE activo = 1) as equipos_activos
        `);
        return stats[0];
    } catch (error) {
        logger.error('Error al obtener estadísticas:', error);
        return null;
    }
};

// Inicializar pool al cargar el módulo
createPool();

module.exports = {
    query,
    transaction,
    testConnection,
    getStats,
    getConnection,
    pool: () => pool
};
