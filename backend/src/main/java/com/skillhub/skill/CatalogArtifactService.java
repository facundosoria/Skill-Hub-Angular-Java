package com.skillhub.skill;

import com.skillhub.web.DomainException;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** Almacena los paquetes de catalogo y los vincula a versiones inmutables. */
@Service
public class CatalogArtifactService {
    public static final long MAX_BYTES = 25L * 1024 * 1024;

    public record Summary(String fileName, String contentType, long sizeBytes, String sha256) {}
    public record Download(Summary summary, byte[] content) {}

    private final NamedParameterJdbcTemplate jdbc;

    public CatalogArtifactService(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void attachBytes(String versionId, String fileName, String contentType, byte[] content, String actorId) {
        if (content == null || content.length == 0) throw new DomainException("Debe adjuntar un archivo no vacio");
        if (content.length > MAX_BYTES) throw new DomainException("El archivo supera el limite de 25 MB");

        String name = safeName(fileName);
        String hash = sha256(content);
        String blobId = jdbc.query("""
                INSERT INTO catalog_file_blobs (sha256, content, size_bytes)
                VALUES (:hash, :content, :size)
                ON CONFLICT (sha256) DO UPDATE SET sha256 = EXCLUDED.sha256
                RETURNING id::text
                """, new MapSqlParameterSource()
                .addValue("hash", hash).addValue("content", content).addValue("size", content.length),
                rs -> rs.next() ? rs.getString(1) : null);
        link(versionId, blobId, name, contentType(contentType), actorId);
    }

    public void attachUploaded(String versionId, MultipartFile file, String actorId) {
        if (file == null || file.isEmpty()) throw new DomainException("Debe adjuntar un archivo no vacio");
        if (file.getSize() > MAX_BYTES) throw new DomainException("El archivo supera el limite de 25 MB");

        byte[] content;
        try {
            content = file.getBytes();
        } catch (IOException e) {
            throw new DomainException("No se pudo leer el archivo adjunto");
        }
        attachBytes(versionId, file.getOriginalFilename(), file.getContentType(), content, actorId);
    }

    public void ensureDefaultArtifact(String versionId, String slug, String type, String content, String actorId) {
        if (hasArtifact(versionId)) return;
        String ext = "contract".equals(type) ? "-contract.json" : "-plugin.json";
        String fileName = slug + ext;
        java.util.Map<String, Object> manifest = new java.util.LinkedHashMap<>();
        manifest.put("name", slug);
        manifest.put("type", type);
        manifest.put("description", "Automated package manifest generated for " + slug);
        manifest.put("content", content);
        byte[] bytes;
        try {
            bytes = new com.fasterxml.jackson.databind.ObjectMapper()
                    .writerWithDefaultPrettyPrinter().writeValueAsBytes(manifest);
        } catch (Exception e) {
            bytes = ("{\"name\":\"" + slug + "\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
        }
        attachBytes(versionId, fileName, "application/json", bytes, actorId);
    }

    public void copyFromVersion(String sourceVersionId, String targetVersionId, String actorId) {
        if (sourceVersionId == null) return;
        jdbc.update("""
                INSERT INTO catalog_version_artifacts (skill_version_id, blob_id, file_name, content_type, created_by)
                SELECT :target::uuid, blob_id, file_name, content_type, :actor::uuid
                FROM catalog_version_artifacts WHERE skill_version_id = :source::uuid
                """, new MapSqlParameterSource().addValue("source", sourceVersionId)
                .addValue("target", targetVersionId).addValue("actor", actorId));
    }

    public boolean hasArtifact(String versionId) {
        if (versionId == null) return false;
        Integer found = jdbc.query("SELECT 1 FROM catalog_version_artifacts WHERE skill_version_id = :id::uuid",
                new MapSqlParameterSource("id", versionId), rs -> rs.next() ? 1 : null);
        return found != null;
    }

    public Summary findSummary(String skillId, int version) {
        return jdbc.query("""
                SELECT a.file_name, a.content_type, b.size_bytes, b.sha256
                FROM skill_versions v
                JOIN catalog_version_artifacts a ON a.skill_version_id = v.id
                JOIN catalog_file_blobs b ON b.id = a.blob_id
                WHERE v.skill_id = :skillId::uuid AND v.version = :version
                """, new MapSqlParameterSource().addValue("skillId", skillId).addValue("version", version),
                rs -> rs.next() ? new Summary(rs.getString(1), rs.getString(2), rs.getLong(3), rs.getString(4)) : null);
    }

    public Download findDownload(String skillId, int version) {
        return jdbc.query("""
                SELECT a.file_name, a.content_type, b.size_bytes, b.sha256, b.content
                FROM skill_versions v
                JOIN catalog_version_artifacts a ON a.skill_version_id = v.id
                JOIN catalog_file_blobs b ON b.id = a.blob_id
                WHERE v.skill_id = :skillId::uuid AND v.version = :version
                """, new MapSqlParameterSource().addValue("skillId", skillId).addValue("version", version), rs -> {
            if (!rs.next()) return null;
            return new Download(new Summary(rs.getString(1), rs.getString(2), rs.getLong(3), rs.getString(4)), rs.getBytes(5));
        });
    }

    private void link(String versionId, String blobId, String name, String type, String actorId) {
        jdbc.update("""
                INSERT INTO catalog_version_artifacts (skill_version_id, blob_id, file_name, content_type, created_by)
                VALUES (:version::uuid, :blob::uuid, :name, :type, :actor::uuid)
                """, new MapSqlParameterSource().addValue("version", versionId).addValue("blob", blobId)
                .addValue("name", name).addValue("type", type).addValue("actor", actorId));
    }

    private static String safeName(String original) {
        String name = original == null ? "" : original.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).trim();
        if (name.isEmpty() || name.length() > 255 || name.chars().anyMatch(c -> c < 32)) {
            throw new DomainException("El nombre del archivo no es valido");
        }
        return name;
    }

    private static String contentType(String value) {
        return value == null || value.isBlank() ? "application/octet-stream" : value.substring(0, Math.min(value.length(), 255));
    }

    private static String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
