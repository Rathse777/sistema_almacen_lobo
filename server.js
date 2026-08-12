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
  if (req.session.usuario.rol !== 'admin') {
    return res.status(403).send('Solo admin puede eliminar productos.');
  }
  db.prepare('DELETE FROM Productos WHERE id_producto = ?').run(req.params.id);
  res.redirect('/productos');
});

// --- Rutas Lotes (CRUD) ---
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
  res.render('lote_form', { lote: null, productos, error: null });
});

app.post('/lotes/nuevo', requiereLogin, (req, res) => {
  try {
    const { id_producto, cantidad, precio_compra, precio_venta, fecha_vencimiento } = req.body;

    if (!id_producto || !cantidad || Number(cantidad) <= 0) {
      const productos = db.prepare('SELECT * FROM Productos').all();
      return res.render('lote_form', { lote: null, productos, error: 'Debe seleccionar un producto y una cantidad válida.' });
    }

    const fechaIngreso = new Date().toISOString().slice(0, 10);
    const isoFechaVenc = fechaAValid(fecha_vencimiento);
    const cant = Number(cantidad);

    const registrarLoteTx = db.transaction(() => {
      // Insertar nuevo lote
      db.prepare(`
        INSERT INTO Lotes (id_producto, cantidad_inicial, cantidad_actual, precio_compra, precio_venta, fecha_ingreso, fecha_vencimiento)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id_producto,
        cant,
        cant,
        Number(precio_compra || 0),
        Number(precio_venta || 0),
        fechaIngreso,
        isoFechaVenc
      );

      // Incrementar el stock_total del producto correspondientemente
      db.prepare(`UPDATE Productos SET stock_total = stock_total + ? WHERE id_producto = ?`).run(cant, id_producto);
    });

    registrarLoteTx();
    res.redirect('/lotes');
  } catch (error) {
    console.error('Error al registrar lote:', error);
    const productos = db.prepare('SELECT * FROM Productos').all();
    res.render('lote_form', { lote: null, productos, error: 'Error al procesar el lote: ' + error.message });
  }
});

app.get('/lotes/:id/editar', requiereLogin, (req, res) => {
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

// --- Rutas Usuarios ---
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
  res.render('venta_form', { productos, error: null, venta: null, detalles: [] });
});

function fechaAValid(fechaDisplay) {
  if (!fechaDisplay) return null;
  if (fechaDisplay.includes('/')) {
    const parts = fechaDisplay.split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
    }
    return fechaDisplay;
  }
  return fechaDisplay;
}

// POST /ventas - registrar venta con lógica FIFO
// server.js (Sección correspondiente a la ruta POST de ventas)

app.post('/ventas', async (req, res) => {
  const { cliente, productos } = req.body; // productos: [{ producto_id, lote_id, cantidad, precio_unitario }]

  if (!productos || !Array.isArray(productos) || productos.length === 0) {
    return res.status(400).json({ error: 'Debe incluir al menos un producto en la venta.' });
  }

  // Iniciar transacción en la base de datos
  const db = require('./db');

  try {
    await db.query('BEGIN TRANSACTION');

    // 1. Insertar el encabezado de la venta
    const resultVenta = await db.query(
      'INSERT INTO ventas (cliente, fecha, total) VALUES (?, DATETIME("now"), ?)',
      [cliente || 'Cliente General', 0]
    );
    const ventaId = resultVenta.lastID;

    let totalVenta = 0;

    // 2. Procesar cada producto de la venta
    for (const item of productos) {
      const { producto_id, lote_id, cantidad, precio_unitario } = item;

      // Verificar que haya suficiente stock en el lote o producto
      let stockQuery = 'SELECT cantidad FROM lotes WHERE id = ?';
      let stockResult = await db.query(stockQuery, [lote_id]);

      if (!stockResult || stockResult.length === 0 || stockResult[0].cantidad < cantidad) {
        throw new Error(`Stock insuficiente para el producto ID ${producto_id} en el lote seleccionado.`);
      }

      // Actualizar el stock del lote
      await db.query(
        'UPDATE lotes SET cantidad = cantidad - ? WHERE id = ?',
        [cantidad, lote_id]
      );

      // Registrar el detalle de la venta
      const subtotal = cantidad * precio_unitario;
      totalVenta += subtotal;

      await db.query(
        'INSERT INTO detalle_ventas (venta_id, producto_id, lote_id, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?, ?)',
        [ventaId, producto_id, lote_id, cantidad, precio_unitario, subtotal]
      );
    }

    // 3. Actualizar el total de la venta
    await db.query('UPDATE ventas SET total = ? WHERE id = ?', [totalVenta, ventaId]);

    // Confirmar transacción
    await db.query('COMMIT');

    res.redirect('/ventas');
  } catch (error) {
    // Revertir cambios si ocurre un error
    await db.query('ROLLBACK');
    console.error('Error al registrar la venta:', error.message);
    res.status(500).render('venta_form', {
      error: 'Error interno del sistema al procesar la venta: ' + error.message,
      title: 'Registrar Venta'
    });
  }
});

app.get('/ventas/:id/editar', requiereLogin, (req, res) => {
  const id = req.params.id;
  const venta = db.prepare('SELECT * FROM Ventas WHERE id_venta = ?').get(id);
  if (!venta) return res.redirect('/ventas');
  const detalles = db.prepare('SELECT dv.*, p.nombre as producto_nombre FROM Detalle_ventas dv JOIN Productos p ON dv.id_producto = p.id_producto WHERE dv.id_venta = ?').all(id);
  const productos = db.prepare('SELECT * FROM Productos').all();
  res.render('venta_form', { productos, error: null, venta, detalles });
});

app.post('/ventas/:id/editar', requiereLogin, (req, res) => {
  const id = req.params.id;
  const venta = db.prepare('SELECT * FROM Ventas WHERE id_venta = ?').get(id);
  if (!venta) return res.status(404).send('Venta no encontrada.');

  const detallesOriginales = db.prepare('SELECT * FROM Detalle_ventas WHERE id_venta = ?').all(id);

  try {
    const editarTransaccion = db.transaction(() => {
      for (const d of detallesOriginales) {
        if (d.id_lote) {
          db.prepare('UPDATE Lotes SET cantidad_actual = cantidad_actual + ? WHERE id_lote = ?').run(d.cantidad, d.id_lote);
        }
        db.prepare('UPDATE Productos SET stock_total = stock_total + ? WHERE id_producto = ?').run(d.cantidad, d.id_producto);
      }
      db.prepare('DELETE FROM Detalle_ventas WHERE id_venta = ?').run(id);

      const { monto_recibido } = req.body;
      db.prepare('UPDATE Ventas SET monto_recibido = ?, total = 0 WHERE id_venta = ?').run(monto_recibido ? Number(monto_recibido) : null, id);

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

      for (const d of nuevosDetalles) {
        db.prepare('INSERT INTO Detalle_ventas (id_venta, id_producto, id_lote, cantidad, precio_unitario) VALUES (?, ?, ?, ?, ?)').run(id, d.id_producto, d.id_lote, d.cantidad, d.precio_unitario);
        db.prepare('UPDATE Lotes SET cantidad_actual = cantidad_actual - ? WHERE id_lote = ?').run(d.cantidad, d.id_lote);
        db.prepare('UPDATE Productos SET stock_total = stock_total - ? WHERE id_producto = ?').run(d.cantidad, d.id_producto);
        nuevoTotal += d.cantidad * d.precio_unitario;
      }

      db.prepare('UPDATE Ventas SET total = ? WHERE id_venta = ?').run(nuevoTotal, id);

      return true;
    });

    editarTransaccion();
    res.redirect('/ventas');
  } catch (e) {
    return res.status(400).send('Error al editar venta: ' + e.message);
  }
});

app.post('/ventas/:id/anular', requiereLogin, (req, res) => {
  const id = req.params.id;
  const venta = db.prepare('SELECT * FROM Ventas WHERE id_venta = ?').get(id);
  if (!venta) return res.status(404).send('Venta no encontrada.');
  if (venta.anulada || venta.anulada === 1) return res.status(400).send('Venta ya anulada.');

  const detalles = db.prepare('SELECT * FROM Detalle_ventas WHERE id_venta = ?').all(id);

  try {
    const anularTx = db.transaction(() => {
      for (const d of detalles) {
        if (d.id_lote) {
          db.prepare('UPDATE Lotes SET cantidad_actual = cantidad_actual + ? WHERE id_lote = ?').run(d.cantidad, d.id_lote);
        }
        db.prepare('UPDATE Productos SET stock_total = stock_total + ? WHERE id_producto = ?').run(d.cantidad, d.id_producto);
      }
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
  let csv = 'id_producto,nombre,codigo,categoria,stock_total,stock_minimo,precio_venta,fecha_vencimiento\n';
  for (const p of productos) {
    csv += `${p.id_producto},"${p.nombre}","${p.codigo || ''}","${p.categoria_nombre || ''}",${p.stock_total},${p.stock_minimo},${p.precio_venta || 0},"${p.fecha_vencimiento || ''}"\n`;
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=productos.csv');
  res.send(csv);
});

app.get('/export/ventas', requiereLogin, requiereAdmin, (req, res) => {
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

// Ruta para ver los Reportes
app.get('/reportes', requiereLogin, async (req, res) => {
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