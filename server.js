// server.js
// Servidor Express principal que sirve UI EJS y maneja lógica de negocio.
// Incluye autenticación en memoria con express-session, control de roles,
// CRUD de productos, lotes, categorías, usuarios y registro de ventas con FIFO.

const express = require('express');
const session = require('express-session');
const path = require('path');
const { db, formatoFechaMostrar, fechaAIso, formatoMoneda } = require('./db');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'secreto_temporal_sistema_lobo';

// --- Configuración Express ---
const engine = require('ejs-mate'); // permite usar <% layout('layout') %> y bloques
app.engine('ejs', engine);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Depuración: verificar que la carpeta views existe
console.log('Carpeta views:', path.join(__dirname, 'views'));
if (fs.existsSync(path.join(__dirname, 'views'))) {
  console.log('Archivos en views:', fs.readdirSync(path.join(__dirname, 'views')));
} else {
  console.error('❌ La carpeta views no existe!');
}

// Configuración de sesiones en memoria
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false // Mantener en false si no usas un proxy HTTPS estricto en la app
    }
}));

// --- Middleware de autenticación y control por rol ---
app.use((req, res, next) => {
    res.locals.usuario = req.session.usuario || null;
    next();
});

// Comprueba que el usuario esté logueado
function requiereLogin(req, res, next) {
  if (req.session && req.session.usuario) {
    res.locals.usuario = req.session.usuario; // disponible en vistas
    return next();
  }
  return res.redirect('/login');
}

// Comprueba que el usuario sea admin
function requiereAdmin(req, res, next) {
  if (req.session && req.session.usuario && req.session.usuario.rol === 'admin') {
    return next();
  }
  return res.status(403).send('Acceso denegado: se requiere rol admin.');
}

// Helper: formatea fecha para mostrar (dd/mm/yyyy)
app.locals.formatoFechaMostrar = formatoFechaMostrar;
app.locals.formatoMoneda = formatoMoneda;

// --- Rutas de autenticación ---

// GET /login - formulario de login
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// POST /login - procesa el login (simple, contraseñas en texto plano)
app.post('/login', (req, res) => {
  const { nombre, contraseña } = req.body;
  if (!nombre || !contraseña) {
    return res.render('login', { error: 'Debe completar usuario y contraseña.' });
  }
  const fila = db.prepare('SELECT * FROM Usuarios WHERE nombre = ? AND contraseña = ?').get(nombre, contraseña);
  if (!fila) {
    return res.render('login', { error: 'Credenciales inválidas.' });
  }
  // Guardar usuario en sesión (solo datos necesarios)
  req.session.usuario = { Id_usuario: fila.Id_usuario, nombre: fila.nombre, rol: fila.rol };
  res.redirect('/');
});

// GET /logout - cerrar sesión
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// --- Dashboard ---
app.get('/', requiereLogin, (req, res) => {
  // Mostrar alertas: productos con stock <= 5 y resumen ventas del día
  const alertasStock = db.prepare('SELECT id_producto, nombre, stock_total FROM Productos WHERE stock_total <= 5').all();

  // Ventas de hoy y total vendido
  const hoy = new Date().toISOString().slice(0,10);
  const ventasHoy = db.prepare('SELECT * FROM Ventas WHERE fecha = ? AND anulada = 0').all(hoy);
  const totalHoy = ventasHoy.reduce((s, v) => s + v.total, 0);

  res.render('index', { alertasStock, ventasHoy, totalHoy });
});

// --- Rutas Categorias (CRUD mínimo) ---
app.get('/categorias', requiereLogin, (req, res) => {
  const categorias = db.prepare('SELECT * FROM Categorias').all();
  res.render('categorias', { categorias });
});

app.get('/categorias/nuevo', requiereLogin, (req, res) => {
  res.render('categoria_form', { categoria: null, error: null });
});

app.post('/categorias', requiereLogin, (req, res) => {
  const { nombre } = req.body;
  if (!nombre || nombre.trim() === '') {
    return res.render('categoria_form', { categoria: null, error: 'Nombre obligatorio.' });
  }
  try {
    db.prepare('INSERT INTO Categorias (nombre) VALUES (?)').run(nombre.trim());
    res.redirect('/categorias');
  } catch (e) {
    res.render('categoria_form', { categoria: null, error: 'Error al crear categoría: ' + e.message });
  }
});

