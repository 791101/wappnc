const express = require('express');
const db = require('../../database_config');
const logger = require('../../logger_config');
const { authenticateToken, requireRole, logActivity } = require('../middleware/auth');

const router = express.Router();

// Aplicar autenticación a todas las rutas
router.use(authenticateToken);

// Obtener todas las conversaciones
router.get('/', async (req, res) => {
    try {
        const { 
            page = 1, limit = 10, search = '', estado = '', prioridad = '', 
            equipo_id = '', usuario_id = '', asunto_id = '' 
        } = req.query;
        const offset = (page - 1) * limit;

        let whereConditions = [];
        let params = [];

        // Filtro por equipo si no es admin
        if (req.usuario.rol !== 'admin' && req.usuario.equipo_id) {
            whereConditions.push('c.equipo_asignado_id = ?');
            params.push(req.usuario.equipo_id);
        }

        if (search) {
            whereConditions.push('(c.titulo LIKE ? OR cont.nombre LIKE ? OR cont.numero_whatsapp LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (estado) {
            whereConditions.push('c.estado = ?');
            params.push(estado);
        }

        if (prioridad) {
            whereConditions.push('c.prioridad = ?');
            params.push(prioridad);
        }

        if (equipo_id) {
            whereConditions.push('c.equipo_asignado_id = ?');
            params.push(equipo_id);
        }

        if (usuario_id) {
            whereConditions.push('c.usuario_asignado_id = ?');
            params.push(usuario_id);
        }

        if (asunto_id) {
            whereConditions.push('c.asunto_id = ?');
            params.push(asunto_id);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        const conversaciones = await db.query(`
            SELECT 
                c.id, c.estado, c.prioridad, c.titulo, c.descripcion,
                c.fecha_inicio, c.fecha_ultima_actividad, c.fecha_cierre,
                c.tiempo_respuesta_promedio, c.satisfaccion_cliente,
                cont.id as contacto_id, cont.nombre as contacto_nombre, 
                cont.numero_whatsapp, cont.tipo_contacto,
                a.nombre as asunto_nombre, a.categoria as asunto_categoria,
                e.nombre as equipo_nombre, e.color_hex as equipo_color,
                u.nombre as usuario_asignado_nombre,
                (SELECT COUNT(*) FROM mensajes WHERE conversacion_id = c.id) as total_mensajes,
                (SELECT COUNT(*) FROM mensajes WHERE conversacion_id = c.id AND leido = 0 AND direccion = 'entrante') as mensajes_no_leidos
            FROM conversaciones c
            JOIN contactos cont ON c.contacto_id = cont.id
            LEFT JOIN asuntos a ON c.asunto_id = a.id
            LEFT JOIN equipos e ON c.equipo_asignado_id = e.id
            LEFT JOIN usuarios u ON c.usuario_asignado_id = u.id
            ${whereClause}
            ORDER BY c.fecha_ultima_actividad DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), parseInt(offset)]);

        // Contar total
        const totalResult = await db.query(`
            SELECT COUNT(*) as total
            FROM conversaciones c
            JOIN contactos cont ON c.contacto_id = cont.id
            LEFT JOIN asuntos a ON c.asunto_id = a.id
            LEFT JOIN equipos e ON c.equipo_asignado_id = e.id
            LEFT JOIN usuarios u ON c.usuario_asignado_id = u.id
            ${whereClause}
        `, params);

        const total = totalResult[0].total;

        res.json({
            conversaciones,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        logger.error('Error al obtener conversaciones:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener conversación por ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const conversaciones = await db.query(`
            SELECT 
                c.*, 
                cont.nombre as contacto_nombre, cont.numero_whatsapp, 
                cont.email as contacto_email, cont.tipo_contacto,
                a.nombre as asunto_nombre, a.categoria as asunto_categoria,
                e.nombre as equipo_nombre, e.color_hex as equipo_color,
                u.nombre as usuario_asignado_nombre,
                ua.nombre as asignado_por_nombre
            FROM conversaciones c
            JOIN contactos cont ON c.contacto_id = cont.id
            LEFT JOIN asuntos a ON c.asunto_id = a.id
            LEFT JOIN equipos e ON c.equipo_asignado_id = e.id
            LEFT JOIN usuarios u ON c.usuario_asignado_id = u.id
            LEFT JOIN usuarios ua ON c.asignado_por_usuario_id = ua.id
            WHERE c.id = ?
        `, [id]);

        if (conversaciones.length === 0) {
            return res.status(404).json({
                error: 'Conversación no encontrada'
            });
        }

        // Verificar acceso
        const conversacion = conversaciones[0];
        if (req.usuario.rol !== 'admin' && 
            conversacion.equipo_asignado_id !== req.usuario.equipo_id &&
            conversacion.usuario_asignado_id !== req.usuario.id) {
            return res.status(403).json({
                error: 'No tiene acceso a esta conversación'
            });
        }

        // Obtener etiquetas
        const etiquetas = await db.query(`
            SELECT e.id, e.nombre, e.color_hex, e.categoria
            FROM conversacion_etiquetas ce
            JOIN etiquetas e ON ce.etiqueta_id = e.id
            WHERE ce.conversacion_id = ?
        `, [id]);

        conversacion.etiquetas = etiquetas;

        res.json(conversacion);

    } catch (error) {
        logger.error('Error al obtener conversación:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Crear nueva conversación
router.post('/', logActivity('crear_conversacion'), async (req, res) => {
    try {
        const { 
            contacto_id, asunto_id, equipo_asignado_id, usuario_asignado_id,
            prioridad, titulo, descripcion 
        } = req.body;

        if (!contacto_id) {
            return res.status(400).json({
                error: 'El contacto es requerido'
            });
        }

        // Verificar que el contacto existe
        const contacto = await db.query(
            'SELECT id FROM contactos WHERE id = ? AND activo = 1',
            [contacto_id]
        );

        if (contacto.length === 0) {
            return res.status(400).json({
                error: 'Contacto no válido'
            });
        }

        // Verificar asunto si se proporciona
        if (asunto_id) {
            const asunto = await db.query(
                'SELECT id FROM asuntos WHERE id = ? AND activo = 1',
                [asunto_id]
            );

            if (asunto.length === 0) {
                return res.status(400).json({
                    error: 'Asunto no válido'
                });
            }
        }

        // Verificar equipo si se proporciona
        if (equipo_asignado_id) {
            const equipo = await db.query(
                'SELECT id FROM equipos WHERE id = ? AND activo = 1',
                [equipo_asignado_id]
            );

            if (equipo.length === 0) {
                return res.status(400).json({
                    error: 'Equipo no válido'
                });
            }
        }

        // Verificar usuario asignado si se proporciona
        if (usuario_asignado_id) {
            const usuario = await db.query(
                'SELECT id FROM usuarios WHERE id = ? AND activo = 1',
                [usuario_asignado_id]
            );

            if (usuario.length === 0) {
                return res.status(400).json({
                    error: 'Usuario asignado no válido'
                });
            }
        }

        const prioridadesValidas = ['baja', 'media', 'alta', 'urgente'];
        const prioridadFinal = prioridadesValidas.includes(prioridad) ? prioridad : 'media';

        const result = await db.query(`
            INSERT INTO conversaciones (
                contacto_id, asunto_id, equipo_asignado_id, usuario_asignado_id,
                prioridad, titulo, descripcion, asignado_por_usuario_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            contacto_id, asunto_id || null, equipo_asignado_id || null, 
            usuario_asignado_id || null, prioridadFinal, titulo, descripcion, req.usuario.id
        ]);

        logger.info(`Conversación creada: ${result.insertId} por ${req.usuario.email}`);

        res.status(201).json({
            message: 'Conversación creada exitosamente',
            id: result.insertId
        });

    } catch (error) {
        logger.error('Error al crear conversación:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Actualizar conversación
router.put('/:id', logActivity('actualizar_conversacion'), async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            asunto_id, equipo_asignado_id, usuario_asignado_id, estado,
            prioridad, titulo, descripcion, notas_internas, satisfaccion_cliente
        } = req.body;

        // Verificar que la conversación existe y acceso
        const conversaciones = await db.query(
            'SELECT equipo_asignado_id, usuario_asignado_id FROM conversaciones WHERE id = ?',
            [id]
        );

        if (conversaciones.length === 0) {
            return res.status(404).json({
                error: 'Conversación no encontrada'
            });
        }

        const conversacion = conversaciones[0];

        // Verificar acceso
        if (req.usuario.rol !== 'admin' && 
            conversacion.equipo_asignado_id !== req.usuario.equipo_id &&
            conversacion.usuario_asignado_id !== req.usuario.id) {
            return res.status(403).json({
                error: 'No tiene acceso a esta conversación'
            });
        }

        // Construir query de actualización
        let updateFields = [];
        let params = [];

        if (asunto_id !== undefined) {
            if (asunto_id) {
                const asunto = await db.query(
                    'SELECT id FROM asuntos WHERE id = ? AND activo = 1',
                    [asunto_id]
                );

                if (asunto.length === 0) {
                    return res.status(400).json({
                        error: 'Asunto no válido'
                    });
                }
            }
            updateFields.push('asunto_id = ?');
            params.push(asunto_id || null);
        }

        if (equipo_asignado_id !== undefined) {
            if (equipo_asignado_id) {
                const equipo = await db.query(
                    'SELECT id FROM equipos WHERE id = ? AND activo = 1',
                    [equipo_asignado_id]
                );

                if (equipo.length === 0) {
                    return res.status(400).json({
                        error: 'Equipo no válido'
                    });
                }
            }
            updateFields.push('equipo_asignado_id = ?');
            params.push(equipo_asignado_id || null);
        }

        if (usuario_asignado_id !== undefined) {
            if (usuario_asignado_id) {
                const usuario = await db.query(
                    'SELECT id FROM usuarios WHERE id = ? AND activo = 1',
                    [usuario_asignado_id]
                );

                if (usuario.length === 0) {
                    return res.status(400).json({
                        error: 'Usuario asignado no válido'
                    });
                }
            }
            updateFields.push('usuario_asignado_id = ?');
            params.push(usuario_asignado_id || null);
        }

        if (estado) {
            const estadosValidos = ['nuevo', 'en_proceso', 'pendiente', 'resuelto', 'cerrado'];
            if (estadosValidos.includes(estado)) {
                updateFields.push('estado = ?');
                params.push(estado);

                // Si se cierra la conversación, agregar fecha de cierre
                if (estado === 'cerrado') {
                    updateFields.push('fecha_cierre = NOW()');
                }
            }
        }

        if (prioridad) {
            const prioridadesValidas = ['baja', 'media', 'alta', 'urgente'];
            if (prioridadesValidas.includes(prioridad)) {
                updateFields.push('prioridad = ?');
                params.push(prioridad);
            }
        }

        if (titulo !== undefined) {
            updateFields.push('titulo = ?');
            params.push(titulo);
        }

        if (descripcion !== undefined) {
            updateFields.push('descripcion = ?');
            params.push(descripcion);
        }

        if (notas_internas !== undefined) {
            updateFields.push('notas_internas = ?');
            params.push(notas_internas);
        }

        if (satisfaccion_cliente !== undefined) {
            if (satisfaccion_cliente >= 1 && satisfaccion_cliente <= 5) {
                updateFields.push('satisfaccion_cliente = ?');
                params.push(satisfaccion_cliente);
            }
        }

        // Actualizar fecha de última actividad
        updateFields.push('fecha_ultima_actividad = NOW()');

        if (updateFields.length === 1) { // Solo la fecha de actividad
            return res.status(400).json({
                error: 'No hay campos para actualizar'
            });
        }

        params.push(id);

        await db.query(`
            UPDATE conversaciones 
            SET ${updateFields.join(', ')}
            WHERE id = ?
        `, params);

        logger.info(`Conversación ${id} actualizada por ${req.usuario.email}`);

        res.json({
            message: 'Conversación actualizada exitosamente'
        });

    } catch (error) {
        logger.error('Error al actualizar conversación:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Asignar etiquetas a conversación
router.post('/:id/etiquetas', logActivity('asignar_etiqueta'), async (req, res) => {
    try {
        const { id } = req.params;
        const { etiqueta_id } = req.body;

        if (!etiqueta_id) {
            return res.status(400).json({
                error: 'La etiqueta es requerida'
            });
        }

        // Verificar que la conversación existe y acceso
        const conversaciones = await db.query(
            'SELECT equipo_asignado_id, usuario_asignado_id FROM conversaciones WHERE id = ?',
            [id]
        );

        if (conversaciones.length === 0) {
            return res.status(404).json({
                error: 'Conversación no encontrada'
            });
        }

        const conversacion = conversaciones[0];

        // Verificar acceso
        if (req.usuario.rol !== 'admin' && 
            conversacion.equipo_asignado_id !== req.usuario.equipo_id &&
            conversacion.usuario_asignado_id !== req.usuario.id) {
            return res.status(403).json({
                error: 'No tiene acceso a esta conversación'
            });
        }

        // Verificar que la etiqueta existe
        const etiqueta = await db.query(
            'SELECT id FROM etiquetas WHERE id = ? AND activo = 1',
            [etiqueta_id]
        );

        if (etiqueta.length === 0) {
            return res.status(400).json({
                error: 'Etiqueta no válida'
            });
        }

        // Verificar si ya está asignada
        const etiquetaExistente = await db.query(
            'SELECT conversacion_id FROM conversacion_etiquetas WHERE conversacion_id = ? AND etiqueta_id = ?',
            [id, etiqueta_id]
        );

        if (etiquetaExistente.length > 0) {
            return res.status(400).json({
                error: 'La etiqueta ya está asignada a esta conversación'
            });
        }

        // Asignar etiqueta
        await db.query(
            'INSERT INTO conversacion_etiquetas (conversacion_id, etiqueta_id, usuario_id) VALUES (?, ?, ?)',
            [id, etiqueta_id, req.usuario.id]
        );

        logger.info(`Etiqueta ${etiqueta_id} asignada a conversación ${id} por ${req.usuario.email}`);

        res.json({
            message: 'Etiqueta asignada exitosamente'
        });

    } catch (error) {
        logger.error('Error al asignar etiqueta:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Remover etiqueta de conversación
router.delete('/:id/etiquetas/:etiquetaId', logActivity('remover_etiqueta'), async (req, res) => {
    try {
        const { id, etiquetaId } = req.params;

        // Verificar acceso a la conversación
        const conversaciones = await db.query(
            'SELECT equipo_asignado_id, usuario_asignado_id FROM conversaciones WHERE id = ?',
            [id]
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

        // Remover etiqueta
        const result = await db.query(
            'DELETE FROM conversacion_etiquetas WHERE conversacion_id = ? AND etiqueta_id = ?',
            [id, etiquetaId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: 'Etiqueta no encontrada en esta conversación'
            });
        }

        logger.info(`Etiqueta ${etiquetaId} removida de conversación ${id} por ${req.usuario.email}`);

        res.json({
            message: 'Etiqueta removida exitosamente'
        });

    } catch (error) {
        logger.error('Error al remover etiqueta:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

module.exports = router;
