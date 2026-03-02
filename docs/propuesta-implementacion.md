# Propuesta de implementación — Plataforma de Rifas Online (MVP v2 validada)

## 1. Alcance acordado para la demo

- **Múltiples rifas activas** al mismo tiempo.
- **Selección manual de números** por parte del cliente.
- **Formato de numeración fijo en 4 dígitos**, iniciando en `0001`.
- **Pago simulado** (sin integración PSE real en esta fase).
- El **administrador define los números ganadores** el día del sorteo.
- Sin notificaciones externas en v1 (correo/WhatsApp/SMS), pero sí **comprobante visual + generación de PDF** con números comprados.
- Datos obligatorios de cliente: **teléfono, identificación y correo**.
- El admin **puede editar rifas incluso si ya tienen ventas** (con reglas de seguridad para no romper datos).
- Branding base: **tema oscuro con acentos azules**, priorizando look moderno/mobile como las referencias.

---

## 2. Arquitectura recomendada (demo funcional rápida)

- **Frontend + Backend:** Next.js (App Router) + TypeScript.
- **UI:** Tailwind CSS (mobile-first, tema oscuro similar a referencia).
- **DB:** PostgreSQL.
- **ORM:** Prisma.
- **Storage imágenes:** Cloudinary (simple para demo) o S3.
- **Autenticación admin:** NextAuth (credenciales) o JWT simple para MVP.
- **PDF:** generación server-side con `pdf-lib` o `react-pdf`.

### Módulos principales

1. **Sitio público**
   - Landing de rifas activas.
   - Detalle por rifa (premio, subpremios, progreso, precio, selector de números).
   - Checkout con formulario de comprador.
   - Confirmación de compra + descarga PDF (plantilla **placeholder**, editable luego).
   - Consulta de entradas por correo o documento.

2. **Panel admin**
   - CRUD de rifas.
   - Configuración de reglas (mínimo compra, total números, precio, premios, fecha sorteo).
   - Gestión de pedidos/ventas.
   - Cierre y publicación de resultado.

3. **Motor de rifa**
   - Bloqueo temporal de números (reserva).
   - Confirmación de compra (pago simulado).
   - Selección de ganador principal y subpremios.

---

## 3. Reglas funcionales concretas (para evitar ambigüedad)

## 3.1 Selección y bloqueo de números
- Cliente selecciona números manualmente desde una grilla con **botones interactivos** y estados visuales claros (disponible, reservado, vendido).
- Al seleccionar y pasar al checkout, números quedan en estado `reserved` por **10 minutos**.
- Si no completa, expiran y vuelven a `available`.
- Al confirmar pago simulado, pasan a `assigned`.

## 3.2 Mínimo de compra
- Campo `minimo_compra` por rifa.
- Validación doble: frontend (UX) + backend (seguridad).
- **Sin límite máximo por transacción** (el cliente puede comprar la cantidad que quiera).

## 3.3 Edición de rifas con ventas
Como solicitaste, sí se permite editar, con estas reglas seguras:
- ✅ Se puede editar: título, descripción, imágenes, premio, subpremios, fecha sorteo.
- ✅ Todo cambio en rifa con ventas queda guardado en `audit_logs` (quién cambió, qué cambió, fecha/hora).
- ✅ Cambios relevantes quedan visibles al cliente en la ficha pública (fecha de actualización + campos impactados).
- ⚠️ Cambios sensibles controlados:
  - `total_numeros`: solo permitir **aumentar** si ya hay números asignados.
  - `precio_entrada`: aplicar a nuevas compras; conservar precio histórico en órdenes previas.
  - `minimo_compra`: aplica desde el cambio en adelante.

## 3.4 Sorteo y ganadores
- En admin, el día del sorteo se registran uno o varios `numeros_ganadores`.
- El ganador principal y los subpremios se resuelven según la configuración de la rifa.
- **Los números ganadores los decide el admin** y el sistema solo valida que existan dentro del rango de la rifa.
- Se publica resultado en página pública de la rifa.

## 3.5 Pago simulado (MVP)
Estados de orden:
- `pending` (checkout iniciado)
- `paid_simulated` (confirmado manual/simulado)
- `cancelled` (expirado o anulado)

---

## 4. Modelo de datos propuesto (Prisma / SQL)

## Entidades
- `admins`
- `raffles`
- `raffle_images`
- `raffle_subprizes`
- `customers`
- `orders`
- `order_numbers`
- `draw_results`
- `winners`
- `audit_logs`

## Campos clave (resumen)

### `raffles`
- `id`
- `title`, `description`
- `total_numbers`
- `ticket_price`
- `min_purchase`
- `status` (`draft`, `active`, `closed`, `drawn`)
- `lottery_reference` (texto libre para demo)
- `draw_at`
- `main_prize`
- `cover_image_url`
- `created_by_admin_id`
- `number_padding` (default 4 para mostrar `0001`, `0002`, ...)

