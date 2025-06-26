const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../../database_config');
const logger = require('../../logger_config');
const { authenticateToken, requireRole, logActivity } = require('../middleware/auth');

const router = express.Router();

// Aplicar autenticación a todas las rutas
router.use(authenticateToken);

// Obtener todos los usuarios (solo admin)
router.get('/', requireRole('admin'), async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '', equipo_id = '', rol = '', activo = '' } = req.query;
        const offset = (page - 1) * limit;

        let whereConditions = [];
        let params = [];

        if (search) {
            whereConditions.push('(u.nombre LIKE ? OR u.email LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        if (equipo_id) {
            whereConditions.push('u.equipo_id = ?');
            params.push(equipo_id);
        }

        if (rol) {
            whereConditions.push('u.rol = ?');
            params.push(rol);
        }

        if (activo !== '') {
            whereConditions.push('u.activo = ?');
            params.push(activo === 'true' ? 1 : 0);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // Obtener usuarios con información del equipo
        const usuarios = await db.query(`
            SELECT 
                u.id, u.nombre, u.email, u.telefono, u.extension, u.whatsapp,
                u.rol, u.equipo_id, u.activo, u.fecha_creacion, u.ultimo_acceso,
                e.nombre as equipo_nombre
            FROM usuarios u
            LEFT JOIN equipos e ON u.equipo_id = e.id
            ${whereClause}
            ORDER BY u.nombre ASC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), parseInt(offset)]);

        // Contar total
        const totalResult = await db.query(`
            SELECT COUNT(*) as total
            FROM usuarios u
            LEFT JOIN equipos e ON u.equipo_id = e.id
            ${whereClause}
        `, params);

        const total = totalResult[0].total;

        res.json({
            usuarios,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        logger.error('Error al obtener usuarios:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener usuario por ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Solo admin puede ver cualquier usuario, otros solo pueden ver su propio perfil
        if (req.usuario.rol !== 'admin' && parseInt(id) !== req.usuario.id) {
            return res.status(403).json({
                error: 'No tiene permisos para ver este usuario'
            });
        }

        const usuarios = await db.query(`
            SELECT 
                u.id, u.nombre, u.email, u.telefono, u.extension, u.whatsapp,
                u.rol, u.equipo_id, u.activo, u.fecha_creacion, u.ultimo_acceso,
                e.nombre as equipo_nombre
            FROM usuarios u
            LEFT JOIN equipos e ON u.equipo_id = e.id
            WHERE u.id = ?
        `, [id]);

        if (usuarios.length === 0) {
            return res.status(404).json({
                error: 'Usuario no encontrado'
            });
        }

        res.json(usuarios[0]);

    } catch (error) {
        logger.error('Error al obtener usuario:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Crear nuevo usuario (solo admin)
router.post('/', requireRole('admin'), logActivity('crear_usuario'), async (req, res) => {
    try {
        const { nombre, email, telefono, extension, whatsapp, password, rol, equipo_id } = req.body;

        // Validaciones
        if (!nombre || !email || !password || !rol) {
            return res.status(400).json({
                error: 'Nombre, email, contraseña y rol son requeridos'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                error: 'La contraseña debe tener al menos 6 caracteres'
            });
        }

        const rolesValidos = ['admin', 'notario', 'abogado', 'agente'];
        if (!rolesValidos.includes(rol)) {
            return res.status(400).json({
                error: 'Rol inválido'
            });
        }

        // Verificar que el email no exista
        const usuarioExistente = await db.query(
            'SELECT id FROM usuarios WHERE email = ?',
            [email]
        );

        if (usuarioExistente.length > 0) {
            return res.status(400).json({
                error: 'Ya existe un usuario con este email'
            });
        }

        // Verificar que el equipo exista si se proporciona
        if (equipo_id) {
            const equipos = await db.query(
                'SELECT id FROM equipos WHERE id = ? AND activo = 1',
                [equipo_id]
            );

            if (equipos.length === 0) {
                return res.status(400).json({
                    error: 'Equipo no válido'
                });
            }
        }

        // Encriptar contraseña
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Crear usuario
        const result = await db.query(`
            INSERT INTO usuarios (nombre, email, telefono, extension, whatsapp, password_hash, rol, equipo_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [nombre, email, telefono, extension, whatsapp, passwordHash, rol, equipo_id || null]);

        logger.info(`Usuario creado: ${email} por ${req.usuario.email}`);

        res.status(201).json({
            message: 'Usuario creado exitosamente',
            id: result.insertId
        });

    } catch (error) {
        logger.error('Error al crear usuario:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Actualizar usuario
router.put('/:id', logActivity('actualizar_usuario'), async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, email, telefono, extension, whatsapp, rol, equipo_id, activo } = req.body;

        // Solo admin puede actualizar cualquier usuario, otros solo su propio perfil
        if (req.usuario.rol !== 'admin' && parseInt(id) !== req.usuario.id) {
            return res.status(403).json({
                error: 'No tiene permisos para actualizar este usuario'
            });
        }

        // Solo admin puede cambiar rol, equipo y estado activo
        if (req.usuario.rol !== 'admin' && (rol || equipo_id || activo !== undefined)) {
            return res.status(403).json({
                error: 'No tiene permisos para cambiar rol, equipo o estado'
            });
        }

        // Verificar que el usuario existe
        const usuarioExistente = await db.query(
            'SELECT id FROM usuarios WHERE id = ?',
            [id]
        );

        if (usuarioExistente.length === 0) {
            return res.status(404).json({
                error: 'Usuario no encontrado'
            });
        }

        // Verificar email único si se está cambiando
        if (email) {
            const emailExistente = await db.query(
                'SELECT id FROM usuarios WHERE email = ? AND id != ?',
                [email, id]
            );

            if (emailExistente.length > 0) {
                return res.status(400).json({
                    error: 'Ya existe un usuario con este email'
                });
            }
        }

        // Construir query de actualización
        let updateFields = [];
        let params = [];

        if (nombre) {
            updateFields.push('nombre = ?');
            params.push(nombre);
        }
        if (email) {
            updateFields.push('email = ?');
            params.push(email);
        }
        if (telefono !== undefined) {
            updateFields.push('telefono = ?');
            params.push(telefono);
        }
        if (extension !== undefined) {
            updateFields.push('extension = ?');
            params.push(extension);
        }
        if (whatsapp !== undefined) {
            updateFields.push('whatsapp = ?');
            params.push(whatsapp);
        }

        // Solo admin puede cambiar estos campos
        if (req.usuario.rol === 'admin') {
            if (rol) {
                const rolesValidos = ['admin', 'notario', 'abogado', 'agente'];
                if (!rolesValidos.includes(rol)) {
                    return res.status(400).json({
                        error: 'Rol inválido'
                    });
                }
                updateFields.push('rol = ?');
                params.push(rol);
            }
            if (equipo_id !== undefined) {
                updateFields.push('equipo_id = ?');
                params.push(equipo_id || null);
            }
            if (activo !== undefined) {
                updateFields.push('activo = ?');
                params.push(activo ? 1 : 0);
            }
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                error: 'No hay campos para actualizar'
            });
        }

        params.push(id);

        await db.query(`
            UPDATE usuarios 
            SET ${updateFields.join(', ')}
            WHERE id = ?
        `, params);

        logger.info(`Usuario ${id} actualizado por ${req.usuario.email}`);

        res.json({
            message: 'Usuario actualizado exitosamente'
        });

    } catch (error) {
        logger.error('Error al actualizar usuario:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Eliminar usuario (solo admin)
router.delete('/:id', requireRole('admin'), logActivity('eliminar_usuario'), async (req, res) => {
    try {
        const { id } = req.params;

        // No permitir eliminar el propio usuario
        if (parseInt(id) === req.usuario.id) {
            return res.status(400).json({
                error: 'No puede eliminar su propio usuario'
            });
        }

        // Verificar que el usuario existe
        const usuario = await db.query(
            'SELECT nombre, email FROM usuarios WHERE id = ?',
            [id]
        );

        if (usuario.length === 0) {
            return res.status(404).json({
                error: 'Usuario no encontrado'
            });
        }

        // Desactivar en lugar de eliminar para mantener integridad referencial
        await db.query(
            'UPDATE usuarios SET activo = 0 WHERE id = ?',
            [id]
        );

        logger.info(`Usuario ${usuario[0].email} desactivado por ${req.usuario.email}`);

        res.json({
            message: 'Usuario desactivado exitosamente'
        });

    } catch (error) {
        logger.error('Error al eliminar usuario:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener usuarios por equipo
router.get('/equipo/:equipoId', async (req, res) => {
    try {
        const { equipoId } = req.params;

        // Verificar acceso al equipo
        if (req.usuario.rol !== 'admin' && parseInt(equipoId) !== req.usuario.equipo_id) {
            return res.status(403).json({
                error: 'No tiene acceso a este equipo'
            });
        }

        const usuarios = await db.query(`
            SELECT 
                u.id, u.nombre, u.email, u.telefono, u.extension, u.whatsapp,
                u.rol, u.activo, u.ultimo_acceso
            FROM usuarios u
            WHERE u.equipo_id = ? AND u.activo = 1
            ORDER BY u.nombre ASC
        `, [equipoId]);

        res.json(usuarios);

    } catch (error) {
        logger.error('Error al obtener usuarios por equipo:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

module.exports = router;
