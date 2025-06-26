const express = require('express');
const db = require('../../database_config');
const logger = require('../../logger_config');
const { authenticateToken, requireRole, logActivity } = require('../middleware/auth');

const router = express.Router();

// Aplicar autenticación a todas las rutas
router.use(authenticateToken);

// Obtener todas las configuraciones (solo admin)
router.get('/', requireRole('admin'), async (req, res) => {
    try {
        const configuraciones = await db.query(`
            SELECT clave, valor, descripcion, tipo
            FROM configuraciones
            ORDER BY clave ASC
        `);

        // Ocultar valores sensibles
        const configSeguras = configuraciones.map(config => ({
            ...config,
            valor: config.clave.includes('token') || config.clave.includes('password') 
                ? (config.valor ? '***configurado***' : '') 
                : config.valor
        }));

        res.json(configSeguras);

    } catch (error) {
        logger.error('Error al obtener configuraciones:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener configuración específica
router.get('/:clave', requireRole('admin'), async (req, res) => {
    try {
        const { clave } = req.params;

        const configuraciones = await db.query(
            'SELECT clave, valor, descripcion, tipo FROM configuraciones WHERE clave = ?',
            [clave]
        );

        if (configuraciones.length === 0) {
            return res.status(404).json({
                error: 'Configuración no encontrada'
            });
        }

        const config = configuraciones[0];

        // Ocultar valores sensibles
        if (config.clave.includes('token') || config.clave.includes('password')) {
            config.valor = config.valor ? '***configurado***' : '';
        }

        res.json(config);

    } catch (error) {
        logger.error('Error al obtener configuración:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Actualizar configuración
router.put('/:clave', requireRole('admin'), logActivity('actualizar_configuracion'), async (req, res) => {
    try {
        const { clave } = req.params;
        const { valor } = req.body;

        if (valor === undefined) {
            return res.status(400).json({
                error: 'El valor es requerido'
            });
        }

        // Verificar que la configuración existe
        const configExistente = await db.query(
            'SELECT id FROM configuraciones WHERE clave = ?',
            [clave]
        );

        if (configExistente.length === 0) {
            return res.status(404).json({
                error: 'Configuración no encontrada'
            });
        }

        // Actualizar configuración
        await db.query(
            'UPDATE configuraciones SET valor = ? WHERE clave = ?',
            [valor, clave]
        );

        logger.info(`Configuración ${clave} actualizada por ${req.usuario.email}`);

        res.json({
            message: 'Configuración actualizada exitosamente'
        });

    } catch (error) {
        logger.error('Error al actualizar configuración:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener configuraciones públicas (no sensibles)
router.get('/public/general', async (req, res) => {
    try {
        const configuraciones = await db.query(`
            SELECT clave, valor, descripcion
            FROM configuraciones
            WHERE clave IN ('horario_inicio', 'horario_fin', 'mensaje_fuera_horario', 'tiempo_respuesta_sla')
        `);

        const configObj = {};
        configuraciones.forEach(config => {
            configObj[config.clave] = {
                valor: config.valor,
                descripcion: config.descripcion
            };
        });

        res.json(configObj);

    } catch (error) {
        logger.error('Error al obtener configuraciones públicas:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

module.exports = router;
