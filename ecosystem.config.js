module.exports = {
  apps: [
    {
      name: "transport-pixelate",
      cwd: "./backend",
      script: "src/server.js",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
