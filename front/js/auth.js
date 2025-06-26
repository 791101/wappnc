// Sistema de autenticación para Notaría Correa
class AuthService {
    static users = [
        // Notario principal (acceso total)
        { username: 'gce', password: '123', name: 'Gerardo Correa Etchegaray', role: 'notario', group: 'equipo-gce' },

        // Jefes de equipo
        { username: 'rtc', password: '123', name: 'Raul Trinidad Combaluzier', role: 'jefe', group: 'equipo-rtc' },
        { username: 'acr', password: '123', name: 'Aida Cabrera Rodríguez', role: 'jefe', group: 'equipo-acr' },
        { username: 'jvp', password: '123', name: 'Juan Carlos Velázquez Pérez', role: 'jefe', group: 'equipo-jvp' },
        { username: 'djz', password: '123', name: 'Dagny Juárez Zamorategui', role: 'jefe', group: 'equipo-djz' },
        { username: 'fce', password: '123', name: 'Fernando Correa Etchegaray', role: 'jefe', group: 'equipo-fce' },
        { username: 'llt', password: '123', name: 'Leonardo Lerdo de Tejada', role: 'jefe', group: 'equipo-llt' },
        { username: 'sld', password: '123', name: 'Silvia Luis Díaz', role: 'jefe', group: 'equipo-sld' },

        // Agentes de ejemplo (puedes agregar más)
        { username: 'agente1', password: '123', name: 'Agente GCE 1', role: 'agente', group: 'equipo-gce' },
        { username: 'agente2', password: '123', name: 'Agente FCE 1', role: 'agente', group: 'equipo-fce' },
        { username: 'agente3', password: '123', name: 'Agente RTC 1', role: 'agente', group: 'equipo-rtc' }
    ];

    static login(username, password) {
        const user = this.users.find(u => u.username === username && u.password === password);
        if (user) {
            localStorage.setItem('currentUser', JSON.stringify(user));
            return user;
        }
        return null;
    }

    static logout() {
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
    }

    static getCurrentUser() {
        const userStr = localStorage.getItem('currentUser');
        return userStr ? JSON.parse(userStr) : null;
    }

    static isLoggedIn() {
        return this.getCurrentUser() !== null;
    }
}