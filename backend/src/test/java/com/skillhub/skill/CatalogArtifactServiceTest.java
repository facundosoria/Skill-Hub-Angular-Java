package com.skillhub.skill;

import com.skillhub.web.DomainException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Limites y saneamiento de los adjuntos del catalogo sin base de datos:
 * tamano, lectura del archivo, nombre y tipo de contenido.
 */
class CatalogArtifactServiceTest {

    private NamedParameterJdbcTemplate jdbc;
    private CatalogArtifactService artifacts;

    @BeforeEach
    void setUp() {
        jdbc = mock(NamedParameterJdbcTemplate.class);
        artifacts = new CatalogArtifactService(jdbc);
        when(jdbc.query(contains("INSERT INTO catalog_file_blobs"), any(MapSqlParameterSource.class), any(ResultSetExtractor.class)))
                .thenReturn("blob-1");
    }

    private MapSqlParameterSource linked() {
        ArgumentCaptor<MapSqlParameterSource> params = ArgumentCaptor.forClass(MapSqlParameterSource.class);
        verify(jdbc).update(contains("INSERT INTO catalog_version_artifacts"), params.capture());
        return params.getValue();
    }

    @Test
    void rejectsFilesOverTheSizeLimit() {
        byte[] big = new byte[(int) CatalogArtifactService.MAX_BYTES + 1];

        assertThatThrownBy(() -> artifacts.attachBytes("v1", "big.bin", "application/octet-stream", big, "u1"))
                .isInstanceOf(DomainException.class).hasMessage("El archivo supera el limite de 25 MB");
    }

    @Test
    void rejectsUploadsOverTheLimitOrUnreadable() throws IOException {
        MultipartFile huge = mock(MultipartFile.class);
        when(huge.getSize()).thenReturn(CatalogArtifactService.MAX_BYTES + 1);
        assertThatThrownBy(() -> artifacts.attachUploaded("v1", huge, "u1")).hasMessage("El archivo supera el limite de 25 MB");

        MultipartFile broken = mock(MultipartFile.class);
        when(broken.getSize()).thenReturn(10L);
        when(broken.getBytes()).thenThrow(new IOException("disco"));
        assertThatThrownBy(() -> artifacts.attachUploaded("v1", broken, "u1")).hasMessage("No se pudo leer el archivo adjunto");
    }

    @Test
    void keepsOnlyTheFileNameAndATrimmedContentType() {
        artifacts.attachBytes("v1", "C:\\carpeta\\paquete.zip", "x".repeat(300), new byte[]{1}, "u1");

        MapSqlParameterSource params = linked();
        assertThat(params.getValue("name")).isEqualTo("paquete.zip");
        assertThat((String) params.getValue("type")).hasSize(255);
        assertThat(params.getValue("blob")).isEqualTo("blob-1");
    }

    @Test
    void usesOctetStreamWithoutAContentType() {
        artifacts.attachBytes("v1", "datos.bin", " ", new byte[]{1}, "u1");

        assertThat(linked().getValue("type")).isEqualTo("application/octet-stream");
    }

    @Test
    void rejectsMissingOrOverlongNames() {
        assertThatThrownBy(() -> artifacts.attachBytes("v1", null, "text/plain", new byte[]{1}, "u1")).hasMessage("El nombre del archivo no es valido");
        assertThatThrownBy(() -> artifacts.attachBytes("v1", "dir/", "text/plain", new byte[]{1}, "u1")).hasMessage("El nombre del archivo no es valido");
        assertThatThrownBy(() -> artifacts.attachBytes("v1", "n".repeat(256), "text/plain", new byte[]{1}, "u1")).hasMessage("El nombre del archivo no es valido");
        verify(jdbc, never()).update(contains("INSERT INTO catalog_version_artifacts"), any(MapSqlParameterSource.class));
    }

    @Test
    void doesNotGenerateAManifestWhenTheVersionAlreadyHasAFile() {
        when(jdbc.query(contains("SELECT 1 FROM catalog_version_artifacts"), any(MapSqlParameterSource.class), any(ResultSetExtractor.class)))
                .thenReturn(1);

        artifacts.ensureDefaultArtifact("v1", "mi-plugin", "plugin", "contenido", "u1");

        verify(jdbc, never()).query(contains("INSERT INTO catalog_file_blobs"), any(MapSqlParameterSource.class), any(ResultSetExtractor.class));
    }

    @Test
    void generatesContractManifestsWithTheirOwnSuffix() {
        artifacts.ensureDefaultArtifact("v1", "mi-api", "contract", "contenido", "u1");

        assertThat(linked().getValue("name")).isEqualTo("mi-api-contract.json");
        verify(jdbc, never()).update(anyString(), any(java.util.Map.class));
    }
}
