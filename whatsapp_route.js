const express = require('express');
const axios = require('axios');
const db = require('../../database_config');
const logger = require('../../logger_config');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Webhook para recibir mensajes de WhatsApp (sin autenticación)
router.post('/webhook', async (req, res) => {
    try {
        const body = req.body;

        // Verificar que es una notificación de WhatsApp
        if (body.object === 'whatsapp_business_account') {
            const entries = body.entry || [];

            for (const entry of entries) {
                const changes = entry.changes || [];

                for (const change of changes) {
                    if (change.field === 'messages') {
                        const value = change.value;

                        // Procesar mensajes recibidos
                        if (value.messages) {
                            for (const message of value.messages) {
                                await procesarMensajeEntrante(message, value.contacts);
                            }
                        }

                        // Procesar estados de mensajes
                        if (value.statuses) {
                            for (const status of value.statuses) {
                                await procesarEstadoMensaje(status);
                            }
                        }
                    }
                }
            }
        }

        res.status(200).send('OK');

    } catch (error) {
        logger.error('Error en webhook de WhatsApp:', error);
        res.status(500).send('Error');
    }
});

// Función para procesar mensajes entrantes
async function procesarMensajeEntrante(message, contacts) {
    try {
        const numeroRemitente = message.from;
        const tipoMensaje = message.type;
        let contenido = '';
        let archivoUrl = null;
        let archivoNombre = null;
        let archivoTipo = null;
        let archivoTamaño = null;

        // Extraer contenido según el tipo de mensaje
        switch (tipoMensaje) {
            case 'text':
                contenido = message.text.body;
                break;
            case 'image':
                contenido = message.image.caption || 'Imagen';
                archivoUrl = message.image.id; // ID del archivo en WhatsApp
                archivoTipo = message.image.mime_type;
                break;
            case 'document':
                contenido = message.document.caption || message.document.filename || 'Documento';
                archivoUrl = message.document.id;
                archivoNombre = message.document.filename;
                archivoTipo = message.document.mime_type;
                break;
            case 'audio':
                contenido = 'Mensaje de audio';
                archivoUrl = message.audio.id;
                archivoTipo = message.audio.mime_type;
                break;
            case 'video':
                contenido = message.video.caption || 'Video';
                archivoUrl = message.video.id;
                archivoTipo = message.video.mime_type;
                break;
            case 'location':
                contenido = `Ubicación: ${message.location.latitude}, ${message.location.longitude}`;
                break;
            default:
                contenido = `Mensaje de tipo: ${tipoMensaje}`;
        }

        // Buscar o crear contacto
        let contacto = await db.query(
            'SELECT id FROM contactos WHERE numero_whatsapp = ?',
            [numeroRemitente]
        );

        let contactoId;
        if (contacto.length === 0) {
            // Crear nuevo contacto
            const nombreContacto = contacts && contacts[0] ? contacts[0].profile.name : numeroRemitente;

            const result = await db.query(`
                INSERT INTO contactos (numero_whatsapp, nombre, tipo_contacto, fecha_ultima_interaccion)
                VALUES (?, ?, 'prospecto', NOW())
            `, [numeroRemitente, nombreContacto]);

            contactoId = result.insertId;
            logger.info(`Nuevo contacto creado: ${numeroRemitente}`);
        } else {
            contactoId = contacto[0].id;

            // Actualizar fecha de última interacción
            await db.query(
                'UPDATE contactos SET fecha_ultima_interaccion = NOW() WHERE id = ?',
                [contactoId]
            );
        }

        // Buscar conversación activa o crear nueva
        let conversacion = await db.query(`
            SELECT id FROM conversaciones 
            WHERE contacto_id = ? AND estado != 'cerrado'
            ORDER BY fecha_ultima_actividad DESC
            LIMIT 1
        `, [contactoId]);

        let conversacionId;
        if (conversacion.length === 0) {
            // Crear nueva conversación
            const result = await db.query(`
                INSERT INTO conversaciones (contacto_id, estado, titulo, fecha_ultima_actividad)
                VALUES (?, 'nuevo', ?, NOW())
            `, [contactoId, `Conversación con ${numeroRemitente}`]);

            conversacionId = result.insertId;
            logger.info(`Nueva conversación creada: ${conversacionId}`);
        } else {
            conversacionId = conversacion[0].id;

            // Actualizar fecha de última actividad
            await db.query(
                'UPDATE conversaciones SET fecha_ultima_actividad = NOW() WHERE id = ?',
                [conversacionId]
            );
        }

        // Guardar mensaje
        await db.query(`
            INSERT INTO mensajes (
                conversacion_id, whatsapp_message_id, tipo_mensaje, direccion,
                remitente_numero, contenido, archivo_url, archivo_nombre,
                archivo_tipo, archivo_tamaño, metadata
            ) VALUES (?, ?, ?, 'entrante', ?, ?, ?, ?, ?, ?, ?)
        `, [
            conversacionId, message.id, tipoMensaje, numeroRemitente,
            contenido, archivoUrl, archivoNombre, archivoTipo, archivoTamaño,
            JSON.stringify(message)
        ]);

        logger.info(`Mensaje entrante procesado: ${message.id}`);

    } catch (error) {
        logger.error('Error al procesar mensaje entrante:', error);
    }
}

