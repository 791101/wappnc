module.exports = {
  apps: [{
    name: 'notaria-whatsapp-backend',
    script: 'src/server.js',
    cwd: '/opt/notaria-whatsapp-backend',
    instances: 2,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    log_file: './logs/app/combined.log',
    out_file: './logs/app/out.log',
    error_file: './logs/app/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=1024',
    watch: false,
    ignore_watch: ['node_modules', 'logs', 'uploads', 'backups'],
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};