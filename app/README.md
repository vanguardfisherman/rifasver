# Plataforma de Rifas — versión principal

## Requisitos
- Python 3.10+

## Ejecutar
```bash
cd app
python3 server.py
```

Abrir `http://localhost:8080`.

## Credenciales admin por defecto
- Usuario: `admin`
- Clave: `admin123`

> Puedes cambiarlas con variables de entorno `ADMIN_USER` y `ADMIN_PASSWORD`.

## Qué incluye
- Backend real con SQLite (rifas, clientes, órdenes, números, resultados, auditoría).
- API REST para compra, consulta, admin (login, crear rifa, editar, publicar ganadores).
- Frontend integrado con selección manual por botones, checkout simulado y consulta por correo/documento.
- Vista pública de ganadores en cards.
- Seguridad base: protección de endpoints admin por token y rate limit para consulta de entradas.
