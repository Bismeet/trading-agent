// deploy/ecosystem.config.cjs — PM2 process manager config for 24x7 hosting.
module.exports = {
  apps: [
    {
      name: "fabinvests-engine",
      script: "scripts/v2/engine.mjs",
      cwd: __dirname + "/..",
      autorestart: true,
      max_restarts: 50,
      restart_delay: 10000, // 10s backoff between crash restarts
      stop_exit_codes: [0], // clean exit (lock loss) does not count as crash
      time: true,
      out_file: "data/pm2-engine.out.log",
      error_file: "data/pm2-engine.err.log",
    },
    {
      name: "fabinvests-web",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3002",
      cwd: __dirname + "/../web",
      autorestart: true,
      time: true,
      out_file: "../data/pm2-web.out.log",
      error_file: "../data/pm2-web.err.log",
    },
  ],
};
