// migrate.js
// Lee schema.sql y ejecuta las sentencias para crear la base de datos.
// Uso: node migrate.js  (o npm run migrate si está configurado en package.json)

const fs = require('fs');
const path = require('path');
const { db } = require('./db');

function ejecutarMigracion() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  console.log('Leyendo schema.sql desde', schemaPath);
  const sql = fs.readFileSync(schemaPath, 'utf8');

  // Ejecutar cada sentencia separada por ';' de forma segura
  // Nota: schema.sql está diseñado para ejecutarse completo, usamos exec directamente
  try {
    db.exec(sql);
    console.log('Migración completada. Base de datos creada/actualizada en data/sistema_lobo.db');
  } catch (err) {
    console.error('Error al ejecutar migración:', err.message);
    process.exit(1);
  }
}

ejecutarMigracion();