const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const db = require('../../database_config');
const logger = require('../../logger_config');
const { authenticateToken, logActivity } = require('../middleware/auth');

const router = express.Router();

// Configurar multer para subida de archivos
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads');
        try {
            await fs.mkdir(uploadDir, { recursive: true });
            cb(null, uploadDir);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + extension);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    },
    fileFilter: (req, file, cb) => {
        // Tipos de archivo permitidos
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf', 'application/msword', 
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain', 'text/csv'
        ];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de archivo no permitido'), false);
        }
    }
});

// Aplicar autenticación a todas las rutas
router.use(authenticateToken);

// Subir archivo
router.post('/upload', upload.single('archivo'), logActivity('subir_archivo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: 'No se proporcionó archivo'
            });
        }

        const { conversacion_id, mensaje_id } = req.body;

        // Verificar acceso a la conversación si se proporciona
        if (conversacion_id) {
            const conversaciones = await db.query(
                'SELECT equipo_asignado_id, usuario_asignado_id FROM conversaciones WHERE id = ?',
                [conversacion_id]
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
        }

        // Guardar información del archivo en BD
        const result = await db.query(`
            INSERT INTO archivos (
                nombre_original, nombre_archivo, ruta_local, tipo_mime, tamaño_bytes,
                conversacion_id, mensaje_id, subido_por_usuario_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            req.file.originalname,
            req.file.filename,
            req.file.path,
            req.file.mimetype,
            req.file.size,
            conversacion_id || null,
            mensaje_id || null,
            req.usuario.id
        ]);

        logger.info(`Archivo subido: ${req.file.originalname} por ${req.usuario.email}`);

        res.json({
            message: 'Archivo subido exitosamente',
            archivo: {
                id: result.insertId,
                nombre_original: req.file.originalname,
                nombre_archivo: req.file.filename,
                tamaño: req.file.size,
                tipo: req.file.mimetype,
                url: `/api/archivos/download/${result.insertId}`
            }
        });

    } catch (error) {
        logger.error('Error al subir archivo:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Descargar archivo
router.get('/download/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const archivos = await db.query(`
            SELECT 
                a.*, c.equipo_asignado_id, c.usuario_asignado_id
            FROM archivos a
            LEFT JOIN conversaciones c ON a.conversacion_id = c.id
            WHERE a.id = ? AND a.activo = 1
        `, [id]);

        if (archivos.length === 0) {
            return res.status(404).json({
                error: 'Archivo no encontrado'
            });
        }

        const archivo = archivos[0];

        // Verificar acceso
        if (archivo.conversacion_id && req.usuario.rol !== 'admin' && 
            archivo.equipo_asignado_id !== req.usuario.equipo_id &&
            archivo.usuario_asignado_id !== req.usuario.id) {
            return res.status(403).json({
                error: 'No tiene acceso a este archivo'
            });
        }

        // Verificar que el archivo existe físicamente
        try {
            await fs.access(archivo.ruta_local);
        } catch (error) {
            return res.status(404).json({
                error: 'Archivo no encontrado en el sistema'
            });
        }

        // Configurar headers para descarga
        res.setHeader('Content-Disposition', `attachment; filename="${archivo.nombre_original}"`);
        res.setHeader('Content-Type', archivo.tipo_mime);

        // Enviar archivo
        res.sendFile(path.resolve(archivo.ruta_local));

    } catch (error) {
        logger.error('Error al descargar archivo:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Obtener archivos de una conversación
router.get('/conversacion/:conversacionId', async (req, res) => {
    try {
        const { conversacionId } = req.params;

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

        const archivos = await db.query(`
            SELECT 
                a.id, a.nombre_original, a.nombre_archivo, a.tipo_mime, 
                a.tamaño_bytes, a.fecha_subida,
                u.nombre as subido_por_nombre
            FROM archivos a
            LEFT JOIN usuarios u ON a.subido_por_usuario_id = u.id
            WHERE a.conversacion_id = ? AND a.activo = 1
            ORDER BY a.fecha_subida DESC
        `, [conversacionId]);

        res.json(archivos);

    } catch (error) {
        logger.error('Error al obtener archivos de conversación:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Eliminar archivo
router.delete('/:id', logActivity('eliminar_archivo'), async (req, res) => {
    try {
        const { id } = req.params;

        const archivos = await db.query(`
            SELECT 
                a.*, c.equipo_asignado_id, c.usuario_asignado_id
            FROM archivos a
            LEFT JOIN conversaciones c ON a.conversacion_id = c.id
            WHERE a.id = ? AND a.activo = 1
        `, [id]);

        if (archivos.length === 0) {
            return res.status(404).json({
                error: 'Archivo no encontrado'
            });
        }

        const archivo = archivos[0];

        // Verificar acceso (solo admin o quien subió el archivo)
        if (req.usuario.rol !== 'admin' && archivo.subido_por_usuario_id !== req.usuario.id) {
            return res.status(403).json({
                error: 'No tiene permisos para eliminar este archivo'
            });
        }

        // Marcar como inactivo en lugar de eliminar
        await db.query(
            'UPDATE archivos SET activo = 0 WHERE id = ?',
            [id]
        );

        logger.info(`Archivo ${id} eliminado por ${req.usuario.email}`);

        res.json({
            message: 'Archivo eliminado exitosamente'
        });

    } catch (error) {
        logger.error('Error al eliminar archivo:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

module.exports = router;
