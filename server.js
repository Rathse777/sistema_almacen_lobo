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
        secure: false
    }
}));

// --- Middleware de autenticación y control por rol ---
app.use((req, res, next) => {
    res.locals.usuario = req.session.usuario || null;
    next();
});

function requiereLogin(req, res, next) {
  if (req.session && req.session.usuario) {
    res.locals.usuario = req.session.usuario;
    return next();
  }
  return res.redirect('/login');
}

function requiereAdmin(req, res, next) {
  if (req.session && req.session.usuario && req.session.usuario.rol === 'admin') {
    return next();
  }
  return res.status(403).send('Acceso denegado: se requiere rol admin.');
}

app.locals.formatoFechaMostrar = formatoFechaMostrar;
app.locals.formatoMoneda = formatoMoneda;

// --- Rutas de autenticación ---
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { nombre, contraseña } = req.body;
  if (!nombre || !contraseña) {
    return res.render('login', { error: 'Debe completar usuario y contraseña.' });
  }
  const fila = db.prepare('SELECT * FROM Usuarios WHERE nombre = ? AND contraseña = ?').get(nombre, contraseña);
  if (!fila) {
    return res.render('login', { error: 'Credenciales inválidas.' });
  }
  req.session.usuario = { Id_usuario: fila.Id_usuario, nombre: fila.nombre, rol: fila.rol };
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// --- Dashboard ---
app.get('/', requiereLogin, (req, res) => {
  try {
    const hoy = new Date().toISOString().slice(0, 10);

    // 1. Total de productos
    const productos = db.prepare('SELECT id_producto FROM Productos').all();

    // 2. Total de ingresos
    const ingresos = db.prepare('SELECT SUM(total) AS total FROM Ventas WHERE (anulada = 0 OR anulada IS NULL)').get();
    const totalIngresos = ingresos ? (ingresos.total || 0) : 0;

    // 3. Cantidad de ventas
    const totalVentas = db.prepare('SELECT COUNT(*) AS total FROM Ventas WHERE (anulada = 0 OR anulada IS NULL)').get();
    const ventasRealizadas = totalVentas ? totalVentas.total : 0;

    // 4. Ventas de hoy
    const ventasHoy = db.prepare(`
      SELECT * FROM Ventas 
      WHERE fecha = ? AND (anulada = 0 OR anulada IS NULL)
      ORDER BY id_venta DESC
    `).all(hoy);

    const totalHoy = ventasHoy.reduce((acc, v) => acc + (v.total || 0), 0);

    // 5. Alertas de Stock Mínimo
    const alertasStock = db.prepare(`
      SELECT id_producto, nombre, stock_total, stock_minimo 
      FROM Productos 
      WHERE stock_total <= stock_minimo
    `).all();

    // 6. Alertas de Vencimiento
    const alertasVencimiento = db.prepare(`
      SELECT 
        l.id_lote, 
        l.fecha_vencimiento, 
        l.cantidad_actual, 
        p.nombre AS producto,
        CASE 
          WHEN l.fecha_vencimiento < date('now', 'localtime') THEN 'vencido'
          ELSE 'por_vencer'
        END AS estado_vencimiento
      FROM Lotes l
      JOIN Productos p ON l.id_producto = p.id_producto
      WHERE l.cantidad_actual > 0 
        AND l.fecha_vencimiento IS NOT NULL 
        AND l.fecha_vencimiento <= date('now', 'localtime', '+30 days')
      ORDER BY l.fecha_vencimiento ASC
    `).all();

    res.render('index', {
      productos,
      totalIngresos,
      ventasRealizadas,
      ventasHoy,
      totalHoy,
      alertasStock,
      alertasVencimiento
    });

  } catch (error) {
    console.error('Error al cargar el Dashboard:', error);
    res.status(500).send('Error al cargar el inicio');
  }
});

// --- Rutas Categorias ---
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

// --- Rutas Productos ---
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

// --- Rutas Lotes ---
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

// Alias opcional por si el formulario envía a /lotes
app.post('/lotes', requiereLogin, (req, res) => {
  res.redirect(307, '/lotes/nuevo');
});

