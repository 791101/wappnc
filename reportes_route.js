const express = require('express');
const db = require('../../database_config');
const logger = require('../../logger_config');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Aplicar autenticación a todas las rutas
router.use(authenticateToken);

// Dashboard general
router.get('/dashboard', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin } = req.query;

        let whereConditions = [];
        let params = [];

        // Filtro por equipo si no es admin
        if (req.usuario.rol !== 'admin' && req.usuario.equipo_id) {
            whereConditions.push('c.equipo_asignado_id = ?');
            params.push(req.usuario.equipo_id);
        }

        if (fecha_inicio) {
            whereConditions.push('DATE(c.fecha_inicio) >= ?');
            params.push(fecha_inicio);
        }

        if (fecha_fin) {
            whereConditions.push('DATE(c.fecha_inicio) <= ?');
            params.push(fecha_fin);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // Estadísticas generales
        const stats = await db.query(`
            SELECT 
                COUNT(*) as total_conversaciones,
                COUNT(CASE WHEN c.estado = 'nuevo' THEN 1 END) as conversaciones_nuevas,
                COUNT(CASE WHEN c.estado = 'en_proceso' THEN 1 END) as conversaciones_en_proceso,
                COUNT(CASE WHEN c.estado = 'resuelto' THEN 1 END) as conversaciones_resueltas,
                COUNT(CASE WHEN c.estado = 'cerrado' THEN 1 END) as conversaciones_cerradas,
                COUNT(CASE WHEN c.prioridad = 'urgente' THEN 1 END) as conversaciones_urgentes,
                AVG(c.tiempo_respuesta_promedio) as tiempo_respuesta_promedio,
                AVG(c.satisfaccion_cliente) as satisfaccion_promedio
            FROM conversaciones c
            ${whereClause}
        `, params);

        // Mensajes por día (últimos 7 días)
        const mensajesPorDia = await db.query(`
            SELECT 
                DATE(m.fecha_envio) as fecha,
                COUNT(*) as total_mensajes,
                COUNT(CASE WHEN m.direccion = 'entrante' THEN 1 END) as mensajes_recibidos,
                COUNT(CASE WHEN m.direccion = 'saliente' THEN 1 END) as mensajes_enviados
            FROM mensajes m
            JOIN conversaciones c ON m.conversacion_id = c.id
            WHERE DATE(m.fecha_envio) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            ${whereConditions.length > 0 ? 'AND ' + whereConditions.join(' AND ') : ''}
            GROUP BY DATE(m.fecha_envio)
            ORDER BY fecha DESC
        `, params);

        // Top equipos por conversaciones
        const equiposStats = await db.query(`
            SELECT 
                e.nombre as equipo_nombre,
                e.color_hex,
                COUNT(c.id) as total_conversaciones,
                COUNT(CASE WHEN c.estado != 'cerrado' THEN 1 END) as conversaciones_activas
            FROM equipos e
            LEFT JOIN conversaciones c ON e.id = c.equipo_asignado_id
            ${whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : ''}
            GROUP BY e.id, e.nombre, e.color_hex
            ORDER BY total_conversaciones DESC
            LIMIT 10
        `, params);

        res.json({
            estadisticas_generales: stats[0],
            mensajes_por_dia: mensajesPorDia,
            equipos_estadisticas: equiposStats
        });

    } catch (error) {
        logger.error('Error al obtener dashboard:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Reporte de conversaciones por estado
router.get('/conversaciones-estado', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin, equipo_id } = req.query;

        let whereConditions = [];
        let params = [];

        if (req.usuario.rol !== 'admin' && req.usuario.equipo_id) {
            whereConditions.push('c.equipo_asignado_id = ?');
            params.push(req.usuario.equipo_id);
        } else if (equipo_id) {
            whereConditions.push('c.equipo_asignado_id = ?');
            params.push(equipo_id);
        }

        if (fecha_inicio) {
            whereConditions.push('DATE(c.fecha_inicio) >= ?');
            params.push(fecha_inicio);
        }

        if (fecha_fin) {
            whereConditions.push('DATE(c.fecha_inicio) <= ?');
            params.push(fecha_fin);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        const reporte = await db.query(`
            SELECT 
                c.estado,
                COUNT(*) as cantidad,
                AVG(c.tiempo_respuesta_promedio) as tiempo_respuesta_promedio,
                AVG(c.satisfaccion_cliente) as satisfaccion_promedio
            FROM conversaciones c
            ${whereClause}
            GROUP BY c.estado
            ORDER BY cantidad DESC
        `, params);

        res.json(reporte);

    } catch (error) {
        logger.error('Error al obtener reporte de conversaciones por estado:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Reporte de productividad por usuario
router.get('/productividad-usuarios', requireRole('admin', 'notario'), async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin, equipo_id } = req.query;

        let whereConditions = [];
        let params = [];

        if (req.usuario.rol !== 'admin' && req.usuario.equipo_id) {
            whereConditions.push('u.equipo_id = ?');
            params.push(req.usuario.equipo_id);
        } else if (equipo_id) {
            whereConditions.push('u.equipo_id = ?');
            params.push(equipo_id);
        }

        if (fecha_inicio) {
            whereConditions.push('DATE(c.fecha_inicio) >= ?');
            params.push(fecha_inicio);
        }

        if (fecha_fin) {
            whereConditions.push('DATE(c.fecha_inicio) <= ?');
            params.push(fecha_fin);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        const reporte = await db.query(`
            SELECT 
                u.nombre as usuario_nombre,
                u.rol,
                e.nombre as equipo_nombre,
                COUNT(c.id) as conversaciones_asignadas,
                COUNT(CASE WHEN c.estado = 'resuelto' OR c.estado = 'cerrado' THEN 1 END) as conversaciones_completadas,
                AVG(c.tiempo_respuesta_promedio) as tiempo_respuesta_promedio,
                AVG(c.satisfaccion_cliente) as satisfaccion_promedio,
                COUNT(CASE WHEN c.estado = 'resuelto' OR c.estado = 'cerrado' THEN 1 END) / COUNT(c.id) * 100 as porcentaje_completado
            FROM usuarios u
            LEFT JOIN equipos e ON u.equipo_id = e.id
            LEFT JOIN conversaciones c ON u.id = c.usuario_asignado_id
            ${whereClause}
            GROUP BY u.id, u.nombre, u.rol, e.nombre
            HAVING conversaciones_asignadas > 0
            ORDER BY conversaciones_completadas DESC
        `, params);

        res.json(reporte);

    } catch (error) {
        logger.error('Error al obtener reporte de productividad:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Reporte de asuntos más frecuentes
router.get('/asuntos-frecuentes', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin, equipo_id } = req.query;

        let whereConditions = [];
        let params = [];

        if (req.usuario.rol !== 'admin' && req.usuario.equipo_id) {
            whereConditions.push('c.equipo_asignado_id = ?');
            params.push(req.usuario.equipo_id);
        } else if (equipo_id) {
            whereConditions.push('c.equipo_asignado_id = ?');
            params.push(equipo_id);
        }

        if (fecha_inicio) {
            whereConditions.push('DATE(c.fecha_inicio) >= ?');
            params.push(fecha_inicio);
        }

        if (fecha_fin) {
            whereConditions.push('DATE(c.fecha_inicio) <= ?');
            params.push(fecha_fin);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        const reporte = await db.query(`
            SELECT 
                a.nombre as asunto_nombre,
                a.categoria,
                a.color_hex,
                COUNT(c.id) as total_conversaciones,
                AVG(c.tiempo_respuesta_promedio) as tiempo_respuesta_promedio,
                AVG(c.satisfaccion_cliente) as satisfaccion_promedio
            FROM asuntos a
            JOIN conversaciones c ON a.id = c.asunto_id
            ${whereClause}
            GROUP BY a.id, a.nombre, a.categoria, a.color_hex
            ORDER BY total_conversaciones DESC
            LIMIT 20
        `, params);

        res.json(reporte);

    } catch (error) {
        logger.error('Error al obtener reporte de asuntos frecuentes:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Reporte de satisfacción del cliente
router.get('/satisfaccion-cliente', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin, equipo_id } = req.query;

        let whereConditions = ['c.satisfaccion_cliente IS NOT NULL'];
        let params = [];

        if (req.usuario.rol !== 'admin' && req.usuario.equipo_id) {
            whereConditions.push('c.equipo_asignado_id = ?');
            params.push(req.usuario.equipo_id);
        } else if (equipo_id) {
            whereConditions.push('c.equipo_asignado_id = ?');
            params.push(equipo_id);
        }

        if (fecha_inicio) {
            whereConditions.push('DATE(c.fecha_cierre) >= ?');
            params.push(fecha_inicio);
        }

        if (fecha_fin) {
            whereConditions.push('DATE(c.fecha_cierre) <= ?');
            params.push(fecha_fin);
        }

        const whereClause = 'WHERE ' + whereConditions.join(' AND ');

        const reporte = await db.query(`
            SELECT 
                c.satisfaccion_cliente as puntuacion,
                COUNT(*) as cantidad,
                COUNT(*) * 100.0 / (SELECT COUNT(*) FROM conversaciones c2 ${whereClause.replace('c.', 'c2.')}) as porcentaje
            FROM conversaciones c
            ${whereClause}
            GROUP BY c.satisfaccion_cliente
            ORDER BY c.satisfaccion_cliente DESC
        `, [...params, ...params]);

        const promedio = await db.query(`
            SELECT 
                AVG(c.satisfaccion_cliente) as promedio_satisfaccion,
                COUNT(*) as total_evaluaciones
            FROM conversaciones c
            ${whereClause}
        `, params);

        res.json({
            distribucion: reporte,
            resumen: promedio[0]
        });

    } catch (error) {
        logger.error('Error al obtener reporte de satisfacción:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

module.exports = router;
