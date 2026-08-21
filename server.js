// server.js
// Servidor Express principal que sirve UI EJS y maneja lógica de negocio.
// Incluye autenticación en memoria con express-session, control de roles,
// CRUD de productos, lotes, categorías, usuarios y registro de ventas con FIFO.

const express = require('express');
const session = require('express-session');
const path = require('path');
const { db, 
  formatoFechaMostrar, 
  fechaAIso, 
  formatoMoneda,
  formatoBolivares,
  getTasaActual,
  getTasaByDate,
  exportarVentasPDF,
  exportarProductosPDF } = require('./db');
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

function fechaAValid(fechaDisplay) {
  if (!fechaDisplay) return null;
  // Si viene en formato dd/mm/yyyy
  if (fechaDisplay.includes('/')) {
    const parts = fechaDisplay.split('/');
    if (parts.length === 3) {
      const dd = parts[0].padStart(2, '0');
      const mm = parts[1].padStart(2, '0');
      const yyyy = parts[2];
      return `${yyyy}-${mm}-${dd}`;
    }
    return fechaDisplay;
  }
  // Si ya viene en formato ISO o está vacío
  return fechaDisplay;
}

app.locals.formatoFechaMostrar = formatoFechaMostrar;
app.locals.formatoMoneda = formatoMoneda;
app.locals.formatoBolivares = formatoBolivares;


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

// --- Rutas Tasa de Cambio ---
app.get('/tasa-cambio', requiereLogin, requiereAdmin, (req, res) => {
  const historial = db.prepare('SELECT * FROM TasaCambio ORDER BY fecha DESC LIMIT 30').all();
  const tasaActual = getTasaActual();
  res.render('tasa_cambio', { tasaActual, historial });
});

app.post('/tasa-cambio', requiereLogin, requiereAdmin, (req, res) => {
  try {
    const { valor } = req.body;
    const tasaNum = Number(valor);
    if (!tasaNum || tasaNum <= 0) {
      return res.status(400).send('Valor de tasa inválido');
    }

    const fecha = new Date().toISOString().slice(0, 10);
    const idUsuario = req.session.usuario.Id_usuario;

    // Verificar si ya existe una tasa para hoy
    const existente = db.prepare('SELECT id_tasa FROM TasaCambio WHERE fecha = ?').get(fecha);
    
    // Usar transacción para actualizar precios en bolívares
    const actualizarTasaTx = db.transaction(() => {
      if (existente) {
        // Actualizar la tasa existente
        db.prepare('UPDATE TasaCambio SET valor = ?, creado_por = ? WHERE fecha = ?')
          .run(tasaNum, idUsuario, fecha);
      } else {
        // Insertar nueva tasa
        db.prepare('INSERT INTO TasaCambio (valor, fecha, creado_por) VALUES (?, ?, ?)')
          .run(tasaNum, fecha, idUsuario);
      }

      // Actualizar precios en bolívares de todos los productos
      db.prepare(`UPDATE Productos SET precio_venta_bs = precio_venta * ?`).run(tasaNum);
      
      // Actualizar precios en bolívares de todos los lotes
      db.prepare(`UPDATE Lotes SET precio_venta_bs = precio_venta * ?`).run(tasaNum);
    });

    actualizarTasaTx();
    res.redirect('/tasa-cambio');
  } catch (error) {
    console.error('Error al actualizar tasa:', error);
    res.status(500).send('Error al actualizar la tasa de cambio: ' + error.message);
  }
});