// Función para procesar estados de mensajes
async function procesarEstadoMensaje(status) {
    try {
        const messageId = status.id;
        const estado = status.status; // sent, delivered, read, failed

        let updateField = '';
        switch (estado) {
            case 'delivered':
                updateField = 'fecha_entrega = NOW()';
                break;
            case 'read':
                updateField = 'fecha_lectura = NOW()';
                break;
            case 'failed':
                updateField = 'fecha_entrega = NULL, fecha_lectura = NULL';
                break;
        }

        if (updateField) {
            await db.query(
                `UPDATE mensajes SET ${updateField} WHERE whatsapp_message_id = ?`,
                [messageId]
            );
        }

    } catch (error) {
        logger.error('Error al procesar estado de mensaje:', error);
    }
}

// Aplicar autenticación a las rutas siguientes
router.use(authenticateToken);

// Enviar mensaje de WhatsApp
router.post('/enviar', async (req, res) => {
    try {
        const { numero, mensaje, tipo = 'text' } = req.body;

        if (!numero || !mensaje) {
            return res.status(400).json({
                error: 'Número y mensaje son requeridos'
            });
        }

        const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

        if (!accessToken || !phoneNumberId) {
            return res.status(500).json({
                error: 'Configuración de WhatsApp incompleta'
            });
        }

        // Preparar payload según el tipo de mensaje
        let payload = {
            messaging_product: 'whatsapp',
            to: numero,
            type: tipo
        };

        if (tipo === 'text') {
            payload.text = { body: mensaje };
        }

        // Enviar mensaje a WhatsApp API
        const response = await axios.post(
            `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`,
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        logger.info(`Mensaje enviado a WhatsApp: ${numero}`);

        res.json({
            message: 'Mensaje enviado exitosamente',
            whatsapp_message_id: response.data.messages[0].id
        });

    } catch (error) {
        logger.error('Error al enviar mensaje de WhatsApp:', error);

        if (error.response) {
            res.status(error.response.status).json({
                error: 'Error de WhatsApp API',
                details: error.response.data
            });
        } else {
            res.status(500).json({
                error: 'Error interno del servidor'
            });
        }
    }
});

// Obtener configuración de WhatsApp (solo admin)
router.get('/config', requireRole('admin'), async (req, res) => {
    try {
        const config = await db.query(`
            SELECT clave, valor, descripcion
            FROM configuraciones
            WHERE clave IN ('whatsapp_webhook_token', 'whatsapp_access_token', 'whatsapp_phone_number_id')
        `);

        const configObj = {};
        config.forEach(item => {
            configObj[item.clave] = {
                valor: item.valor ? '***configurado***' : '',
                descripcion: item.descripcion
            };
        });

        res.json(configObj);

    } catch (error) {
        logger.error('Error al obtener configuración de WhatsApp:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Actualizar configuración de WhatsApp (solo admin)
router.put('/config', requireRole('admin'), async (req, res) => {
    try {
        const { webhook_token, access_token, phone_number_id } = req.body;

        const updates = [];
        if (webhook_token !== undefined) {
            updates.push(['whatsapp_webhook_token', webhook_token]);
        }
        if (access_token !== undefined) {
            updates.push(['whatsapp_access_token', access_token]);
        }
        if (phone_number_id !== undefined) {
            updates.push(['whatsapp_phone_number_id', phone_number_id]);
        }

        for (const [clave, valor] of updates) {
            await db.query(
                'UPDATE configuraciones SET valor = ? WHERE clave = ?',
                [valor, clave]
            );
        }

        logger.info(`Configuración de WhatsApp actualizada por ${req.usuario.email}`);

        res.json({
            message: 'Configuración actualizada exitosamente'
        });

    } catch (error) {
        logger.error('Error al actualizar configuración de WhatsApp:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

module.exports = router;
