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
  if (valor === undefined || valor === null || isNaN(valor)) return '$0.00';
  return `$${Number(valor).toFixed(2)}`;
}

// Helper: formatea moneda en bolívares con separador de miles
function formatoBolivares(valor) {
  if (valor === undefined || valor === null || isNaN(valor)) return 'Bs 0,00';
  return `Bs ${Number(valor).toLocaleString('es-VE', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2,
    useGrouping: true
  })}`;
}

// Helper: formatea moneda en bolívares sin el símbolo Bs (para data attributes)
function formatoBolivaresNumero(valor) {
  if (valor === undefined || valor === null || isNaN(valor)) return '0.00';
  return Number(valor).toFixed(2);
}

// Helper: convierte dólares a bolívares usando la tasa actual
function convertirABolivares(valorDolar, tasa) {
  if (!tasa || tasa <= 0) return 0;
  return valorDolar * tasa;
}

// Obtener la tasa de cambio actual
function getTasaActual() {
  const tasa = db.prepare('SELECT valor, fecha FROM TasaCambio ORDER BY fecha DESC LIMIT 1').get();
  return tasa;
}

// Obtener la tasa de cambio en una fecha específica
function getTasaByDate(fecha) {
  const tasa = db.prepare('SELECT valor FROM TasaCambio WHERE fecha = ?').get(fecha);
  return tasa ? tasa.valor : null;
}

// db.js - Agregar al final
const PDFDocument = require('pdfkit');

// Helper para exportar ventas a PDF
function exportarVentasPDF(ventas, res) {
  const doc = new PDFDocument({ margin: 50 });
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=ventas.pdf');
  
  doc.pipe(res);

  // Título
  doc.fontSize(20)
     .text('Reporte de Ventas - Sistema Lobo', { align: 'center' });
  doc.moveDown();
  
  // Fecha del reporte
  doc.fontSize(10)
     .text(`Generado: ${new Date().toLocaleString()}`, { align: 'right' });
  doc.moveDown();

  // Tabla de ventas
  const tableTop = doc.y;
  const tableHeaders = ['ID', 'Fecha', 'Usuario', 'Total ($)', 'Total (Bs)', 'Estado'];
  const columnWidths = [40, 80, 100, 80, 100, 80];
  let y = tableTop;

  // Encabezados
  doc.fontSize(10);
  let x = 50;
  tableHeaders.forEach((header, i) => {
    doc.text(header, x, y, { width: columnWidths[i], align: 'center' });
    x += columnWidths[i];
  });
  y += 20;

  // Línea separadora
  doc.moveTo(50, y - 5)
     .lineTo(50 + columnWidths.reduce((a, b) => a + b, 0), y - 5)
     .stroke();

  // Datos
  ventas.forEach((v, index) => {
    x = 50;
    const rowY = y + (index * 20);
    
    // Color alternante para filas
    if (index % 2 === 0) {
      doc.rect(50, rowY - 2, columnWidths.reduce((a, b) => a + b, 0), 18)
         .fill('#f5f5f5');
    }

    doc.fillColor('black');
    doc.text(`#${v.id_venta}`, x, rowY, { width: columnWidths[0], align: 'center' });
    x += columnWidths[0];
    
    doc.text(formatoFechaMostrar(v.fecha), x, rowY, { width: columnWidths[1], align: 'center' });
    x += columnWidths[1];
    
    doc.text(v.usuario_nombre || 'Sistema', x, rowY, { width: columnWidths[2], align: 'center' });
    x += columnWidths[2];
    
    doc.text(`$${Number(v.total || 0).toFixed(2)}`, x, rowY, { width: columnWidths[3], align: 'center' });
    x += columnWidths[3];
    
    doc.text(`Bs ${Number(v.total_bs || 0).toFixed(2)}`, x, rowY, { width: columnWidths[4], align: 'center' });
    x += columnWidths[4];
    
    const estado = v.anulada ? 'Anulada' : 'Activa';
    const color = v.anulada ? 'red' : 'green';
    doc.fillColor(color)
       .text(estado, x, rowY, { width: columnWidths[5], align: 'center' });
    doc.fillColor('black');
  });

  // Total general
  const totalGeneral = ventas.reduce((sum, v) => sum + (v.total || 0), 0);
  const totalGeneralBs = ventas.reduce((sum, v) => sum + (v.total_bs || 0), 0);
  const yFinal = y + (ventas.length * 20) + 20;

  doc.moveTo(50, yFinal - 10)
     .lineTo(50 + columnWidths.reduce((a, b) => a + b, 0), yFinal - 10)
     .stroke();

  doc.fontSize(12)
     .text('Total General:', 50, yFinal, { width: 150, align: 'left' });
  doc.text(`$${totalGeneral.toFixed(2)}`, 50 + 150, yFinal, { width: 100, align: 'center' });
  doc.text(`Bs ${totalGeneralBs.toFixed(2)}`, 50 + 250, yFinal, { width: 100, align: 'center' });

  doc.end();
}

