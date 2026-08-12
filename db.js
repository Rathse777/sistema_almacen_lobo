// db.js
// Conexión y utilidades para SQLite usando better-sqlite3.
// Exporta la instancia db y helpers de formato.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Asegurarse de que exista la carpeta data/
const carpetaData = path.join(__dirname, 'data');
if (!fs.existsSync(carpetaData)) {
  fs.mkdirSync(carpetaData, { recursive: true });
}

// Archivo de base de datos
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'sistema_lobo.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Abrir conexión (se crea el archivo si no existe)
const db = new Database(dbPath);

// Helper: formatea fecha ISO (yyyy-mm-dd) a dd/mm/yyyy para mostrar en UI
function formatoFechaMostrar(fechaIso) {
  if (!fechaIso) return '';
  const d = new Date(fechaIso);
  if (isNaN(d)) return fechaIso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Helper: convierte dd/mm/yyyy a ISO yyyy-mm-dd (usado en formularios)
function fechaAIso(fechaDisplay) {
  if (!fechaDisplay) return null;
  const partes = fechaDisplay.split('/');
  if (partes.length !== 3) return fechaDisplay;
  const [dd, mm, yyyy] = partes;
  return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
}

// Helper: formatea moneda a $ con 2 decimales
function formatoMoneda(valor) {
  return `$${Number(valor || 0).toFixed(2)}`;
}

module.exports = {
  db,
  formatoFechaMostrar,
  fechaAIso,
  formatoMoneda
};
