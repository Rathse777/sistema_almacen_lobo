// seed.js
// Inserta datos de ejemplo: 2 usuarios (admin y cajero), 3 categorías, 4 productos con lotes y algunas ventas.
// Uso: node seed.js  (o npm run seed)
// Comentarios en español explicando cada bloque.

const { db, formatoBolivares } = require('./db');
const fs = require('fs');
const path = require('path');

// NOTA IMPORTANTE:
// EN PRODUCCIÓN: las contraseñas NO deben guardarse en texto plano.
// Use hashing (bcrypt) y buenas prácticas de seguridad.
// Aquí las guardamos en texto plano por simplicidad y didáctica.

function limpiarDatos() {
  // Borrar datos si existen (para permitir re-seed)
  const tablas = ['Detalle_ventas','Ventas','Lotes','Productos','Categorias','Usuarios','TasaCambio'];
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const t of tablas) {
    try {
      db.prepare(`DELETE FROM ${t};`).run();
      db.prepare(`DELETE FROM sqlite_sequence WHERE name='${t}';`).run();
    } catch (e) {
      // Si la tabla no existe, ignorar
    }
  }
  db.exec('PRAGMA foreign_keys = ON;');
}

function seed() {
  limpiarDatos();

  // Usuarios
  const insertUsuario = db.prepare('INSERT INTO Usuarios (nombre, rol, contraseña) VALUES (?, ?, ?)');
  insertUsuario.run('admin', 'admin', 'adminpass');
  insertUsuario.run('cajero', 'cajero', 'cajeropass');

  // Categorias
  const insertCategoria = db.prepare('INSERT INTO Categorias (nombre) VALUES (?)');
  insertCategoria.run('Abarrotes');
  insertCategoria.run('Bebidas');
  insertCategoria.run('Limpieza');

  // Tasa de Cambio (ejemplo: 1 USD = 40 Bs)
  const insertTasa = db.prepare('INSERT INTO TasaCambio (valor, fecha, creado_por) VALUES (?, ?, ?)');
  const hoyISO = new Date().toISOString().slice(0,10);
  insertTasa.run(40.0, hoyISO, 1);

  // Productos
  const insertProducto = db.prepare(`INSERT INTO Productos
    (nombre, codigo, descripcion, id_categoria, stock_total, stock_minimo, precio_venta, precio_venta_bs, fecha_vencimiento)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  // Fechas en ISO
  const dentro10Dias = new Date(Date.now() + 10*24*3600*1000).toISOString().slice(0,10);
  const vencido = new Date(Date.now() - 5*24*3600*1000).toISOString().slice(0,10);

  const precio1 = 1.50;
  const precio2 = 2.00;
  const precio3 = 4.00;
  const precio4 = 3.50;
  const tasa = 40.0;

  insertProducto.run('Arroz 1kg', 'ARZ-1', 'Arroz blanco paquete 1kg', 1, 50, 5, precio1, precio1 * tasa, dentro10Dias);
  insertProducto.run('Gaseosa 2L', 'GAS-2', 'Bebida gaseosa 2 litros', 2, 20, 3, precio2, precio2 * tasa, dentro10Dias);
  insertProducto.run('Jabón en polvo 1kg', 'JAB-1', 'Detergente en polvo', 3, 8, 2, precio3, precio3 * tasa, vencido);
  insertProducto.run('Aceite 1L', 'ACE-1', 'Aceite comestible 1 litro', 1, 12, 2, precio4, precio4 * tasa, hoyISO);

  // Lotes (vinculados a productos)
  const insertLote = db.prepare(`INSERT INTO Lotes
    (id_producto, cantidad_inicial, cantidad_actual, precio_compra, precio_venta, precio_venta_bs, fecha_ingreso, fecha_vencimiento)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  // Arroz: un lote
  insertLote.run(1, 30, 30, 0.90, 1.50, 60.0, new Date(Date.now() - 20*24*3600*1000).toISOString().slice(0,10), dentro10Dias);

  // Gaseosa: un lote
  insertLote.run(2, 20, 20, 1.20, 2.00, 80.0, new Date().toISOString().slice(0,10), dentro10Dias);

  // Jabón: un lote vencido
  insertLote.run(3, 8, 8, 2.20, 4.00, 160.0, new Date(Date.now() - 60*24*3600*1000).toISOString().slice(0,10), vencido);

  // Aceite: un lote con fecha hoy
  insertLote.run(4, 12, 12, 2.50, 3.50, 140.0, new Date().toISOString().slice(0,10), hoyISO);

  // Ventas de ejemplo (dos ventas)
  const insertVenta = db.prepare(`INSERT INTO Ventas (fecha, total, total_bs, monto_recibido, id_usuario, anulada, tasa_cambio) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertDetalle = db.prepare(`INSERT INTO Detalle_ventas (id_venta, id_producto, id_lote, cantidad, precio_unitario, precio_unitario_bs) VALUES (?, ?, ?, ?, ?, ?)`);

  // Venta 1: 2 arroz y 1 gaseosa
  const fecha1 = new Date().toISOString().slice(0,10);
  const total1 = 1.50*2 + 2.00*1;
  const total1Bs = total1 * 40;
  const result1 = insertVenta.run(fecha1, total1, total1Bs, 200.00, 2, 0, 40);
  const idVenta1 = result1.lastInsertRowid;
  insertDetalle.run(idVenta1, 1, 1, 2, 1.50, 60.0);
  insertDetalle.run(idVenta1, 2, 3, 1, 2.00, 80.0);

  // Actualizar stock_total y lotes
  db.prepare('UPDATE Lotes SET cantidad_actual = cantidad_actual - ? WHERE id_lote = ?').run(2, 1);
  db.prepare('UPDATE Productos SET stock_total = stock_total - ? WHERE id_producto = ?').run(2, 1);
  db.prepare('UPDATE Lotes SET cantidad_actual = cantidad_actual - ? WHERE id_lote = ?').run(1, 3);
  db.prepare('UPDATE Productos SET stock_total = stock_total - ? WHERE id_producto = ?').run(1, 2);

  console.log('Seed completado con datos de ejemplo.');
}

seed();