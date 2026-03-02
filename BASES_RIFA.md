# Bases del proyecto: Plataforma de rifas online

## 1) Objetivo del negocio
Crear una plataforma web de rifas donde:
- Un administrador publica rifas activas (premio principal + subpremios).
- Los clientes compran una o varias entradas/números.
- El sorteo se define con referencia a una lotería oficial.
- El sistema identifica ganadores y notifica por correo/WhatsApp/SMS.
- El cliente puede consultar sus números con correo o documento.

## 2) Roles del sistema

### Cliente
- Ver rifa activa (imagen, valor, porcentaje vendido, premios).
- Elegir cantidad de entradas predefinidas (10, 20, 30, etc.) o personalizada.
- Completar datos de compra (documento, nombre, apellido, correo, celular, ciudad, dirección).
- Pagar por PSE.
- Consultar entradas compradas con correo o documento.

### Administrador
- Crear y editar rifas.
- Definir:
  - Cantidad total de números (editable por rifa).
  - Precio por entrada.
  - Mínimo de compra por cliente.
  - Premio principal y subpremios.
  - Lotería de referencia y fecha/hora del sorteo.
- Cargar fotos del premio (dinero u objeto).
- Monitorear ventas, pagos, números asignados.
- Ejecutar cierre de rifa y generación de ganadores.

## 3) Reglas funcionales clave

1. **Rifa activa única (v1 recomendada)**
   - Solo una rifa “circulante” al tiempo para simplificar operación.
   - Evolución futura: múltiples rifas simultáneas.

2. **Asignación de números**
   - Se recomienda asignación automática aleatoria de números disponibles.
   - Mantener bloqueos temporales de carrito (ej. 10 minutos) para evitar colisiones.

3. **Mínimo de compra**
   - Configurable por rifa (ej. mínimo 5 entradas).
   - Validado en frontend y backend.

4. **Cantidad total de números editable**
   - Permitir editar mientras la rifa esté en borrador.
   - Si ya hay ventas, solo permitir aumento controlado o generar nueva rifa (regla de seguridad).

5. **Pagos por PSE**
   - Orden pasa por estados: `pendiente -> pagado -> asignado`.
   - Nunca asignar definitivamente números antes de confirmación del pago.

6. **Ganadores por lotería**
   - Guardar resultado oficial (número ganador, fecha, evidencia).
   - Calcular ganador principal y subpremios con reglas claras (exacto, aproximación, últimas cifras, etc.).

7. **Notificaciones**
   - En compra confirmada: correo + opcional WhatsApp.
   - En resultado: aviso a ganadores y anuncio general.

8. **Consulta de entradas del cliente**
   - Búsqueda por correo o documento.
   - Mostrar rifa, números, estado de pago, estado del sorteo.

## 4) Diseño de pantallas (alineado al estilo de referencia)

## Público (Mobile-first)
1. **Landing de rifa**
   - Logo arriba, premio destacado, foto principal.
   - Barra de avance de venta.
   - Valor por entrada.
   - Grid de “Entradas premiadas”/subpremios.
   - Botones de compra por cantidad rápida + opción “comprar más”.

2. **Carrito / Checkout**
   - Sección “Datos de facturación” (como ejemplo que compartiste).
   - Resumen de compra: producto, cantidad, subtotal, total.
   - Método: “Pago vía PSE”.
   - Botón principal: “Realizar pedido”.

3. **Consulta de entradas**
   - Input correo/documento.
   - Resultado con lista de números y estado.

4. **Footer fijo de confianza**
   - Número de contacto y marca creadora.

## Admin
1. **Dashboard**
   - Ventas del día, total recaudado, % de números vendidos.
2. **Gestión de rifas**
   - Crear/editar rifa, premios, reglas, imágenes.
3. **Órdenes**
   - Estado pago, cliente, cantidades, exportación.
4. **Resultados y notificaciones**
   - Registrar resultado lotería y disparar mensajes.

## 5) Modelo de datos base (MVP)

- `users` (admin).
- `raffles`:
  - id, titulo, descripcion, total_numeros, precio_entrada, minimo_compra,
  - estado (`draft`, `active`, `closed`, `drawn`), loteria_ref, fecha_sorteo,
  - premio_principal, imagen_principal_url.
- `raffle_subprizes`:
  - id, raffle_id, nombre, descripcion, regla_ganador.
- `customers`:
  - documento, nombre, apellido, correo, celular, ciudad, direccion.
- `orders`:
  - id, raffle_id, customer_id, cantidad, total, estado_pago, referencia_pago_pse.
- `order_numbers`:
  - id, order_id, numero_asignado, estado (`reserved`, `assigned`).
- `draw_results`:
  - raffle_id, numero_oficial, fuente_loteria, fecha_resultado.
- `winners`:
  - raffle_id, tipo (`principal`/`subpremio`), customer_id, numero_ganador, premio.
- `notifications`:
  - canal, destinatario, plantilla, estado_envio.

## 6) Integraciones recomendadas

- **Pasarela PSE**: ePayco, Wompi, PayU o Mercado Pago (ver cobertura PSE y costos).
- **Correo transaccional**: Resend, SendGrid, AWS SES.
- **WhatsApp** (opcional): Meta API / proveedor autorizado.
- **Storage imágenes**: S3 o Cloudinary.

## 7) Seguridad y cumplimiento

- Validación estricta de identidad mínima (documento + correo).
- Rate limit en consulta de entradas para evitar abuso.
- Trazabilidad de sorteo (auditoría de resultado y evidencias).
- Política de tratamiento de datos personales (Habeas Data - Colombia).
- Términos y condiciones visibles antes del pago.

## 8) Stack técnico sugerido (rápido de lanzar)

- **Frontend**: Next.js + Tailwind (tema oscuro tipo referencia).
- **Backend**: Next.js API routes o NestJS.
- **DB**: PostgreSQL.
- **ORM**: Prisma.
- **Auth admin**: JWT + 2FA opcional.
- **Infra**: Vercel (frontend) + Railway/Render/Supabase (backend/db).

## 9) Roadmap por fases

### Fase 1 (MVP - 2 a 4 semanas)
- Rifa activa única.
- Checkout completo + PSE.
- Asignación de números automática.
- Consulta por correo/documento.
- Panel admin básico.

### Fase 2
- Múltiples rifas simultáneas.
- WhatsApp automático.
- Exportes y reportes avanzados.
- Cupones/promociones.

### Fase 3
- Motor avanzado de reglas de subpremios.
- Panel antifraude y scoring.
- App móvil ligera o PWA mejorada.

## 10) Decisiones para validar contigo antes de programar

1. ¿Una sola rifa activa al mismo tiempo o varias?
2. ¿La asignación de números será aleatoria o el cliente podrá elegir manualmente?
3. ¿Qué proveedor de PSE prefieres?
4. ¿Qué regla exacta define ganador principal y subpremios?
5. ¿Qué canal de notificación será obligatorio (correo, WhatsApp, SMS)?
6. ¿Qué datos del cliente son obligatorios legalmente para tu operación?
7. ¿Quieres que admin pueda editar una rifa ya vendida o que se bloquee automáticamente?

---
Si te parece bien esta base, en el siguiente paso te propongo:
1) arquitectura técnica detallada (endpoints + flujos), y
2) estructura inicial del proyecto para empezar desarrollo.