### `customers`
- `id`
- `document`
- `first_name`, `last_name`
- `email`
- `phone`
- `city`, `address` (opcionales para demo)

### `orders`
- `id`
- `raffle_id`, `customer_id`
- `quantity`
- `unit_price`
- `total`
- `payment_status`
- `payment_reference` (simulada)
- `reserved_until`

### `order_numbers`
- `id`
- `order_id`
- `raffle_id`
- `number`
- `status` (`reserved`, `assigned`, `released`)

### `draw_results`
- `id`
- `raffle_id`
- `winner_type` (`main`, `subprize`)
- `winning_number`
- `label` (ej. "Premio principal", "Subpremio #2")
- `created_by_admin_id`

---

## 5. Flujo UX sugerido (mobile-first)

1. **Landing**
   - Lista rifas activas + tarjetas.
2. **Detalle de rifa**
   - Foto principal, premio, % vendido.
   - Botones rápidos de cantidad.
   - Selector manual de números en formato `0001` con experiencia amigable: botones por número, filtros rápidos y búsqueda directa.
3. **Checkout**
   - Formulario: identificación, correo, celular obligatorios.
   - Resumen de compra.
   - Botón “Pagar (simulado)”.
4. **Confirmación**
   - Estado exitoso.
   - Números asignados visibles.
   - Botón “Descargar comprobante PDF” con diseño placeholder (logo, fecha, código orden, números comprados).
5. **Consulta de entradas**
   - Campo correo o documento.
   - Mostrar todas las compras + números + estado.

---

## 6. Backoffice admin (pantallas MVP)

1. **Dashboard**
   - Rifas activas, ventas del día, total vendido.
2. **Rifas**
   - Crear / editar / activar / cerrar.
   - Gestión de imágenes y subpremios.
3. **Órdenes**
   - Listado, búsqueda por cliente, estado, detalle.
4. **Resultados**
   - Registrar uno o varios números ganadores.
   - Ejecutar cálculo de ganadores.
   - Publicar resultado.

---

## 7. API inicial (contratos sugeridos)

### Público
- `GET /api/raffles/active`
- `GET /api/raffles/:id`
- `POST /api/raffles/:id/reserve-numbers` (números manuales `0001+`)
- `POST /api/orders`
- `POST /api/orders/:id/pay-simulated`
- `GET /api/tickets/query?email=...|document=...`
- `GET /api/orders/:id/pdf`

### Admin
- `POST /api/admin/raffles`
- `PATCH /api/admin/raffles/:id`
- `POST /api/admin/raffles/:id/publish`
- `POST /api/admin/raffles/:id/draw-results` (carga múltiple de ganadores)
- `GET /api/admin/orders`

---

## 8. Seguridad y cumplimiento mínimo (Colombia)

- Validaciones backend estrictas.
- Rate limit en consulta de entradas.
- Trazabilidad en `audit_logs` para cambios críticos.
- Checkbox de aceptación de términos y política de tratamiento de datos.
- Evitar exponer listados completos de compradores públicamente.

---

## 9. Plan de ejecución propuesto

## Sprint 1 (base técnica)
- Setup Next.js + Prisma + PostgreSQL.
- Esquema inicial + migraciones.
- Landing y detalle de rifa.

## Sprint 2 (compra)
- Selector manual de números.
- Reserva temporal y checkout.
- Pago simulado y asignación definitiva.
- Comprobante + PDF.

## Sprint 3 (admin + sorteo)
- Login admin.
- CRUD de rifas y subpremios.
- Registro de múltiples números ganadores definidos por admin y cálculo de ganadores.
- Consulta de entradas por correo/documento.

---

## 10. Decisiones ya validadas contigo (base para implementación)

1. **Formato de numeración:** inicia en `0001` (4 dígitos).
2. **Subpremios:** configuración **editable** por el admin al crear/editar la rifa.
3. **Números ganadores:** los define directamente el admin en el panel de resultados.
4. **Datos públicos de ganadores:** nombre parcial + ciudad.
5. **Branding:** negro + azul, con tipografía moderna y alto contraste móvil.
6. **Selector de números UX:** botones agradables en móvil/web + varias opciones de selección.
7. **Límite por compra:** sin límite máximo por transacción.
8. **PDF:** se implementa con template placeholder editable más adelante.
9. **Ganadores públicos:** en cards con premio + número + nombre parcial + ciudad.

## 11. Implementación conversada (aún sin programar)

Con base en tu feedback, esta es la guía cerrada para la siguiente etapa de desarrollo:

1. **Selector de números (móvil y web):** por botones, visual agradable, con varias opciones de selección para facilitar la compra.
2. **Límite por transacción:** no se define límite máximo de compra.
3. **Edición admin con ventas activas:** habilitada, con auditoría completa y cambios relevantes visibles al cliente.
4. **PDF de comprobante:** usar plantilla placeholder inicial (luego personalizable).
5. **Ganadores públicos:** mostrar en cards con premio + número + nombre parcial + ciudad.
