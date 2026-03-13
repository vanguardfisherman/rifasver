# Rifas MVP (frontend conectado a backend)

## Ejecutar local

```bash
# Terminal 1 (backend)
python app/server.py

# Terminal 2 (frontend estatico opcional)
cd web
python3 -m http.server 4173
```

Abrir:
- `http://localhost:8080/` (frontend servido por backend, recomendado)
- `http://localhost:4173` (si usas server estatico para `web/`)

Si usas `web/` con puerto distinto, configura el backend en `index.html`:

```html
<meta name="api-base" content="http://localhost:8080" />
```

Y habilita ese origen en backend:

```bash
CORS_ALLOW_ORIGINS=http://localhost:4173 python app/server.py
```

## Incluye
- Selección manual de números con botones y búsqueda.
- Mínimo de compra según configuración real de la rifa.
- Checkout conectado a `POST /api/orders`.
- Descarga de comprobante PDF real (`/api/orders/:id/receipt`).
- Consulta de entradas por correo o documento (`/api/tickets/query`).
- Ganadores leídos desde backend (`/api/raffles/:id/winners`).
- Publicación de ganadores en modo admin (`?admin=1`) con login real de admin.