// --- Rutas Productos (CRUD) ---
app.get('/productos', requiereLogin, (req, res) => {
  const productos = db.prepare(`
    SELECT p.*, c.nombre AS categoria_nombre
    FROM Productos p LEFT JOIN Categorias c ON p.id_categoria = c.id_categoria
    ORDER BY p.nombre
  `).all();
  res.render('productos', { productos });
});

app.get('/productos/nuevo', requiereLogin, (req, res) => {
  const categorias = db.prepare('SELECT * FROM Categorias').all();
  res.render('producto_form', { producto: null, categorias, error: null });
});

app.post('/productos', requiereLogin, (req, res) => {
  // Cajero puede crear, admin también
  const { nombre, codigo, descripcion, id_categoria, stock_total, stock_minimo, precio_venta, fecha_vencimiento } = req.body;
  if (!nombre || Number(stock_total) < 0) {
    const categorias = db.prepare('SELECT * FROM Categorias').all();
    return res.render('producto_form', { producto: null, categorias, error: 'Campos obligatorios o inválidos.' });
  }
  const isoFecha = fechaAValid(fecha_vencimiento);
  db.prepare(`INSERT INTO Productos
    (nombre, codigo, descripcion, id_categoria, stock_total, stock_minimo, precio_venta, fecha_vencimiento)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    nombre, codigo, descripcion || null, id_categoria || null, Number(stock_total || 0), Number(stock_minimo || 0), Number(precio_venta || 0), isoFecha
  );
  res.redirect('/productos');
});

app.get('/productos/:id/editar', requiereLogin, (req, res) => {
  const producto = db.prepare('SELECT * FROM Productos WHERE id_producto = ?').get(req.params.id);
  if (!producto) return res.redirect('/productos');
  const categorias = db.prepare('SELECT * FROM Categorias').all();
  res.render('producto_form', { producto, categorias, error: null });
});

app.post('/productos/:id/editar', requiereLogin, (req, res) => {
  // Solo admin puede editar
  if (req.session.usuario.rol !== 'admin') {
    return res.status(403).send('Solo admin puede editar productos.');
  }
  const { nombre, codigo, descripcion, id_categoria, stock_total, stock_minimo, precio_venta, fecha_vencimiento } = req.body;
  const isoFecha = fechaAValid(fecha_vencimiento);
  db.prepare(`UPDATE Productos SET
    nombre = ?, codigo = ?, descripcion = ?, id_categoria = ?, stock_total = ?, stock_minimo = ?, precio_venta = ?, fecha_vencimiento = ?
    WHERE id_producto = ?`).run(
    nombre, codigo, descripcion || null, id_categoria || null, Number(stock_total || 0), Number(stock_minimo || 0), Number(precio_venta || 0), isoFecha, req.params.id
  );
  res.redirect('/productos');
});

app.post('/productos/:id/eliminar', requiereLogin, (req, res) => {
  // Solo admin puede eliminar
  if (req.session.usuario.rol !== 'admin') {
    return res.status(403).send('Solo admin puede eliminar productos.');
  }
  db.prepare('DELETE FROM Productos WHERE id_producto = ?').run(req.params.id);
  res.redirect('/productos');
});

// --- Rutas Lotes (CRUD mínimo) ---
app.get('/lotes', requiereLogin, (req, res) => {
  const lotes = db.prepare(`
    SELECT l.*, p.nombre AS producto_nombre
    FROM Lotes l JOIN Productos p ON l.id_producto = p.id_producto
    ORDER BY l.fecha_ingreso DESC
  `).all();
  res.render('lotes', { lotes });
});

app.get('/lotes/nuevo', requiereLogin, (req, res) => {
  const productos = db.prepare('SELECT * FROM Productos').all();
 return res.render('venta_form', { productos, error: 'Agregue al menos un producto.', venta: null, detalles: [] });
});

app.post('/lotes/nuevo', async (req, res) => {
  try {
    // Extraer variables desde el formulario
    const { producto_id, cantidad, fecha_vencimiento, precio_compra } = req.body;

    // Validación básica de campos requeridos
    if (!producto_id || !cantidad) {
      return res.status(400).send('Faltan campos obligatorios');
    }

    // Consulta de inserción (SQLite / PostgreSQL)
    const sql = `
      INSERT INTO lotes (producto_id, cantidad, fecha_vencimiento, precio_compra)
      VALUES (?, ?, ?, ?)
    `;
    
    await db.run(sql, [producto_id, cantidad, fecha_vencimiento || null, precio_compra || 0]);

    res.redirect('/lotes');
  } catch (error) {
    console.error('Error al registrar lote:', error);
    res.status(500).send('Error interno del servidor al procesar el lote.');
  }
});

app.get('/lotes/:id/editar', requiereLogin, (req, res) => {
  // Solo admin puede editar lotes
  if (req.session.usuario.rol !== 'admin') {
    return res.status(403).send('Solo admin puede editar lotes.');
  }
  const lote = db.prepare('SELECT * FROM Lotes WHERE id_lote = ?').get(req.params.id);
  if (!lote) return res.redirect('/lotes');
  const productos = db.prepare('SELECT * FROM Productos').all();
  res.render('lote_form', { lote, productos, error: null });
});

app.post('/lotes/:id/editar', requiereLogin, (req, res) => {
  if (req.session.usuario.rol !== 'admin') {
    return res.status(403).send('Solo admin puede editar lotes.');
  }
  const { id_producto, cantidad_inicial, cantidad_actual, precio_compra, precio_venta, fecha_ingreso, fecha_vencimiento } = req.body;
  db.prepare(`UPDATE Lotes SET
    id_producto = ?, cantidad_inicial = ?, cantidad_actual = ?, precio_compra = ?, precio_venta = ?, fecha_ingreso = ?, fecha_vencimiento = ?
    WHERE id_lote = ?`).run(
    id_producto, Number(cantidad_inicial || 0), Number(cantidad_actual || 0),
    Number(precio_compra || 0), Number(precio_venta || 0), fechaAValid(fecha_ingreso), fechaAValid(fecha_vencimiento), req.params.id
  );
  res.redirect('/lotes');
});

// --- Rutas Usuarios (listar y crear, solo admin listar) ---
app.get('/usuarios', requiereLogin, requiereAdmin, (req, res) => {
  const usuarios = db.prepare('SELECT * FROM Usuarios').all();
  res.render('usuarios', { usuarios });
});

app.post('/usuarios', requiereLogin, requiereAdmin, (req, res) => {
  const { nombre, rol, contraseña } = req.body;
  if (!nombre || !rol || !contraseña) {
    return res.status(400).send('Campos obligatorios.');
  }
  db.prepare('INSERT INTO Usuarios (nombre, rol, contraseña) VALUES (?, ?, ?)').run(nombre, rol, contraseña);
  res.redirect('/usuarios');
});

// --- Rutas Ventas ---
app.get('/ventas', requiereLogin, (req, res) => {
  // Admin puede ver todas las ventas; cajero solo las suyas
  let ventas;
  if (req.session.usuario.rol === 'admin') {
    ventas = db.prepare('SELECT v.*, u.nombre as usuario_nombre FROM Ventas v LEFT JOIN Usuarios u ON v.id_usuario = u.Id_usuario ORDER BY v.fecha DESC').all();
  } else {
    ventas = db.prepare('SELECT v.*, u.nombre as usuario_nombre FROM Ventas v LEFT JOIN Usuarios u ON v.id_usuario = u.Id_usuario WHERE v.id_usuario = ? ORDER BY v.fecha DESC').all(req.session.usuario.Id_usuario);
  }
  res.render('ventas', { ventas });
});

app.get('/ventas/nuevo', requiereLogin, (req, res) => {
  const productos = db.prepare('SELECT * FROM Productos').all();
  // Pasamos detalles como array vacío para evitar ReferenceError en la plantilla
  res.render('venta_form', { productos, error: null, venta: null, detalles: [] });
});

// Función auxiliar: convierte un string dd/mm/yyyy a ISO; acepta ya ISO
function fechaAValid(fechaDisplay) {
  if (!fechaDisplay) return null;
  // Si viene con '/', asumimos dd/mm/yyyy
  if (fechaDisplay.includes('/')) {
    const parts = fechaDisplay.split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
    }
    return fechaDisplay;
  }
  return fechaDisplay;
}

// POST /ventas - registrar venta con lógica FIFO de lotes
app.post('/ventas', requiereLogin, (req, res) => {
  // Esperamos: productos[] (ids), cantidades[], monto_recibido (opcional)
  // En formularios dinámicos puede recibirse como valores individuales o arrays
  let { producto_id, cantidad, monto_recibido } = req.body;

  // Normalizar a arrays
  if (!Array.isArray(producto_id)) producto_id = producto_id ? [producto_id] : [];
  if (!Array.isArray(cantidad)) cantidad = cantidad ? [cantidad] : [];

  // Validaciones básicas
  if (producto_id.length === 0) {
    const productos = db.prepare('SELECT * FROM Productos').all();
    return res.render('venta_form', { productos, error: 'Agregue al menos un producto.' });
  }

  // Preparar venta
  // 1) Validar stock total por producto
  const lineas = [];
  for (let i = 0; i < producto_id.length; i++) {
    const idp = Number(producto_id[i]);
    const qty = Number(cantidad[i]);
    if (!idp || qty <= 0) {
      return res.status(400).send('Cantidad inválida para un producto.');
    }
    const producto = db.prepare('SELECT * FROM Productos WHERE id_producto = ?').get(idp);
    if (!producto) return res.status(400).send('Producto no encontrado.');
    if (producto.stock_total < qty) {
      return res.status(400).send(`No hay suficiente stock del producto "${producto.nombre}". Stock disponible: ${producto.stock_total}`);
    }
    lineas.push({ id_producto: idp, cantidad: qty, producto });
  }

  // 2) Procesar cada línea con FIFO sobre lotes
  const detallesParaInsertar = []; // {id_producto, id_lote, cantidad, precio_unitario}
  let totalVenta = 0;
  try {
    const insertarVenta = db.prepare('INSERT INTO Ventas (fecha, total, monto_recibido, id_usuario, anulada) VALUES (?, ?, ?, ?, ?)');
    const insertarDetalle = db.prepare('INSERT INTO Detalle_ventas (id_venta, id_producto, id_lote, cantidad, precio_unitario) VALUES (?, ?, ?, ?, ?)');
    const actualizarLote = db.prepare('UPDATE Lotes SET cantidad_actual = ? WHERE id_lote = ?');
    const actualizarProductoStock = db.prepare('UPDATE Productos SET stock_total = stock_total - ? WHERE id_producto = ?');

    const fechaHoy = new Date().toISOString().slice(0,10);

    // Empezar transacción (mejor-sqlite3 maneja transacciones vía transaction)
    const compruebaYRegistra = db.transaction(() => {
      // Primero revisar todo y construir detalles
      for (const linea of lineas) {
        let restante = linea.cantidad;
        // Obtener lotes FIFO del producto con cantidad_actual > 0
        const lotes = db.prepare('SELECT * FROM Lotes WHERE id_producto = ? AND cantidad_actual > 0 ORDER BY fecha_ingreso ASC').all(linea.id_producto);
        for (const lote of lotes) {
          if (restante <= 0) break;
          const uso = Math.min(restante, lote.cantidad_actual);
          // precio unitario: preferir precio del lote, si es 0 usar precio_venta del producto
          const precioUnit = (lote.precio_venta && lote.precio_venta > 0) ? lote.precio_venta : (linea.producto.precio_venta || 0);
          detallesParaInsertar.push({ id_producto: linea.id_producto, id_lote: lote.id_lote, cantidad: uso, precio_unitario: precioUnit });
          restante -= uso;
        }
        if (restante > 0) {
          throw new Error(`Stock insuficiente para el producto "${linea.producto.nombre}" al intentar asignar lotes (concurrencia).`);
        }
      }

      // Calcular totalVenta
      for (const d of detallesParaInsertar) {
        totalVenta += d.cantidad * d.precio_unitario;
      }

      // Insertar venta
      const res = insertarVenta.run(fechaHoy, totalVenta, monto_recibido ? Number(monto_recibido) : null, req.session.usuario.Id_usuario, 0);
      const idVenta = res.lastInsertRowid;

      // Insertar detalle y actualizar lotes/productos
      for (const d of detallesParaInsertar) {
        insertarDetalle.run(idVenta, d.id_producto, d.id_lote, d.cantidad, d.precio_unitario);
        // Reducir cantidad_actual del lote
        const loteActual = db.prepare('SELECT cantidad_actual FROM Lotes WHERE id_lote = ?').get(d.id_lote);
        const nuevaCantidad = loteActual.cantidad_actual - d.cantidad;
        actualizarLote.run(nuevaCantidad, d.id_lote);
        // Reducir stock_total del producto
        actualizarProductoStock.run(d.cantidad, d.id_producto);
      }

      return idVenta;
    });

    const idVentaCreada = compruebaYRegistra();
    // Si pago es efectivo y monto_recibido está presente, retornamos al cliente para mostrar vuelto (frontend controla)
    return res.redirect(`/ventas`);
  } catch (e) {
    return res.status(400).send('Error al registrar venta: ' + e.message);
  }
});

// GET /ventas/:id/editar - mostrar formulario para editar (restaurar y volver a aplicar)
app.get('/ventas/:id/editar', requiereLogin, (req, res) => {
  const id = req.params.id;
  const venta = db.prepare('SELECT * FROM Ventas WHERE id_venta = ?').get(id);
  if (!venta) return res.redirect('/ventas');
  const detalles = db.prepare('SELECT dv.*, p.nombre as producto_nombre FROM Detalle_ventas dv JOIN Productos p ON dv.id_producto = p.id_producto WHERE dv.id_venta = ?').all(id);
  const productos = db.prepare('SELECT * FROM Productos').all();
  res.render('venta_form', { productos, error: null, venta: null, detalles: [] });
});

// POST /ventas/:id/editar - editar la venta (restaurar stock y reaplicar)
app.post('/ventas/:id/editar', requiereLogin, (req, res) => {
  // Para editar, vamos a:
  // 1) Recuperar detalles originales y restaurar stock_total y lotes
  // 2) Eliminar detalles y actualizar venta (anotamos monto_recibido)
  // 3) Procesar nuevas líneas como en creación
  const id = req.params.id;
  const venta = db.prepare('SELECT * FROM Ventas WHERE id_venta = ?').get(id);
  if (!venta) return res.status(404).send('Venta no encontrada.');

  // Obtener detalles originales
  const detallesOriginales = db.prepare('SELECT * FROM Detalle_ventas WHERE id_venta = ?').all(id);

  try {
    const editarTransaccion = db.transaction(() => {
      // Restaurar cada detalle
      for (const d of detallesOriginales) {
        if (d.id_lote) {
          // Restaurar lote
          db.prepare('UPDATE Lotes SET cantidad_actual = cantidad_actual + ? WHERE id_lote = ?').run(d.cantidad, d.id_lote);
        }
        // Restaurar producto stock_total
        db.prepare('UPDATE Productos SET stock_total = stock_total + ? WHERE id_producto = ?').run(d.cantidad, d.id_producto);
      }
      // Borrar detalles antiguos
      db.prepare('DELETE FROM Detalle_ventas WHERE id_venta = ?').run(id);

      // Actualizar campo simple de la venta (monto_recibido si viene)
      const {monto_recibido } = req.body;
      db.prepare('UPDATE Ventas SET monto_recibido = ?, total = 0 WHERE id_venta = ?').run(monto_recibido ? Number(monto_recibido) : null, id);

      // Ahora procesar las nuevas líneas (reusar lógica del POST /ventas)
      let { producto_id, cantidad } = req.body;
      if (!Array.isArray(producto_id)) producto_id = producto_id ? [producto_id] : [];
      if (!Array.isArray(cantidad)) cantidad = cantidad ? [cantidad] : [];

      const lineas = [];
      for (let i = 0; i < producto_id.length; i++) {
        const idp = Number(producto_id[i]);
        const qty = Number(cantidad[i]);
        if (!idp || qty <= 0) {
          throw new Error('Cantidad inválida en edición.');
        }
        const producto = db.prepare('SELECT * FROM Productos WHERE id_producto = ?').get(idp);
        if (!producto) throw new Error('Producto no encontrado en edición.');
        if (producto.stock_total < qty) throw new Error(`Stock insuficiente para producto ${producto.nombre} en edición.`);
        lineas.push({ id_producto: idp, cantidad: qty, producto });
      }

      // Construir nuevos detalles con FIFO
      const nuevosDetalles = [];
      let nuevoTotal = 0;
      for (const linea of lineas) {
        let restante = linea.cantidad;
        const lotes = db.prepare('SELECT * FROM Lotes WHERE id_producto = ? AND cantidad_actual > 0 ORDER BY fecha_ingreso ASC').all(linea.id_producto);
        for (const lote of lotes) {
          if (restante <= 0) break;
          const uso = Math.min(restante, lote.cantidad_actual);
          const precioUnit = (lote.precio_venta && lote.precio_venta > 0) ? lote.precio_venta : (linea.producto.precio_venta || 0);
          nuevosDetalles.push({ id_producto: linea.id_producto, id_lote: lote.id_lote, cantidad: uso, precio_unitario: precioUnit });
          restante -= uso;
        }
        if (restante > 0) throw new Error(`Stock insuficiente para ${linea.producto.nombre} al reasignar lotes.`);
      }

      // Insertar nuevos detalles y actualizar lotes/productos
      for (const d of nuevosDetalles) {
        db.prepare('INSERT INTO Detalle_ventas (id_venta, id_producto, id_lote, cantidad, precio_unitario) VALUES (?, ?, ?, ?, ?)').run(id, d.id_producto, d.id_lote, d.cantidad, d.precio_unitario);
        db.prepare('UPDATE Lotes SET cantidad_actual = cantidad_actual - ? WHERE id_lote = ?').run(d.cantidad, d.id_lote);
        db.prepare('UPDATE Productos SET stock_total = stock_total - ? WHERE id_producto = ?').run(d.cantidad, d.id_producto);
        nuevoTotal += d.cantidad * d.precio_unitario;
      }

      // Actualizar total de la venta
      db.prepare('UPDATE Ventas SET total = ? WHERE id_venta = ?').run(nuevoTotal, id);

      return true;
    });

    editarTransaccion();
    res.redirect('/ventas');
  } catch (e) {
    return res.status(400).send('Error al editar venta: ' + e.message);
  }
});

// POST /ventas/:id/anular - anular (revertir) venta
app.post('/ventas/:id/anular', requiereLogin, (req, res) => {
  const id = req.params.id;
  const venta = db.prepare('SELECT * FROM Ventas WHERE id_venta = ?').get(id);
  if (!venta) return res.status(404).send('Venta no encontrada.');
  if (venta.anulada || venta.anulada === 1) return res.status(400).send('Venta ya anulada.');

  const detalles = db.prepare('SELECT * FROM Detalle_ventas WHERE id_venta = ?').all(id);

  try {
    const anularTx = db.transaction(() => {
      // Restaurar lotes y productos
      for (const d of detalles) {
        if (d.id_lote) {
          db.prepare('UPDATE Lotes SET cantidad_actual = cantidad_actual + ? WHERE id_lote = ?').run(d.cantidad, d.id_lote);
        }
        db.prepare('UPDATE Productos SET stock_total = stock_total + ? WHERE id_producto = ?').run(d.cantidad, d.id_producto);
      }
      // Marcar venta anulada
      db.prepare('UPDATE Ventas SET anulada = 1 WHERE id_venta = ?').run(id);
    });
    anularTx();
    res.redirect('/ventas');
  } catch (e) {
    return res.status(500).send('Error al anular venta: ' + e.message);
  }
});

// --- Export CSV (solo admin) ---
app.get('/export/productos', requiereLogin, requiereAdmin, (req, res) => {
  const productos = db.prepare(`
    SELECT p.*, c.nombre as categoria_nombre FROM Productos p LEFT JOIN Categorias c ON p.id_categoria = c.id_categoria
  `).all();
  // Construir CSV
  let csv = 'id_producto,nombre,codigo,categoria,stock_total,stock_minimo,precio_venta,fecha_vencimiento\n';
  for (const p of productos) {
    csv += `${p.id_producto},"${p.nombre}","${p.codigo || ''}","${p.categoria_nombre || ''}",${p.stock_total},${p.stock_minimo},${p.precio_venta || 0},"${p.fecha_vencimiento || ''}"\n`;
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=productos.csv');
  res.send(csv);
});

app.get('/export/ventas', requiereLogin, requiereAdmin, (req, res) => {
  // Listado de ventas con detalles básicos
  const ventas = db.prepare('SELECT v.*, u.nombre as usuario FROM Ventas v LEFT JOIN Usuarios u ON v.id_usuario = u.Id_usuario ORDER BY v.fecha DESC').all();
  let csv = 'id_venta,fecha,total,monto_recibido,usuario,anulada\n';
  for (const v of ventas) {
    csv += `${v.id_venta},${v.fecha},${v.total},${v.monto_recibido || ''},"${v.usuario || ''}",${v.anulada}\n`;
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=ventas.csv');
  res.send(csv);
});

// --- API mínima para buscar productos (AJAX) ---
app.get('/api/productos/buscar', requiereLogin, (req, res) => {
  const q = req.query.q || '';
  const filas = db.prepare('SELECT * FROM Productos WHERE nombre LIKE ? OR codigo LIKE ? LIMIT 20').all(`%${q}%`, `%${q}%`);
  res.json(filas);
});

// --- Páginas mínimas adicionales ---

// Ruta para ver los Reportes
app.get('/reportes', async (req, res) => {
    try {
        res.render('reportes');
    } catch (error) {
        console.error('Error al cargar reportes:', error);
        res.status(500).send('Error interno del servidor');
    }
});

// Inicio del servidor
app.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
});