app.post('/lotes/nuevo', requiereLogin, (req, res) => {
  try {
    const { id_producto, producto_id, cantidad, cantidad_inicial, precio_compra, precio_venta, fecha_vencimiento } = req.body;

    // Normalizar los valores recibidos desde el formulario EJS
    const idProd = id_producto || producto_id;
    const cantNum = Number(cantidad || cantidad_inicial || 0);

    if (!idProd || cantNum <= 0) {
      const productos = db.prepare('SELECT * FROM Productos ORDER BY nombre ASC').all();
      return res.render('lote_form', { lote: null, productos, error: 'Debe seleccionar un producto y una cantidad válida.' });
    }

    const fechaIngreso = new Date().toISOString().slice(0, 10);
    const isoFechaVenc = fechaAValid(fecha_vencimiento);

    const registrarLoteTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO Lotes (id_producto, cantidad_inicial, cantidad_actual, precio_compra, precio_venta, fecha_ingreso, fecha_vencimiento)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        idProd,
        cantNum,
        cantNum,
        Number(precio_compra || 0),
        Number(precio_venta || 0),
        fechaIngreso,
        isoFechaVenc
      );

      // Incrementar el stock total del producto
      db.prepare(`UPDATE Productos SET stock_total = stock_total + ? WHERE id_producto = ?`).run(cantNum, idProd);
    });

    registrarLoteTx();
    res.redirect('/lotes');
  } catch (error) {
    console.error('Error al registrar lote:', error);
    const productos = db.prepare('SELECT * FROM Productos ORDER BY nombre ASC').all();
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
  const productos = db.prepare('SELECT * FROM Productos WHERE stock_total > 0 ORDER BY nombre ASC').all();
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

// POST /ventas - Registrar Venta Simplificada
app.post('/ventas', requiereLogin, (req, res) => {
  try {
    let { producto_id, cantidad, monto_recibido } = req.body;

    if (!producto_id) {
      const productos = db.prepare('SELECT * FROM Productos WHERE stock_total > 0 ORDER BY nombre ASC').all();
      return res.render('venta_form', { productos, error: 'Debe incluir al menos un producto en la venta.', venta: null, detalles: [] });
    }

    // Normalizar a arreglos si se envía un solo ítem
    if (!Array.isArray(producto_id)) producto_id = [producto_id];
    if (!Array.isArray(cantidad)) cantidad = [cantidad];

    const fechaHoy = new Date().toISOString().slice(0, 10);
    const idUsuario = req.session.usuario ? req.session.usuario.Id_usuario : null;

    // Sanitizar monto_recibido para evitar errores con cadenas vacías
    const montoNumerico = (monto_recibido !== undefined && monto_recibido !== '' && !isNaN(monto_recibido)) 
      ? Number(monto_recibido) 
      : null;

    const procesarVentaTx = db.transaction(() => {
      // 1. Crear el registro principal de la venta
      const resultVenta = db.prepare(
        'INSERT INTO Ventas (fecha, total, monto_recibido, id_usuario, anulada) VALUES (?, 0, ?, ?, 0)'
      ).run(fechaHoy, montoNumerico, idUsuario);

      const idVenta = resultVenta.lastInsertRowid;
      let totalVenta = 0;

      // 2. Procesar cada producto ingresado
      for (let i = 0; i < producto_id.length; i++) {
        const idp = Number(producto_id[i]);
        const cantRequerida = Number(cantidad[i]);

        if (!idp || isNaN(cantRequerida) || cantRequerida <= 0) continue;

        const producto = db.prepare('SELECT * FROM Productos WHERE id_producto = ?').get(idp);
        if (!producto || producto.stock_total < cantRequerida) {
          throw new Error(`Stock insuficiente para el producto: ${producto ? producto.nombre : 'ID ' + idp}`);
        }

        let restante = cantRequerida;

        // Buscar lotes disponibles por FIFO (el más antiguo primero)
        const lotes = db.prepare(`
          SELECT * FROM Lotes 
          WHERE id_producto = ? AND cantidad_actual > 0 
          ORDER BY fecha_ingreso ASC, id_lote ASC
        `).all(idp);

        for (const lote of lotes) {
          if (restante <= 0) break;

          const uso = Math.min(restante, lote.cantidad_actual);
          const precioUnit = (lote.precio_venta && lote.precio_venta > 0) 
            ? lote.precio_venta 
            : (producto.precio_venta || 0);

          db.prepare(`
            INSERT INTO Detalle_ventas (id_venta, id_producto, id_lote, cantidad, precio_unitario) 
            VALUES (?, ?, ?, ?, ?)
          `).run(idVenta, idp, lote.id_lote, uso, precioUnit);

          db.prepare('UPDATE Lotes SET cantidad_actual = cantidad_actual - ? WHERE id_lote = ?').run(uso, lote.id_lote);

          totalVenta += uso * precioUnit;
          restante -= uso;
        }

        // Si la cantidad requerida supera lo que había en lotes pero hay stock general del producto
        if (restante > 0) {
          const precioUnit = producto.precio_venta || 0;
          db.prepare(`
            INSERT INTO Detalle_ventas (id_venta, id_producto, id_lote, cantidad, precio_unitario) 
            VALUES (?, ?, NULL, ?, ?)
          `).run(idVenta, idp, restante, precioUnit);

          totalVenta += restante * precioUnit;
        }

        // Actualizar el stock acumulado del producto
        db.prepare('UPDATE Productos SET stock_total = stock_total - ? WHERE id_producto = ?').run(cantRequerida, idp);
      }

      // 3. Actualizar el total definitivo calculado
      db.prepare('UPDATE Ventas SET total = ? WHERE id_venta = ?').run(totalVenta, idVenta);
    });

    procesarVentaTx();
    res.redirect('/ventas');

  } catch (e) {
    console.error('Error al registrar venta:', e);
    const productos = db.prepare('SELECT * FROM Productos WHERE stock_total > 0 ORDER BY nombre ASC').all();
    res.render('venta_form', { 
      productos, 
      error: 'Error al registrar venta: ' + e.message, 
      venta: null, 
      detalles: [] 
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

// --- Export CSV ---
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

// --- API de búsqueda ---
app.get('/api/productos/buscar', requiereLogin, (req, res) => {
  const q = req.query.q || '';
  const filas = db.prepare('SELECT * FROM Productos WHERE nombre LIKE ? OR codigo LIKE ? LIMIT 20').all(`%${q}%`, `%${q}%`);
  res.json(filas);
});

// Ruta de Reportes
// Ruta para ver los Reportes (Cálculo en tiempo real desde la BD)
app.get('/reportes', requiereLogin, (req, res) => {
  try {
    const hoy = new Date().toISOString().slice(0, 10);

    // 1. Total vendido hoy
    const ventasHoy = db.prepare('SELECT SUM(total) AS total FROM Ventas WHERE fecha = ? AND (anulada = 0 OR anulada IS NULL)').get(hoy);
    const totalVentasHoy = ventasHoy.total || 0;

    // 2. Cantidad de ventas realizadas hoy
    const cantHoy = db.prepare('SELECT COUNT(*) AS cantidad FROM Ventas WHERE fecha = ? AND (anulada = 0 OR anulada IS NULL)').get(hoy);
    const cantidadVentasHoy = cantHoy.cantidad || 0;

    // 3. Total histórico de ventas (no anuladas)
    const ventasHistorico = db.prepare('SELECT SUM(total) AS total FROM Ventas WHERE (anulada = 0 OR anulada IS NULL)').get();
    const totalVentasHistorico = ventasHistorico.total || 0;

    // 4. Top 5 productos más vendidos
    const topProductos = db.prepare(`
      SELECT p.nombre, SUM(dv.cantidad) AS total_vendido, SUM(dv.cantidad * dv.precio_unitario) AS total_recaudado
      FROM Detalle_ventas dv
      JOIN Ventas v ON dv.id_venta = v.id_venta
      JOIN Productos p ON dv.id_producto = p.id_producto
      WHERE (v.anulada = 0 OR v.anulada IS NULL)
      GROUP BY p.id_producto
      ORDER BY total_vendido DESC
      LIMIT 5
    `).all();

    // 5. Últimas 10 ventas registradas
    const ultimasVentas = db.prepare(`
      SELECT v.*, u.nombre AS usuario_nombre
      FROM Ventas v
      LEFT JOIN Usuarios u ON v.id_usuario = u.Id_usuario
      WHERE (v.anulada = 0 OR v.anulada IS NULL)
      ORDER BY v.id_venta DESC
      LIMIT 10
    `).all();

    res.render('reportes', {
      totalVentasHoy,
      cantidadVentasHoy,
      totalVentasHistorico,
      topProductos,
      ultimasVentas
    });
  } catch (error) {
    console.error('Error al generar reportes:', error);
    res.status(500).send('Error interno del servidor al cargar los reportes');
  }
});

// Inicio del servidor
app.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
});