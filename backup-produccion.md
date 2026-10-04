# Backup de PostgreSQL en producción

Ejecutar estos comandos en el servidor de producción. El backup se guarda en
el servidor y no se transfieren los datos por la red.

```bash
mkdir -p ~/skill-hub-backups
chmod 700 ~/skill-hub-backups

docker exec skullhub-v2-db-1 sh -c 'pg_dumpall -U "$POSTGRES_USER"' | gzip > ~/skill-hub-backups/skillhub-$(date -u +%Y%m%dT%H%M%SZ).sql.gz

chmod 600 ~/skill-hub-backups/skillhub-*.sql.gz
gzip -t ~/skill-hub-backups/skillhub-*.sql.gz
ls -lh ~/skill-hub-backups
```

El archivo debe tener un tamaño razonable para la base. Si pesa solo unos pocos
bytes, verificar primero el nombre del contenedor:

```bash
docker ps --format '{{.Names}}'
```

Para inspeccionar un error sin crear otro backup:

```bash
docker exec skullhub-v2-db-1 sh -c 'pg_dumpall -U "$POSTGRES_USER"'
```

No restaurar sobre producción activa sin confirmar el destino. Una restauración
requiere un backup válido y puede sobrescribir datos existentes.
