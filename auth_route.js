const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../../database_config');
const logger = require('../../logger_config');

const router = express.Router();

// Rate limiting específico para login
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // máximo 5 intentos por IP
    message: {
        error: 'Demasiados intentos de login. Intente nuevamente en 15 minutos.'
    },
    skipSuccessfulRequests: true
});

// Login
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                error: 'Email y contraseña son requeridos'
            });
        }

        // Buscar usuario por email
        const usuarios = await db.query(
            `SELECT u.*, e.nombre as equipo_nombre 
             FROM usuarios u 
             LEFT JOIN equipos e ON u.equipo_id = e.id 
             WHERE u.email = ? AND u.activo = 1`,
            [email]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({
                error: 'Credenciales inválidas'
            });
        }

        const usuario = usuarios[0];

        // Verificar contraseña
        const passwordValid = await bcrypt.compare(password, usuario.password_hash);
        if (!passwordValid) {
            return res.status(401).json({
                error: 'Credenciales inválidas'
            });
        }

        // Actualizar último acceso
        await db.query(
            'UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?',
            [usuario.id]
        );

        // Generar JWT
        const token = jwt.sign(
            {
                id: usuario.id,
                email: usuario.email,
                rol: usuario.rol,
                equipo_id: usuario.equipo_id
            },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        // Log de actividad
        await db.query(
            `INSERT INTO logs_actividad (usuario_id, accion, ip_address, user_agent) 
             VALUES (?, 'login', ?, ?)`,
            [usuario.id, req.ip, req.get('User-Agent')]
        );

        logger.info(`Usuario ${usuario.email} inició sesión exitosamente`);

        res.json({
            message: 'Login exitoso',
            token,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre,
                email: usuario.email,
                rol: usuario.rol,
                equipo_id: usuario.equipo_id,
                equipo_nombre: usuario.equipo_nombre,
                telefono: usuario.telefono,
                extension: usuario.extension
            }
        });

    } catch (error) {
        logger.error('Error en login:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Verificar token
router.get('/verify', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({
                error: 'Token no proporcionado'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Verificar que el usuario siga activo
        const usuarios = await db.query(
            `SELECT u.*, e.nombre as equipo_nombre 
             FROM usuarios u 
             LEFT JOIN equipos e ON u.equipo_id = e.id 
             WHERE u.id = ? AND u.activo = 1`,
            [decoded.id]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({
                error: 'Usuario no válido'
            });
        }

        const usuario = usuarios[0];

        res.json({
            valid: true,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre,
                email: usuario.email,
                rol: usuario.rol,
                equipo_id: usuario.equipo_id,
                equipo_nombre: usuario.equipo_nombre,
                telefono: usuario.telefono,
                extension: usuario.extension
            }
        });

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Token inválido'
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Token expirado'
            });
        }

        logger.error('Error en verificación de token:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Cambiar contraseña
router.post('/change-password', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { currentPassword, newPassword } = req.body;

        if (!token) {
            return res.status(401).json({
                error: 'Token no proporcionado'
            });
        }

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: 'Contraseña actual y nueva son requeridas'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                error: 'La nueva contraseña debe tener al menos 6 caracteres'
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Obtener usuario actual
        const usuarios = await db.query(
            'SELECT * FROM usuarios WHERE id = ? AND activo = 1',
            [decoded.id]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({
                error: 'Usuario no válido'
            });
        }

        const usuario = usuarios[0];

        // Verificar contraseña actual
        const passwordValid = await bcrypt.compare(currentPassword, usuario.password_hash);
        if (!passwordValid) {
            return res.status(400).json({
                error: 'Contraseña actual incorrecta'
            });
        }

        // Encriptar nueva contraseña
        const saltRounds = 10;
        const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

        // Actualizar contraseña
        await db.query(
            'UPDATE usuarios SET password_hash = ? WHERE id = ?',
            [newPasswordHash, usuario.id]
        );

        // Log de actividad
        await db.query(
            `INSERT INTO logs_actividad (usuario_id, accion, ip_address, user_agent) 
             VALUES (?, 'change_password', ?, ?)`,
            [usuario.id, req.ip, req.get('User-Agent')]
        );

        logger.info(`Usuario ${usuario.email} cambió su contraseña`);

        res.json({
            message: 'Contraseña actualizada exitosamente'
        });

    } catch (error) {
        logger.error('Error al cambiar contraseña:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

// Logout
router.post('/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);

                // Log de actividad
                await db.query(
                    `INSERT INTO logs_actividad (usuario_id, accion, ip_address, user_agent) 
                     VALUES (?, 'logout', ?, ?)`,
                    [decoded.id, req.ip, req.get('User-Agent')]
                );

                logger.info(`Usuario ID ${decoded.id} cerró sesión`);
            } catch (error) {
                // Token inválido, pero aún así procesamos el logout
            }
        }

        res.json({
            message: 'Logout exitoso'
        });

    } catch (error) {
        logger.error('Error en logout:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
});

module.exports = router;
