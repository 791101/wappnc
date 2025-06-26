const express = require('express');
const db = require('../../database_config');
const logger = require('../../logger_config');
const { authenticateToken, logActivity } = require('../middleware/auth');

const router = express.Router();

// Aplicar autenticación a todas las rutas
router.use(authenticateToken);

// Obtener mensajes de una conversación
router.get('/conversacion/:conversacionId', async (req, res) => {
    try {
        const { conversacionId } = req.params;
        const { page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;

        // Verificar acceso a la conversación
        const conversaciones = await db.query(
            'SELECT equipo_asignado_id, usuario_asignado_id FROM conversaciones WHERE id = ?',
            [conversacionId]
        );

        if (conversaciones.length === 0) {
            return res.status(404).json({
                error: 'Conversación no encontrada'
            });
        }

        const conversacion = conversaciones[0];

        if (req.usuario.rol !== 'admin' && 
            conversacion.equipo_asignado_id !== req.usuario.equipo_id &&
            conversacion.usuario_asignado_id !== req.usuario.id) {
            return res.status(403).json({
                error: 'No tiene acceso a esta conversación'
            });
        }

        // Obtener mensajes
        const mensajes = await db.query(`
            SELECT 
                m.id, m.whatsapp_message_id, m.tipo_mensaje, m.direccion,
                m.remitente_numero, m.destinatario_numero, m.contenido,
                m.archivo_url, m.archivo_nombre, m.archivo_tipo, m.archivo_tamaño,
                m.metadata, m.leido, m.fecha_envio, m.fecha_entrega, m.fecha_lectura,
                u.nombre as usuario_nombre
            FROM mensajes m
            LEFT JOIN usuarios u ON m.usuario_id = u.id
            WHERE m.conversacion_id = ?
            ORDER BY m.fecha_envio DESC
            LIMIT ? OFFSET ?
        `, [conversacionId, parseInt(limit), parseInt(offset)]);

        // Contar total
        const totalResult = await db.query(
            'SELECT COUNT(*) as total FROM mensajes WHERE conversacion_id = ?',
            [conversacionId]
        );

        const total = totalResult[0].total;

        // Marcar mensajes entrantes como leídos
        await db.query(
            'UPDATE mensajes SET leido = 1, fecha_lectura = NOW() WHERE conversacion_id = ? AND direccion = "entrante" AND leido = 0',
            [conversacionId]
        );

        res.json({
            mensajes: mensajes.reverse(), // Mostrar del más antiguo al más reciente
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        logger.error('Error al obtener mensajes:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener mensaje por ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const mensajes = await db.query(`
            SELECT 
                m.*, u.nombre as usuario_nombre,
                c.equipo_asignado_id, c.usuario_asignado_id
            FROM mensajes m
            LEFT JOIN usuarios u ON m.usuario_id = u.id
            JOIN conversaciones c ON m.conversacion_id = c.id
            WHERE m.id = ?
        `, [id]);

        if (mensajes.length === 0) {
            return res.status(404).json({
                error: 'Mensaje no encontrado'
            });
        }

        const mensaje = mensajes[0];

        // Verificar acceso
        if (req.usuario.rol !== 'admin' && 
            mensaje.equipo_asignado_id !== req.usuario.equipo_id &&
            mensaje.usuario_asignado_id !== req.usuario.id) {
            return res.status(403).json({
                error: 'No tiene acceso a este mensaje'
            });
        }

        res.json(mensaje);

    } catch (error) {
        logger.error('Error al obtener mensaje:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Enviar mensaje
router.post('/', logActivity('enviar_mensaje'), async (req, res) => {
    try {
        const { 
            conversacion_id, tipo_mensaje, contenido, destinatario_numero,
            archivo_url, archivo_nombre, archivo_tipo, archivo_tamaño, metadata 
        } = req.body;

        if (!conversacion_id || !contenido) {
            return res.status(400).json({
                error: 'Conversación y contenido son requeridos'
            });
        }

        // Verificar acceso a la conversación
        const conversaciones = await db.query(`
            SELECT 
                c.equipo_asignado_id, c.usuario_asignado_id,
                cont.numero_whatsapp
            FROM conversaciones c
            JOIN contactos cont ON c.contacto_id = cont.id
            WHERE c.id = ?
        `, [conversacion_id]);

        if (conversaciones.length === 0) {
            return res.status(404).json({
                error: 'Conversación no encontrada'
            });
        }

        const conversacion = conversaciones[0];

        if (req.usuario.rol !== 'admin' && 
            conversacion.equipo_asignado_id !== req.usuario.equipo_id &&
            conversacion.usuario_asignado_id !== req.usuario.id) {
            return res.status(403).json({
                error: 'No tiene acceso a esta conversación'
            });
        }

        const tiposValidos = ['texto', 'imagen', 'documento', 'audio', 'video', 'ubicacion', 'contacto', 'sticker'];
        const tipoFinal = tiposValidos.includes(tipo_mensaje) ? tipo_mensaje : 'texto';

        // Insertar mensaje en BD
        const result = await db.query(`
            INSERT INTO mensajes (
                conversacion_id, tipo_mensaje, direccion, destinatario_numero,
                usuario_id, contenido, archivo_url, archivo_nombre, 
                archivo_tipo, archivo_tamaño, metadata
            ) VALUES (?, ?, 'saliente', ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            conversacion_id, tipoFinal, destinatario_numero || conversacion.numero_whatsapp,
            req.usuario.id, contenido, archivo_url, archivo_nombre,
            archivo_tipo, archivo_tamaño, metadata ? JSON.stringify(metadata) : null
        ]);

        // Actualizar fecha de última actividad de la conversación
        await db.query(
            'UPDATE conversaciones SET fecha_ultima_actividad = NOW() WHERE id = ?',
            [conversacion_id]
        );

        // TODO: Aquí se integraría con la API de WhatsApp para enviar el mensaje real
        // Por ahora solo guardamos en BD

        logger.info(`Mensaje enviado en conversación ${conversacion_id} por ${req.usuario.email}`);

        res.status(201).json({
            message: 'Mensaje enviado exitosamente',
            id: result.insertId
        });

    } catch (error) {
        logger.error('Error al enviar mensaje:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Marcar mensaje como leído
router.patch('/:id/leido', async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar acceso al mensaje
        const mensajes = await db.query(`
            SELECT 
                m.id, c.equipo_asignado_id, c.usuario_asignado_id
            FROM mensajes m
            JOIN conversaciones c ON m.conversacion_id = c.id
            WHERE m.id = ?
        `, [id]);

        if (mensajes.length === 0) {
            return res.status(404).json({
                error: 'Mensaje no encontrado'
            });
        }

        const mensaje = mensajes[0];

        if (req.usuario.rol !== 'admin' && 
            mensaje.equipo_asignado_id !== req.usuario.equipo_id &&
            mensaje.usuario_asignado_id !== req.usuario.id) {
            return res.status(403).json({
                error: 'No tiene acceso a este mensaje'
            });
        }

        // Marcar como leído
        await db.query(
            'UPDATE mensajes SET leido = 1, fecha_lectura = NOW() WHERE id = ?',
            [id]
        );

        res.json({
            message: 'Mensaje marcado como leído'
        });

    } catch (error) {
        logger.error('Error al marcar mensaje como leído:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener estadísticas de mensajes
router.get('/estadisticas/resumen', async (req, res) => {
    try {
        const { fecha_inicio, fecha_fin, equipo_id } = req.query;

        let whereConditions = [];
        let params = [];

        // Filtro por equipo si no es admin
        if (req.usuario.rol !== 'admin' && req.usuario.equipo_id) {
            whereConditions.push('c.equipo_asignado_id = ?');
            params.push(req.usuario.equipo_id);
        } else if (equipo_id) {
            whereConditions.push('c.equipo_asignado_id = ?');
            params.push(equipo_id);
        }

        if (fecha_inicio) {
            whereConditions.push('DATE(m.fecha_envio) >= ?');
            params.push(fecha_inicio);
        }

        if (fecha_fin) {
            whereConditions.push('DATE(m.fecha_envio) <= ?');
            params.push(fecha_fin);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        const stats = await db.query(`
            SELECT 
                COUNT(*) as total_mensajes,
                COUNT(CASE WHEN m.direccion = 'entrante' THEN 1 END) as mensajes_recibidos,
                COUNT(CASE WHEN m.direccion = 'saliente' THEN 1 END) as mensajes_enviados,
                COUNT(CASE WHEN m.direccion = 'entrante' AND m.leido = 0 THEN 1 END) as mensajes_no_leidos,
                COUNT(DISTINCT m.conversacion_id) as conversaciones_activas,
                COUNT(CASE WHEN m.tipo_mensaje = 'documento' THEN 1 END) as documentos_compartidos
            FROM mensajes m
            JOIN conversaciones c ON m.conversacion_id = c.id
            ${whereClause}
        `, params);

        res.json(stats[0]);

    } catch (error) {
        logger.error('Error al obtener estadísticas de mensajes:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

module.exports = router;
