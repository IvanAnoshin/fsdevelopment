# Friendscape: точки роста, встроенные в проект

- **Роли и permissions**: member / moderator / support / admin.
- **Realtime foundation**: SSE-поток `/api/events/stream` и фронтовый realtime client.
- **Structured logging**: JSON-логи запросов, request id, recovery middleware, webhook для ошибок.
- **SQL migrations discipline**: embedded SQL миграции + таблица `schema_migrations`.
- **Media architecture foundation**: storage abstraction и draft/presign endpoint для будущего object storage/CDN.
- **Автотестовый каркас**:
  - backend: Go tests для role/permission модели
  - frontend: `node --test` smoke tests для permissions/realtime helpers
