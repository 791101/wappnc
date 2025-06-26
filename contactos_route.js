const express = require('express');
const db = require('../../database_config');
const logger = require('../../logger_config');
const { authenticateToken, requireRole, logActivity } = require('../middleware/auth');

const router = express.Router();

// Aplicar autenticación a todas las rutas
router.use(authenticateToken);

// Obtener todos los contactos
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '', tipo_contacto = '', activo = '' } = req.query;
        const offset = (page - 1) * limit;

        let whereConditions = [];
        let params = [];

        if (search) {
            whereConditions.push('(c.nombre LIKE ? OR c.numero_whatsapp LIKE ? OR c.email LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (tipo_contacto) {
            whereConditions.push('c.tipo_contacto = ?');
            params.push(tipo_contacto);
        }

        if (activo !== '') {
            whereConditions.push('c.activo = ?');
            params.push(activo === 'true' ? 1 : 0);
        }

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        const contactos = await db.query(`
            SELECT 
                c.id, c.numero_whatsapp, c.nombre, c.email, c.tipo_contacto,
                c.empresa, c.ciudad, c.estado, c.fecha_primer_contacto, 
                c.fecha_ultima_interaccion, c.activo,
                u.nombre as creado_por_nombre,
                (SELECT COUNT(*) FROM conversaciones WHERE contacto_id = c.id) as total_conversaciones
            FROM contactos c
            LEFT JOIN usuarios u ON c.creado_por_usuario_id = u.id
            ${whereClause}
            ORDER BY c.fecha_ultima_interaccion DESC, c.fecha_primer_contacto DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), parseInt(offset)]);

        // Contar total
        const totalResult = await db.query(`
            SELECT COUNT(*) as total
            FROM contactos c
            ${whereClause}
        `, params);

        const total = totalResult[0].total;

        res.json({
            contactos,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        logger.error('Error al obtener contactos:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener contacto por ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const contactos = await db.query(`
            SELECT 
                c.*, u.nombre as creado_por_nombre
            FROM contactos c
            LEFT JOIN usuarios u ON c.creado_por_usuario_id = u.id
            WHERE c.id = ?
        `, [id]);

        if (contactos.length === 0) {
            return res.status(404).json({
                error: 'Contacto no encontrado'
            });
        }

        // Obtener conversaciones del contacto
        const conversaciones = await db.query(`
            SELECT 
                c.id, c.estado, c.prioridad, c.titulo, c.fecha_inicio, c.fecha_ultima_actividad,
                a.nombre as asunto_nombre,
                e.nombre as equipo_nombre,
                u.nombre as usuario_asignado_nombre
            FROM conversaciones c
            LEFT JOIN asuntos a ON c.asunto_id = a.id
            LEFT JOIN equipos e ON c.equipo_asignado_id = e.id
            LEFT JOIN usuarios u ON c.usuario_asignado_id = u.id
            WHERE c.contacto_id = ?
            ORDER BY c.fecha_ultima_actividad DESC
        `, [id]);

        const contacto = contactos[0];
        contacto.conversaciones = conversaciones;

        res.json(contacto);

    } catch (error) {
        logger.error('Error al obtener contacto:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Crear nuevo contacto
router.post('/', logActivity('crear_contacto'), async (req, res) => {
    try {
        const { 
            numero_whatsapp, nombre, email, tipo_contacto, empresa, 
            direccion, ciudad, estado, codigo_postal, notas 
        } = req.body;

        if (!numero_whatsapp) {
            return res.status(400).json({
                error: 'El número de WhatsApp es requerido'
            });
        }

        // Limpiar número de WhatsApp (solo números)
        const numeroLimpio = numero_whatsapp.replace(/\D/g, '');

        // Verificar que el número no exista
        const contactoExistente = await db.query(
            'SELECT id FROM contactos WHERE numero_whatsapp = ?',
            [numeroLimpio]
        );

        if (contactoExistente.length > 0) {
            return res.status(400).json({
                error: 'Ya existe un contacto con este número de WhatsApp'
            });
        }

        const tiposValidos = ['cliente', 'prospecto', 'proveedor', 'otro'];
        const tipoFinal = tiposValidos.includes(tipo_contacto) ? tipo_contacto : 'prospecto';

        const result = await db.query(`
            INSERT INTO contactos (
                numero_whatsapp, nombre, email, tipo_contacto, empresa,
                direccion, ciudad, estado, codigo_postal, notas, creado_por_usuario_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            numeroLimpio, nombre, email, tipoFinal, empresa,
            direccion, ciudad, estado, codigo_postal, notas, req.usuario.id
        ]);

        logger.info(`Contacto creado: ${numeroLimpio} por ${req.usuario.email}`);

        res.status(201).json({
            message: 'Contacto creado exitosamente',
            id: result.insertId
        });

    } catch (error) {
        logger.error('Error al crear contacto:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Actualizar contacto
router.put('/:id', logActivity('actualizar_contacto'), async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            nombre, email, tipo_contacto, empresa, 
            direccion, ciudad, estado, codigo_postal, notas, activo 
        } = req.body;

        // Verificar que el contacto existe
        const contactoExistente = await db.query(
            'SELECT id FROM contactos WHERE id = ?',
            [id]
        );

        if (contactoExistente.length === 0) {
            return res.status(404).json({
                error: 'Contacto no encontrado'
            });
        }

        // Construir query de actualización
        let updateFields = [];
        let params = [];

        if (nombre !== undefined) {
            updateFields.push('nombre = ?');
            params.push(nombre);
        }

        if (email !== undefined) {
            updateFields.push('email = ?');
            params.push(email);
        }

        if (tipo_contacto) {
            const tiposValidos = ['cliente', 'prospecto', 'proveedor', 'otro'];
            if (tiposValidos.includes(tipo_contacto)) {
                updateFields.push('tipo_contacto = ?');
                params.push(tipo_contacto);
            }
        }

        if (empresa !== undefined) {
            updateFields.push('empresa = ?');
            params.push(empresa);
        }

        if (direccion !== undefined) {
            updateFields.push('direccion = ?');
            params.push(direccion);
        }

        if (ciudad !== undefined) {
            updateFields.push('ciudad = ?');
            params.push(ciudad);
        }

        if (estado !== undefined) {
            updateFields.push('estado = ?');
            params.push(estado);
        }

        if (codigo_postal !== undefined) {
            updateFields.push('codigo_postal = ?');
            params.push(codigo_postal);
        }

        if (notas !== undefined) {
            updateFields.push('notas = ?');
            params.push(notas);
        }

        if (activo !== undefined) {
            updateFields.push('activo = ?');
            params.push(activo ? 1 : 0);
        }

        // Actualizar fecha de última interacción
        updateFields.push('fecha_ultima_interaccion = NOW()');

        if (updateFields.length === 1) { // Solo la fecha de interacción
            return res.status(400).json({
                error: 'No hay campos para actualizar'
            });
        }

        params.push(id);

        await db.query(`
            UPDATE contactos 
            SET ${updateFields.join(', ')}
            WHERE id = ?
        `, params);

        logger.info(`Contacto ${id} actualizado por ${req.usuario.email}`);

        res.json({
            message: 'Contacto actualizado exitosamente'
        });

    } catch (error) {
        logger.error('Error al actualizar contacto:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Buscar contacto por número de WhatsApp
router.get('/whatsapp/:numero', async (req, res) => {
    try {
        const { numero } = req.params;
        const numeroLimpio = numero.replace(/\D/g, '');

        const contactos = await db.query(`
            SELECT 
                c.*, u.nombre as creado_por_nombre
            FROM contactos c
            LEFT JOIN usuarios u ON c.creado_por_usuario_id = u.id
            WHERE c.numero_whatsapp = ? AND c.activo = 1
        `, [numeroLimpio]);

        if (contactos.length === 0) {
            return res.status(404).json({
                error: 'Contacto no encontrado'
            });
        }

        res.json(contactos[0]);

    } catch (error) {
        logger.error('Error al buscar contacto por WhatsApp:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

module.exports = router;
