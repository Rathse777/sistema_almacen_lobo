document.addEventListener('DOMContentLoaded', () => {
    const selectProducto = document.getElementById('select-producto');
    const cantidadItem = document.getElementById('cantidad-item');
    const btnAgregar = document.getElementById('btn-agregar');
    const listaItems = document.getElementById('lista-items');
    const totalVentaSpan = document.getElementById('total-venta');
    const inputItems = document.getElementById('input-items');
    const formVenta = document.getElementById('form-venta');
    const montoPagadoInput = document.getElementById('monto_pagado');

    const modalVueltoElem = document.getElementById('modalVuelto');
    const modalVuelto = modalVueltoElem ? new bootstrap.Modal(modalVueltoElem) : null;
    const mensajeVuelto = document.getElementById('mensaje-vuelto');
    const btnConfirmarFinalizar = document.getElementById('btn-confirmar-finalizar');

    let carrito = [];

    if (btnAgregar) {
        btnAgregar.addEventListener('click', () => {
            const productoId = selectProducto.value;
            const productoNombre = selectProducto.options[selectProducto.selectedIndex]?.text.split(' - ')[0];
            const precio = parseFloat(selectProducto.options[selectProducto.selectedIndex]?.getAttribute('data-precio'));
            const stockMax = parseInt(selectProducto.options[selectProducto.selectedIndex]?.getAttribute('data-stock'));
            const cantidad = parseInt(cantidadItem.value);

            if (!productoId || isNaN(cantidad) || cantidad <= 0) {
                alert('Seleccione un producto y una cantidad válida.');
                return;
            }

            if (cantidad > stockMax) {
                alert(`La cantidad no puede superar el stock disponible (${stockMax}).`);
                return;
            }

            const itemExistente = carrito.find(item => item.producto_id === productoId);
            if (itemExistente) {
                if (itemExistente.cantidad + cantidad > stockMax) {
                    alert('La suma total supera el stock disponible.');
                    return;
                }
                itemExistente.cantidad += cantidad;
                itemExistente.subtotal = itemExistente.cantidad * itemExistente.precio;
            } else {
                carrito.push({
                    producto_id: productoId,
                    nombre: productoNombre,
                    precio: precio,
                    cantidad: cantidad,
                    subtotal: cantidad * precio
                });
            }

            actualizarTabla();
            selectProducto.value = '';
            cantidadItem.value = 1;
        });
    }

    function actualizarTabla() {
        listaItems.innerHTML = '';
        let total = 0;

        carrito.forEach((item, index) => {
            total += item.subtotal;
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.nombre}</td>
                <td>$${item.precio.toFixed(2)}</td>
                <td>${item.cantidad}</td>
                <td>$${item.subtotal.toFixed(2)}</td>
                <td>
                    <button type="button" class="btn btn-danger btn-sm" onclick="eliminarItem(${index})">Eliminar</button>
                </td>
            `;
            listaItems.appendChild(row);
        });

        totalVentaSpan.textContent = total.toFixed(2);
        inputItems.value = JSON.stringify(carrito);
    }

    window.eliminarItem = function (index) {
        carrito.splice(index, 1);
        actualizarTabla();
    };

    if (formVenta) {
        formVenta.addEventListener('submit', (e) => {
            e.preventDefault();

            if (carrito.length === 0) {
                alert('Debe agregar al menos un producto a la lista antes de vender.');
                return;
            }

            const total = parseFloat(totalVentaSpan.textContent);
            const montoPagado = parseFloat(montoPagadoInput.value);

            if (isNaN(montoPagado) || montoPagado < total) {
                alert(`El monto ingresado es insuficiente. El total a pagar es $${total.toFixed(2)}.`);
                return;
            }

            const vuelto = montoPagado - total;

            if (vuelto > 0) {
                mensajeVuelto.textContent = `Cobro exitoso. El vuelto a entregar es: $${vuelto.toFixed(2)}`;
            } else {
                mensajeVuelto.textContent = 'Cobro exitoso. Se ha pagado el precio exacto.';
            }

            if (modalVuelto) {
                modalVuelto.show();
            } else {
                formVenta.submit();
            }
        });
    }

    if (btnConfirmarFinalizar) {
        btnConfirmarFinalizar.addEventListener('click', () => {
            formVenta.submit();
        });
    }
// Formatear número con separador de miles
function formatNumber(num, decimals = 2) {
    if (isNaN(num)) return '0.00';
    return Number(num).toFixed(decimals);
}

// Validar que solo se ingresen números y decimales
function validateNumberInput(event) {
    const charCode = event.charCode;
    const char = String.fromCharCode(charCode);
    if (!/[\d,.]/.test(char) && charCode !== 0) {
        event.preventDefault();
    }
}
});