// --- Dashboard ---
app.get('/', requiereLogin, (req, res) => {
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    const tasaActual = getTasaActual();

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
      alertasVencimiento,
      tasaActual
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
// --- Rutas Productos ---
app.get('/productos', requiereLogin, (req, res) => {
  const productos = db.prepare(`
    SELECT p.*, c.nombre AS categoria_nombre
    FROM Productos p LEFT JOIN Categorias c ON p.id_categoria = c.id_categoria
    ORDER BY p.nombre
  `).all();
  const tasaActual = getTasaActual();
  res.render('productos', { productos, tasaActual: tasaActual || { valor: 0 } });
});

app.get('/productos/nuevo', requiereLogin, (req, res) => {
  const categorias = db.prepare('SELECT * FROM Categorias').all();
  const tasaActual = getTasaActual();
  res.render('producto_form', { 
    producto: null, 
    categorias, 
    error: null,
    tasaActual: tasaActual || { valor: 0 }
  });
});

app.post('/productos', requiereLogin, (req, res) => {
  const { nombre, codigo, descripcion, id_categoria, stock_total, stock_minimo, precio_venta, precio_compra, fecha_vencimiento } = req.body;
  
  if (!nombre || Number(stock_total) < 0) {
    const categorias = db.prepare('SELECT * FROM Categorias').all();
    const tasaActual = getTasaActual();
    return res.render('producto_form', { 
      producto: null, 
      categorias, 
      error: 'Campos obligatorios o inválidos.',
      tasaActual: tasaActual || { valor: 0 }
    });
  }

  // Verificar que el código no exista ya
  if (codigo && codigo.trim() !== '') {
    const existente = db.prepare('SELECT id_producto FROM Productos WHERE codigo = ?').get(codigo.trim());
    if (existente) {
      const categorias = db.prepare('SELECT * FROM Categorias').all();
      const tasaActual = getTasaActual();
      return res.render('producto_form', { 
        producto: null, 
        categorias, 
        error: 'El código ya existe. Use un código único.',
        tasaActual: tasaActual || { valor: 0 }
      });
    }
  }

  const isoFecha = fechaAValid(fecha_vencimiento);
  const precioNum = Number(precio_venta || 0);
  const precioCompraNum = Number(precio_compra || 0);
  const stockNum = Number(stock_total || 0);
  const tasaActual = getTasaActual();
  const tasaValor = tasaActual ? tasaActual.valor : 0;
  const precioBs = precioNum * tasaValor;

  try {
    const crearProductoConLote = db.transaction(() => {
      const result = db.prepare(`INSERT INTO Productos
        (nombre, codigo, descripcion, id_categoria, stock_total, stock_minimo, precio_venta, precio_venta_bs, fecha_vencimiento)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        nombre, 
        codigo && codigo.trim() !== '' ? codigo.trim() : null, 
        descripcion || null, 
        id_categoria || null, 
        stockNum, 
        Number(stock_minimo || 0), 
        precioNum, 
        precioBs, 
        isoFecha
      );

      const idProducto = result.lastInsertRowid;
      const fechaIngreso = new Date().toISOString().slice(0, 10);

      db.prepare(`INSERT INTO Lotes
        (id_producto, cantidad_inicial, cantidad_actual, precio_compra, precio_venta, precio_venta_bs, fecha_ingreso, fecha_vencimiento)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        idProducto,
        stockNum,
        stockNum,
        precioCompraNum,
        precioNum,
        precioBs,
        fechaIngreso,
        isoFecha
      );
    });

    crearProductoConLote();
    res.redirect('/productos');
  } catch (error) {
    console.error('Error al crear producto:', error);
    const categorias = db.prepare('SELECT * FROM Categorias').all();
    const tasaActual = getTasaActual();
    res.render('producto_form', { 
      producto: null, 
      categorias, 
      error: 'Error al crear producto: ' + error.message,
      tasaActual: tasaActual || { valor: 0 }
    });
  }
});

app.get('/productos/:id/editar', requiereLogin, (req, res) => {
  const producto = db.prepare('SELECT * FROM Productos WHERE id_producto = ?').get(req.params.id);
  if (!producto) return res.redirect('/productos');
  
  // Obtener el lote más reciente para mostrar precio de compra
  const lote = db.prepare('SELECT precio_compra FROM Lotes WHERE id_producto = ? ORDER BY fecha_ingreso DESC LIMIT 1').get(req.params.id);
  if (lote) {
    producto.precio_compra = lote.precio_compra;
  }
  
  const categorias = db.prepare('SELECT * FROM Categorias').all();
  const tasaActual = getTasaActual();
  res.render('producto_form', { 
    producto, 
    categorias, 
    error: null,
    tasaActual: tasaActual || { valor: 0 }
  });
});

app.post('/productos/:id/editar', requiereLogin, (req, res) => {
  // Permitir edición solo a admin
  if (req.session.usuario.rol !== 'admin') {
    return res.status(403).send('Solo admin puede editar productos.');
  }

  const { nombre, codigo, descripcion, id_categoria, stock_total, stock_minimo, precio_venta, precio_compra, fecha_vencimiento } = req.body;
  const idProducto = req.params.id;
  
  // Verificar que el código no exista ya (excluyendo el producto actual)
  if (codigo && codigo.trim() !== '') {
    const existente = db.prepare('SELECT id_producto FROM Productos WHERE codigo = ? AND id_producto != ?').get(codigo.trim(), idProducto);
    if (existente) {
      const producto = db.prepare('SELECT * FROM Productos WHERE id_producto = ?').get(idProducto);
      const categorias = db.prepare('SELECT * FROM Categorias').all();
      const tasaActual = getTasaActual();
      return res.render('producto_form', { 
        producto, 
        categorias, 
        error: 'El código ya existe. Use un código único.',
        tasaActual: tasaActual || { valor: 0 }
      });
    }
  }

  const isoFecha = fechaAValid(fecha_vencimiento);
  const precioNum = Number(precio_venta || 0);
  const stockNum = Number(stock_total || 0);
  const tasaActual = getTasaActual();
  const tasaValor = tasaActual ? tasaActual.valor : 0;
  const precioBs = precioNum * tasaValor;

  try {
    const actualizarProducto = db.transaction(() => {
      // Actualizar producto
      db.prepare(`UPDATE Productos SET
        nombre = ?, codigo = ?, descripcion = ?, id_categoria = ?, stock_total = ?, stock_minimo = ?, 
        precio_venta = ?, precio_venta_bs = ?, fecha_vencimiento = ?
        WHERE id_producto = ?`).run(
        nombre, 
        codigo && codigo.trim() !== '' ? codigo.trim() : null, 
        descripcion || null, 
        id_categoria || null, 
        stockNum, 
        Number(stock_minimo || 0), 
        precioNum, 
        precioBs, 
        isoFecha, 
        idProducto
      );

      // Actualizar el precio del lote más reciente
      const loteReciente = db.prepare('SELECT id_lote FROM Lotes WHERE id_producto = ? ORDER BY fecha_ingreso DESC LIMIT 1').get(idProducto);
      if (loteReciente) {
        db.prepare('UPDATE Lotes SET precio_venta = ?, precio_venta_bs = ? WHERE id_lote = ?')
          .run(precioNum, precioBs, loteReciente.id_lote);
      }
    });

    actualizarProducto();
    res.redirect('/productos');
  } catch (error) {
    console.error('Error al actualizar producto:', error);
    const producto = db.prepare('SELECT * FROM Productos WHERE id_producto = ?').get(idProducto);
    const categorias = db.prepare('SELECT * FROM Categorias').all();
    const tasaActual = getTasaActual();
    res.render('producto_form', { 
      producto, 
      categorias, 
      error: 'Error al actualizar producto: ' + error.message,
      tasaActual: tasaActual || { valor: 0 }
    });
  }
});

app.post('/productos/:id/eliminar', requiereLogin, (req, res) => {
  // Permitir eliminación solo a admin
  if (req.session.usuario.rol !== 'admin') {
    return res.status(403).send('Solo admin puede eliminar productos.');
  }

  const idProducto = req.params.id;
  
  try {
    db.transaction(() => {
      // Eliminar lotes primero (por la relación de clave foránea)
      db.prepare('DELETE FROM Lotes WHERE id_producto = ?').run(idProducto);
      // Eliminar producto
      db.prepare('DELETE FROM Productos WHERE id_producto = ?').run(idProducto);
    })();
    res.redirect('/productos');
  } catch (error) {
    console.error('Error al eliminar producto:', error);
    res.status(500).send('Error al eliminar producto: ' + error.message);
  }
});

// --- Rutas Lotes ---
app.get('/lotes', requiereLogin, (req, res) => {
  const lotes = db.prepare(`
    SELECT l.*, p.nombre AS producto_nombre
    FROM Lotes l 
    JOIN Productos p ON l.id_producto = p.id_producto
    ORDER BY l.fecha_ingreso DESC
  `).all();
  res.render('lotes', { lotes });
});

app.get('/lotes/nuevo', requiereLogin, (req, res) => {
  // Redirigir a productos ya que ahora se crean automáticamente
  res.redirect('/productos');
});

app.post('/lotes/nuevo', requiereLogin, (req, res) => {
  // Redirigir a productos ya que ahora se crean automáticamente
  res.redirect('/productos');
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

app.post('/usuarios/:id/eliminar', requiereLogin, requiereAdmin, (req, res) => {
  const idEliminar = Number(req.params.id);
  const idActual = req.session.usuario.Id_usuario;

  // Evitar que el administrador se elimine a sí mismo
  if (idEliminar === idActual) {
    return res.status(400).send('No puedes eliminar tu propio usuario.');
  }

  try {
    // Verificar si el usuario tiene ventas registradas
    const ventasAsociadas = db.prepare('SELECT COUNT(*) as total FROM Ventas WHERE id_usuario = ?').get(idEliminar);
    
    if (ventasAsociadas && ventasAsociadas.total > 0) {
      return res.status(400).send('No se puede eliminar el usuario porque tiene ventas registradas asociadas.');
    }

    db.prepare('DELETE FROM Usuarios WHERE Id_usuario = ?').run(idEliminar);
    res.redirect('/usuarios');
  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    res.status(500).send('Error al eliminar usuario: ' + error.message);
  }
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
  const tasaActual = getTasaActual();
  res.render('venta_form', { 
    productos, 
    error: null, 
    venta: null, 
    detalles: [],
    tasaActual: tasaActual || { valor: 0 }
  });
});

app.get('/ventas/:id', requiereLogin, (req, res) => {
  const id = req.params.id;
  const venta = db.prepare('SELECT * FROM Ventas WHERE id_venta = ?').get(id);
  if (!venta) return res.redirect('/ventas');
  
  const detalles = db.prepare(`
    SELECT dv.*, p.nombre as producto_nombre, p.codigo 
    FROM Detalle_ventas dv 
    JOIN Productos p ON dv.id_producto = p.id_producto 
    WHERE dv.id_venta = ?
  `).all(id);
  
  res.render('venta_detalle', { venta, detalles });
});

// POST /ventas - Registrar Venta
app.post('/ventas', requiereLogin, (req, res) => {
  try {
    let { producto_id, cantidad, monto_recibido } = req.body;

    if (!producto_id || producto_id.length === 0) {
      const productos = db.prepare('SELECT * FROM Productos WHERE stock_total > 0 ORDER BY nombre ASC').all();
      const tasaActual = getTasaActual();
      return res.render('venta_form', { 
        productos, 
        error: 'Debe incluir al menos un producto en la venta.', 
        venta: null, 
        detalles: [],
        tasaActual: tasaActual || { valor: 0 }
      });
    }

    if (!Array.isArray(producto_id)) producto_id = [producto_id];
    if (!Array.isArray(cantidad)) cantidad = [cantidad];

    const fechaHoy = new Date().toISOString().slice(0, 10);
    const idUsuario = req.session.usuario ? req.session.usuario.Id_usuario : null;
    const tasaActual = getTasaActual();
    const tasaValor = tasaActual ? tasaActual.valor : 0;

    // 🔥 CORREGIDO: Asegurar que monto_recibido sea un número válido
    let montoNumerico = null;
    if (monto_recibido !== undefined && monto_recibido !== '' && monto_recibido !== null) {
      // Reemplazar coma por punto si existe
      const montoStr = String(monto_recibido).replace(',', '.');
      const parsed = parseFloat(montoStr);
      if (!isNaN(parsed) && parsed > 0) {
        montoNumerico = parsed;
      }
    }

    const procesarVentaTx = db.transaction(() => {
      // 🔥 CORREGIDO: Usar montoNumerico en lugar del valor original
      const resultVenta = db.prepare(
        'INSERT INTO Ventas (fecha, total, total_bs, monto_recibido, id_usuario, anulada, tasa_cambio) VALUES (?, 0, 0, ?, ?, 0, ?)'
      ).run(fechaHoy, montoNumerico, idUsuario, tasaValor);

      const idVenta = resultVenta.lastInsertRowid;
      let totalVenta = 0;
      let totalVentaBs = 0;

      for (let i = 0; i < producto_id.length; i++) {
        const idp = Number(producto_id[i]);
        const cantRequerida = Number(cantidad[i]);

        if (!idp || isNaN(cantRequerida) || cantRequerida <= 0) continue;

        const producto = db.prepare('SELECT * FROM Productos WHERE id_producto = ?').get(idp);
        if (!producto || producto.stock_total < cantRequerida) {
          throw new Error(`Stock insuficiente para el producto: ${producto ? producto.nombre : 'ID ' + idp}`);
        }

        let restante = cantRequerida;
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
          const precioUnitBs = (lote.precio_venta_bs && lote.precio_venta_bs > 0)
            ? lote.precio_venta_bs
            : (producto.precio_venta_bs || 0);

          db.prepare(`
            INSERT INTO Detalle_ventas (id_venta, id_producto, id_lote, cantidad, precio_unitario, precio_unitario_bs) 
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(idVenta, idp, lote.id_lote, uso, precioUnit, precioUnitBs);

          db.prepare('UPDATE Lotes SET cantidad_actual = cantidad_actual - ? WHERE id_lote = ?').run(uso, lote.id_lote);

          totalVenta += uso * precioUnit;
          totalVentaBs += uso * precioUnitBs;
          restante -= uso;
        }

        if (restante > 0) {
          const precioUnit = producto.precio_venta || 0;
          const precioUnitBs = producto.precio_venta_bs || 0;
          db.prepare(`
            INSERT INTO Detalle_ventas (id_venta, id_producto, id_lote, cantidad, precio_unitario, precio_unitario_bs) 
            VALUES (?, ?, NULL, ?, ?, ?)
          `).run(idVenta, idp, restante, precioUnit, precioUnitBs);

          totalVenta += restante * precioUnit;
          totalVentaBs += restante * precioUnitBs;
        }

        db.prepare('UPDATE Productos SET stock_total = stock_total - ? WHERE id_producto = ?').run(cantRequerida, idp);
      }

      db.prepare('UPDATE Ventas SET total = ?, total_bs = ? WHERE id_venta = ?').run(totalVenta, totalVentaBs, idVenta);
    });

    procesarVentaTx();
    res.redirect('/ventas');

  } catch (e) {
    console.error('Error al registrar venta:', e);
    const productos = db.prepare('SELECT * FROM Productos WHERE stock_total > 0 ORDER BY nombre ASC').all();
    const tasaActual = getTasaActual();
    res.render('venta_form', { 
      productos, 
      error: 'Error al registrar venta: ' + e.message, 
      venta: null, 
      detalles: [],
      tasaActual: tasaActual || { valor: 0 }
    });
  }
});


app.get('/ventas/nuevo', requiereLogin, (req, res) => {
  const productos = db.prepare('SELECT * FROM Productos WHERE stock_total > 0 ORDER BY nombre ASC').all();
  const tasaActual = getTasaActual(); // Obtener la tasa actual
  res.render('venta_form', { 
    productos, 
    error: null, 
    venta: null, 
    detalles: [],
    tasaActual: tasaActual || { valor: 0 } // Pasar la tasa con un valor por defecto
  });
});

app.get('/ventas/:id/editar', requiereLogin, (req, res) => {
  const id = req.params.id;
  const venta = db.prepare('SELECT * FROM Ventas WHERE id_venta = ?').get(id);
  if (!venta) return res.redirect('/ventas');
  const detalles = db.prepare('SELECT dv.*, p.nombre as producto_nombre FROM Detalle_ventas dv JOIN Productos p ON dv.id_producto = p.id_producto WHERE dv.id_venta = ?').all(id);
  const productos = db.prepare('SELECT * FROM Productos').all();
  const tasaActual = getTasaActual();
  res.render('venta_form', { 
    productos, 
    error: null, 
    venta, 
    detalles,
    tasaActual: tasaActual || { valor: 0 }
  });
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

// --- Export PDF ---
app.get('/export/productos', requiereLogin, requiereAdmin, (req, res) => {
  const productos = db.prepare(`
    SELECT p.*, c.nombre as categoria_nombre FROM Productos p 
    LEFT JOIN Categorias c ON p.id_categoria = c.id_categoria
  `).all();
  exportarProductosPDF(productos, res);
});

app.get('/export/ventas', requiereLogin, requiereAdmin, (req, res) => {
  const ventas = db.prepare(`
    SELECT v.*, u.nombre as usuario_nombre 
    FROM Ventas v 
    LEFT JOIN Usuarios u ON v.id_usuario = u.Id_usuario 
    ORDER BY v.fecha DESC
  `).all();
  exportarVentasPDF(ventas, res);
});

// --- Barra de búsqueda mejorada (API) ---
app.get('/api/productos/buscar', requiereLogin, (req, res) => {
  const q = req.query.q || '';
  const query = `%${q}%`;
  const filas = db.prepare(`
    SELECT p.*, c.nombre as categoria_nombre 
    FROM Productos p 
    LEFT JOIN Categorias c ON p.id_categoria = c.id_categoria
    WHERE p.nombre LIKE ? OR p.codigo LIKE ? 
    LIMIT 20
  `).all(query, query);
  res.json(filas);
});

// Ruta de Reportes
app.get('/reportes', requiereLogin, (req, res) => {
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    const tasaActual = getTasaActual();

    // 1. Total vendido hoy en USD y Bs
    const ventasHoy = db.prepare('SELECT SUM(total) AS total, SUM(total_bs) AS total_bs FROM Ventas WHERE fecha = ? AND (anulada = 0 OR anulada IS NULL)').get(hoy);
    const totalVentasHoyUSD = ventasHoy ? (ventasHoy.total || 0) : 0;
    const totalVentasHoyBs = ventasHoy ? (ventasHoy.total_bs || 0) : 0;

    // 2. Cantidad de ventas realizadas hoy
    const cantHoy = db.prepare('SELECT COUNT(*) AS cantidad FROM Ventas WHERE fecha = ? AND (anulada = 0 OR anulada IS NULL)').get(hoy);
    const cantidadVentasHoy = cantHoy ? cantHoy.cantidad : 0;

    // 3. Total histórico de ventas (no anuladas) en USD y Bs
    const ventasHistorico = db.prepare('SELECT SUM(total) AS total, SUM(total_bs) AS total_bs FROM Ventas WHERE (anulada = 0 OR anulada IS NULL)').get();
    const totalVentasHistoricoUSD = ventasHistorico ? (ventasHistorico.total || 0) : 0;
    const totalVentasHistoricoBs = ventasHistorico ? (ventasHistorico.total_bs || 0) : 0;

    // 4. Top 5 productos más vendidos (con USD y Bs)
    const topProductos = db.prepare(`
      SELECT 
        p.nombre, 
        SUM(dv.cantidad) AS total_vendido, 
        SUM(dv.cantidad * dv.precio_unitario) AS total_recaudado,
        SUM(dv.cantidad * dv.precio_unitario_bs) AS total_recaudado_bs
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
      totalVentasHoyUSD,
      totalVentasHoyBs,
      cantidadVentasHoy,
      totalVentasHistoricoUSD,
      totalVentasHistoricoBs,
      topProductos,
      ultimasVentas,
      tasaActual: tasaActual || { valor: 0, fecha: new Date().toISOString().slice(0, 10) }
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