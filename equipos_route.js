const express = require('express');
const db = require('../../database_config');
const logger = require('../../logger_config');
const { authenticateToken, requireRole, logActivity } = require('../middleware/auth');

const router = express.Router();

// Aplicar autenticación a todas las rutas
router.use(authenticateToken);

// Obtener todos los equipos
router.get('/', async (req, res) => {
    try {
        const { activo = '' } = req.query;

        let whereClause = '';
        let params = [];

        if (activo !== '') {
            whereClause = 'WHERE activo = ?';
            params.push(activo === 'true' ? 1 : 0);
        }

        const equipos = await db.query(`
            SELECT 
                e.id, e.nombre, e.descripcion, e.color_hex, e.activo, e.fecha_creacion,
                u.nombre as lider_nombre,
                (SELECT COUNT(*) FROM usuarios WHERE equipo_id = e.id AND activo = 1) as total_usuarios
            FROM equipos e
            LEFT JOIN usuarios u ON e.lider_id = u.id
            ${whereClause}
            ORDER BY e.nombre ASC
        `, params);

        res.json(equipos);

    } catch (error) {
        logger.error('Error al obtener equipos:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener equipo por ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const equipos = await db.query(`
            SELECT 
                e.id, e.nombre, e.descripcion, e.lider_id, e.color_hex, e.activo, e.fecha_creacion,
                u.nombre as lider_nombre
            FROM equipos e
            LEFT JOIN usuarios u ON e.lider_id = u.id
            WHERE e.id = ?
        `, [id]);

        if (equipos.length === 0) {
            return res.status(404).json({
                error: 'Equipo no encontrado'
            });
        }

        // Obtener miembros del equipo
        const miembros = await db.query(`
            SELECT id, nombre, email, rol, telefono, extension, activo
            FROM usuarios
            WHERE equipo_id = ?
            ORDER BY nombre ASC
        `, [id]);

        const equipo = equipos[0];
        equipo.miembros = miembros;

        res.json(equipo);

    } catch (error) {
        logger.error('Error al obtener equipo:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Crear nuevo equipo (solo admin)
router.post('/', requireRole('admin'), logActivity('crear_equipo'), async (req, res) => {
    try {
        const { nombre, descripcion, lider_id, color_hex } = req.body;

        if (!nombre) {
            return res.status(400).json({
                error: 'El nombre del equipo es requerido'
            });
        }

        // Verificar que el nombre no exista
        const equipoExistente = await db.query(
            'SELECT id FROM equipos WHERE nombre = ?',
            [nombre]
        );

        if (equipoExistente.length > 0) {
            return res.status(400).json({
                error: 'Ya existe un equipo con este nombre'
            });
        }

        // Verificar que el líder existe si se proporciona
        if (lider_id) {
            const lider = await db.query(
                'SELECT id FROM usuarios WHERE id = ? AND activo = 1',
                [lider_id]
            );

            if (lider.length === 0) {
                return res.status(400).json({
                    error: 'Líder no válido'
                });
            }
        }

        const result = await db.query(`
            INSERT INTO equipos (nombre, descripcion, lider_id, color_hex)
            VALUES (?, ?, ?, ?)
        `, [nombre, descripcion, lider_id || null, color_hex || '#007bff']);

        logger.info(`Equipo creado: ${nombre} por ${req.usuario.email}`);

        res.status(201).json({
            message: 'Equipo creado exitosamente',
            id: result.insertId
        });

    } catch (error) {
        logger.error('Error al crear equipo:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Actualizar equipo (solo admin)
router.put('/:id', requireRole('admin'), logActivity('actualizar_equipo'), async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, descripcion, lider_id, color_hex, activo } = req.body;

        // Verificar que el equipo existe
        const equipoExistente = await db.query(
            'SELECT id FROM equipos WHERE id = ?',
            [id]
        );

        if (equipoExistente.length === 0) {
            return res.status(404).json({
                error: 'Equipo no encontrado'
            });
        }

        // Construir query de actualización
        let updateFields = [];
        let params = [];

        if (nombre) {
            // Verificar nombre único
            const nombreExistente = await db.query(
                'SELECT id FROM equipos WHERE nombre = ? AND id != ?',
                [nombre, id]
            );

            if (nombreExistente.length > 0) {
                return res.status(400).json({
                    error: 'Ya existe un equipo con este nombre'
                });
            }

            updateFields.push('nombre = ?');
            params.push(nombre);
        }

        if (descripcion !== undefined) {
            updateFields.push('descripcion = ?');
            params.push(descripcion);
        }

        if (lider_id !== undefined) {
            if (lider_id) {
                const lider = await db.query(
                    'SELECT id FROM usuarios WHERE id = ? AND activo = 1',
                    [lider_id]
                );

                if (lider.length === 0) {
                    return res.status(400).json({
                        error: 'Líder no válido'
                    });
                }
            }
            updateFields.push('lider_id = ?');
            params.push(lider_id || null);
        }

        if (color_hex) {
            updateFields.push('color_hex = ?');
            params.push(color_hex);
        }

        if (activo !== undefined) {
            updateFields.push('activo = ?');
            params.push(activo ? 1 : 0);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                error: 'No hay campos para actualizar'
            });
        }

        params.push(id);

        await db.query(`
            UPDATE equipos 
            SET ${updateFields.join(', ')}
            WHERE id = ?
        `, params);

        logger.info(`Equipo ${id} actualizado por ${req.usuario.email}`);

        res.json({
            message: 'Equipo actualizado exitosamente'
        });

    } catch (error) {
        logger.error('Error al actualizar equipo:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener estadísticas del equipo
router.get('/:id/estadisticas', async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar acceso al equipo
        if (req.usuario.rol !== 'admin' && parseInt(id) !== req.usuario.equipo_id) {
            return res.status(403).json({
                error: 'No tiene acceso a este equipo'
            });
        }

        const stats = await db.query(`
            SELECT 
                (SELECT COUNT(*) FROM usuarios WHERE equipo_id = ? AND activo = 1) as total_usuarios,
                (SELECT COUNT(*) FROM conversaciones WHERE equipo_asignado_id = ? AND estado != 'cerrado') as conversaciones_activas,
                (SELECT COUNT(*) FROM conversaciones WHERE equipo_asignado_id = ? AND DATE(fecha_inicio) = CURDATE()) as conversaciones_hoy,
                (SELECT COUNT(*) FROM mensajes m 
                 JOIN conversaciones c ON m.conversacion_id = c.id 
                 WHERE c.equipo_asignado_id = ? AND DATE(m.fecha_envio) = CURDATE()) as mensajes_hoy
        `, [id, id, id, id]);

        res.json(stats[0]);

    } catch (error) {
        logger.error('Error al obtener estadísticas del equipo:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

module.exports = router;
