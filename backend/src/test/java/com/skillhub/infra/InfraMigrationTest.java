package com.skillhub.infra;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies the infra migration is purely additive: it can be applied on a clean
 * database and on a pre-feature (V23) database with existing data, in both cases
 * without touching the existing public tables.
 */
@Testcontainers
class InfraMigrationTest {

    @Container
    static final PostgreSQLContainer<?> CLEAN = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("skillhub").withUsername("skillhub").withPassword("skillhub");

    @Container
    static final PostgreSQLContainer<?> PREFEATURE = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("skillhub").withUsername("skillhub").withPassword("skillhub");

    private Flyway flyway(PostgreSQLContainer<?> container, String target) {
        var config = Flyway.configure()
                .dataSource(container.getJdbcUrl(), container.getUsername(), container.getPassword())
                .locations("classpath:db/migration");
        if (target != null) config.target(target);
        return config.load();
    }

    @Test
    void cleanDatabaseAppliesAllMigrationsIncludingInfra() throws Exception {
        var result = flyway(CLEAN, null).migrate();
        assertThat(result.migrationsExecuted).isEqualTo(25);
        try (Connection connection = DriverManager.getConnection(CLEAN.getJdbcUrl(), CLEAN.getUsername(), CLEAN.getPassword())) {
            assertThat(tableExists(connection, "public", "users")).isTrue();
            assertThat(tableExists(connection, "infra", "service_catalog")).isTrue();
            assertThat(tableExists(connection, "infra", "service_state")).isTrue();
            assertThat(tableExists(connection, "infra", "observation")).isTrue();
            assertThat(tableExists(connection, "infra", "state_transition")).isTrue();
        }
    }

    @Test
    void prefeatureDatabaseKeepsExistingDataAfterInfraMigration() throws Exception {
        Flyway baseline = flyway(PREFEATURE, "23");
        baseline.migrate();
        assertThat(baseline.info().current().getVersion().getVersion()).isEqualTo("23");

        try (Connection connection = DriverManager.getConnection(PREFEATURE.getJdbcUrl(), PREFEATURE.getUsername(), PREFEATURE.getPassword())) {
            assertThat(tableExists(connection, "infra", "service_state")).isFalse();
            try (Statement statement = connection.createStatement()) {
                statement.execute("INSERT INTO dep_map_kinds (id, label, sort_order) VALUES ('probe-kind', 'Probe', 987)");
            }
        }

        var applied = flyway(PREFEATURE, null).migrate();
        assertThat(applied.migrationsExecuted).isEqualTo(1);

        try (Connection connection = DriverManager.getConnection(PREFEATURE.getJdbcUrl(), PREFEATURE.getUsername(), PREFEATURE.getPassword())) {
            assertThat(tableExists(connection, "infra", "service_state")).isTrue();
            try (Statement statement = connection.createStatement();
                 ResultSet resultSet = statement.executeQuery("SELECT count(*) FROM dep_map_kinds WHERE id = 'probe-kind'")) {
                resultSet.next();
                assertThat(resultSet.getInt(1)).isEqualTo(1);
            }
            // Existing public shape is untouched.
            assertThat(columnExists(connection, "public", "users", "username")).isTrue();
        }
    }

    private static boolean tableExists(Connection connection, String schema, String table) throws Exception {
        try (var statement = connection.prepareStatement("SELECT to_regclass(?) IS NOT NULL")) {
            statement.setString(1, schema + "." + table);
            try (ResultSet rs = statement.executeQuery()) {
                rs.next();
                return rs.getBoolean(1);
            }
        }
    }

    private static boolean columnExists(Connection connection, String schema, String table, String column) throws Exception {
        try (var statement = connection.prepareStatement("""
                SELECT count(*) FROM information_schema.columns
                WHERE table_schema = ? AND table_name = ? AND column_name = ?
                """)) {
            statement.setString(1, schema);
            statement.setString(2, table);
            statement.setString(3, column);
            try (ResultSet rs = statement.executeQuery()) {
                rs.next();
                return rs.getInt(1) == 1;
            }
        }
    }
}