// Helper para exportar productos a PDF
function exportarProductosPDF(productos, res) {
  const doc = new PDFDocument({ margin: 50 });
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=productos.pdf');
  
  doc.pipe(res);

  doc.fontSize(20)
     .text('Catálogo de Productos - Sistema Lobo', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10)
     .text(`Generado: ${new Date().toLocaleString()}`, { align: 'right' });
  doc.moveDown();

  const tableHeaders = ['ID', 'Nombre', 'Código', 'Categoría', 'Stock', 'Precio ($)', 'Precio (Bs)'];
  const columnWidths = [30, 120, 70, 100, 50, 70, 90];
  let y = doc.y;

  doc.fontSize(9);
  let x = 50;
  tableHeaders.forEach((header, i) => {
    doc.text(header, x, y, { width: columnWidths[i], align: 'center' });
    x += columnWidths[i];
  });
  y += 18;

  doc.moveTo(50, y - 3)
     .lineTo(50 + columnWidths.reduce((a, b) => a + b, 0), y - 3)
     .stroke();

  productos.forEach((p, index) => {
    x = 50;
    const rowY = y + (index * 18);
    
    if (index % 2 === 0) {
      doc.rect(50, rowY - 2, columnWidths.reduce((a, b) => a + b, 0), 16)
         .fill('#f5f5f5');
    }

    doc.fillColor('black');
    doc.text(`#${p.id_producto}`, x, rowY, { width: columnWidths[0], align: 'center' });
    x += columnWidths[0];
    
    doc.text(p.nombre, x, rowY, { width: columnWidths[1], align: 'left' });
    x += columnWidths[1];
    
    doc.text(p.codigo || '-', x, rowY, { width: columnWidths[2], align: 'center' });
    x += columnWidths[2];
    
    doc.text(p.categoria_nombre || 'Sin categoría', x, rowY, { width: columnWidths[3], align: 'center' });
    x += columnWidths[3];
    
    doc.text(String(p.stock_total || 0), x, rowY, { width: columnWidths[4], align: 'center' });
    x += columnWidths[4];
    
    doc.text(`$${Number(p.precio_venta || 0).toFixed(2)}`, x, rowY, { width: columnWidths[5], align: 'center' });
    x += columnWidths[5];
    
    doc.text(`Bs ${Number(p.precio_venta_bs || 0).toFixed(2)}`, x, rowY, { width: columnWidths[6], align: 'center' });
  });

  doc.end();
}

// Exportar las nuevas funciones
module.exports = {
  db,
  formatoFechaMostrar,
  fechaAIso,
  formatoMoneda,
  formatoBolivares,
  convertirABolivares,
  getTasaActual,
  getTasaByDate,
  exportarVentasPDF,
  exportarProductosPDF
};