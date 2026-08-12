-- Esquema de la base de datos para Sistema_Lobo (simplificado y didáctico)
-- Tablas: Usuarios, Categorias, Productos, Lotes, Ventas, Detalle_ventas
-- Todas las fechas se guardan en formato ISO (YYYY-MM-DD)

PRAGMA foreign_keys = ON;

-- Usuarios: Id_usuario, nombre, rol, contraseña
CREATE TABLE IF NOT EXISTS Usuarios (
  Id_usuario INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('admin','cajero')),
  contraseña TEXT NOT NULL
);

-- Categorias
CREATE TABLE IF NOT EXISTS Categorias (
  id_categoria INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE
);

-- Productos
CREATE TABLE IF NOT EXISTS Productos (
  id_producto INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  codigo TEXT,
  descripcion TEXT,
  id_categoria INTEGER,
  stock_total INTEGER NOT NULL DEFAULT 0,
  stock_minimo INTEGER NOT NULL DEFAULT 0,
  precio_venta REAL DEFAULT 0, -- precio por unidad si no hay lote
  fecha_vencimiento TEXT, -- fecha de referencia (opcional)
  FOREIGN KEY (id_categoria) REFERENCES Categorias(id_categoria) ON DELETE SET NULL
);

-- Lotes
CREATE TABLE IF NOT EXISTS Lotes (
  id_lote INTEGER PRIMARY KEY AUTOINCREMENT,
  id_producto INTEGER NOT NULL,
  cantidad_inicial INTEGER NOT NULL,
  cantidad_actual INTEGER NOT NULL,
  precio_compra REAL DEFAULT 0,
  precio_venta REAL DEFAULT 0,
  fecha_ingreso TEXT NOT NULL,
  fecha_vencimiento TEXT,
  FOREIGN KEY (id_producto) REFERENCES Productos(id_producto) ON DELETE CASCADE
);

-- Ventas
CREATE TABLE IF NOT EXISTS Ventas (
  id_venta INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  total REAL NOT NULL,
  tipo_pago TEXT NOT NULL CHECK (tipo_pago IN ('efectivo','pago_móvil')),
  monto_recibido REAL, -- solo para efectivo
  id_usuario INTEGER,
  anulada INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (id_usuario) REFERENCES Usuarios(Id_usuario) ON DELETE SET NULL
);

-- Detalle_ventas
CREATE TABLE IF NOT EXISTS Detalle_ventas (
  id_detalle INTEGER PRIMARY KEY AUTOINCREMENT,
  id_venta INTEGER NOT NULL,
  id_producto INTEGER NOT NULL,
  id_lote INTEGER, -- lote usado (puede ser NULL si no hay)
  cantidad INTEGER NOT NULL,
  precio_unitario REAL NOT NULL,
  FOREIGN KEY (id_venta) REFERENCES Ventas(id_venta) ON DELETE CASCADE,
  FOREIGN KEY (id_producto) REFERENCES Productos(id_producto),
  FOREIGN KEY (id_lote) REFERENCES Lotes(id_lote)
);