const jwt = require('jsonwebtoken');
const db = require('../../database_config');
const logger = require('../../logger_config');

// Middleware de autenticación
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            return res.status(401).json({
                error: 'Token de acceso requerido'
            });
        }

        // Verificar token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Verificar que el usuario siga activo en la BD
        const usuarios = await db.query(
            `SELECT u.*, e.nombre as equipo_nombre 
             FROM usuarios u 
             LEFT JOIN equipos e ON u.equipo_id = e.id 
             WHERE u.id = ? AND u.activo = 1`,
            [decoded.id]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({
                error: 'Usuario no válido o inactivo'
            });
        }

        // Agregar información del usuario a la request
        req.usuario = {
            id: usuarios[0].id,
            nombre: usuarios[0].nombre,
            email: usuarios[0].email,
            rol: usuarios[0].rol,
            equipo_id: usuarios[0].equipo_id,
            equipo_nombre: usuarios[0].equipo_nombre
        };

        next();

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(403).json({
                error: 'Token inválido'
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(403).json({
                error: 'Token expirado'
            });
        }

        logger.error('Error en middleware de autenticación:', error);
        res.status(500).json({
            error: 'Error interno del servidor'
        });
    }
};

// Middleware para verificar roles
const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.usuario) {
            return res.status(401).json({
                error: 'Usuario no autenticado'
            });
        }

        if (!roles.includes(req.usuario.rol)) {
            return res.status(403).json({
                error: 'No tiene permisos para realizar esta acción'
            });
        }

        next();
    };
};

// Middleware para verificar equipo
const requireTeam = (req, res, next) => {
    if (!req.usuario) {
        return res.status(401).json({
            error: 'Usuario no autenticado'
        });
    }

    if (!req.usuario.equipo_id && req.usuario.rol !== 'admin') {
        return res.status(403).json({
            error: 'Usuario debe estar asignado a un equipo'
        });
    }

    next();
};

// Middleware para verificar acceso a recursos del equipo
const requireTeamAccess = (req, res, next) => {
    if (!req.usuario) {
        return res.status(401).json({
            error: 'Usuario no autenticado'
        });
    }

    // Los admins pueden acceder a todo
    if (req.usuario.rol === 'admin') {
        return next();
    }

    // Verificar si el recurso pertenece al equipo del usuario
    const equipoId = req.params.equipoId || req.body.equipo_id || req.query.equipo_id;

    if (equipoId && parseInt(equipoId) !== req.usuario.equipo_id) {
        return res.status(403).json({
            error: 'No tiene acceso a recursos de este equipo'
        });
    }

    next();
};

// Middleware para logging de actividad
const logActivity = (accion) => {
    return async (req, res, next) => {
        try {
            if (req.usuario) {
                await db.query(
                    `INSERT INTO logs_actividad (usuario_id, accion, tabla_afectada, ip_address, user_agent) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [
                        req.usuario.id,
                        accion,
                        req.baseUrl.replace('/api/', ''),
                        req.ip,
                        req.get('User-Agent')
                    ]
                );
            }
        } catch (error) {
            logger.error('Error al registrar actividad:', error);
            // No interrumpir el flujo por error de logging
        }
        next();
    };
};

module.exports = {
    authenticateToken,
    requireRole,
    requireTeam,
    requireTeamAccess,
    logActivity
};
