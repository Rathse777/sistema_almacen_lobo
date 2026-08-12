# Página web de registro de ventas e inventario (Víveres Lobo) - Proyecto didáctico

Este proyecto es un ejemplo sencillo en Node.js + Express + SQLite (better-sqlite3) que implementa una "Página web de registro de ventas e inventario" para un negocio de víveres.

Características principales:
- Autenticación simple con sesiones (usuarios en texto plano).
- Roles: `admin` y `cajero`.
  - Admin: puede todo (CRUD productos, lotes, categorías, usuarios; ver reportes).
  - Cajero: puede registrar ventas, ver productos, y crear productos/lotes/categorías; NO puede eliminar/editar productos existentes ni ver reportes.
- Gestión de productos, lotes (FIFO), categorías y usuarios.
- Registro de ventas con aplicación de FIFO sobre lotes y decremento de stock_total.
- Control visual de vencimiento de lotes/productos (rojo si vencido, amarillo si vence en <7 días).
- Alertas de stock para productos con stock_total <= 5.
- Exportar CSV de productos y ventas (solo admin).
- Validaciones cliente y servidor básicas.
- Motor de vistas EJS y Bootstrap desde CDN.

Requisitos:
- Node.js >= 14
- npm

Cómo ejecutar:
1. Instalar dependencias:
   npm install

2. Ejecutar migración (crea la BD en `data/sistema_lobo.db`):
   npm run migrate
   (o `node migrate.js`)

3. Cargar datos de ejemplo:
   npm run seed
   (o `node seed.js`)

4. Iniciar servidor:
   npm start

5. Abrir en navegador:
   http://localhost:3000

Credenciales de ejemplo (seed):
- Admin: usuario "Admin Ejemplo", contraseña "adminpass" (rol: admin)
- Cajero: usuario "Cajero Ejemplo", contraseña "cajeropass" (rol: cajero)

Notas importantes de seguridad:
- EN PRODUCCIÓN: NO guarde contraseñas en texto plano. Use hashing (por ejemplo bcrypt) y TLS.
- La sesión está en memoria (express-session) para simplicidad; para producción use un store persistente.
- No hay protección CSRF en este ejemplo (aprender/añadir según necesidad).

Estructura principal de rutas (implementadas en server.js):
- GET / -> dashboard
- GET /login, POST /login, GET /logout
- GET /productos, GET /productos/nuevo, POST /productos, GET /productos/:id/editar, POST /productos/:id/editar, POST /productos/:id/eliminar
- GET /lotes, GET /lotes/nuevo, POST /lotes, GET /lotes/:id/editar, POST /lotes/:id/editar
- GET /categorias, GET /categorias/nuevo, POST /categorias
- GET /ventas, GET /ventas/nuevo, POST /ventas, GET /ventas/:id/editar, POST /ventas/:id/editar, POST /ventas/:id/anular
- GET /usuarios (solo admin), POST /usuarios (solo admin)
- GET /export/productos (CSV) (solo admin), GET /export/ventas (CSV) (solo admin)

Lógica de ventas y lotes (FIFO):
- Al crear una venta se valida que la cantidad solicitada <= stock_total.
- Se buscan lotes con cantidad_actual > 0 ordenados por fecha_ingreso ASC.
- Se consumen lotes secuencialmente hasta cubrir la cantidad (se crean filas en Detalle_ventas por cada porción consumida de un lote).
- Se actualizan Lotes.cantidad_actual y Productos.stock_total.
- Si no hay stock suficiente, se rechaza la venta.

Cómo cambiar:
- Para habilitar hashing de contraseñas: modificar los endpoints de creación y login para usar bcrypt y adaptar seed.js para guardar hashes.
- Para cambios en el esquema, editar `schema.sql` y volver a ejecutar `npm run migrate` (nota: migrate no borra la DB actual; considerar respaldo).

Contacto:
Proyecto didáctico generado por asistente. Revisar y adaptar antes de usar en producción.
