# Plataforma de Rifas — versión principal

## Requisitos
- Python 3.10+

## Ejecutar
```bash
cd app
python3 server.py
```

Abrir:
- Público: `http://localhost:8080/`
- Admin: `http://localhost:8080/admin`

## Credenciales admin por defecto
- Usuario: `admin`
- Clave: `admin123`

> Puedes cambiarlas con variables de entorno `ADMIN_USER` y `ADMIN_PASSWORD`.

## Qué incluye
- Backend real con SQLite (rifas, subpremios, clientes, órdenes, números, resultados, auditoría).
- API REST para compra, consulta, admin (login, crear/editar rifa, subpremios, publicar ganadores).
- Comprobante PDF server-side por orden (`GET /api/orders/:id/receipt?document=...`).
- Frontend público separado de panel admin.
- Seguridad base: protección de endpoints admin por token y rate limit para consulta de entradas.
