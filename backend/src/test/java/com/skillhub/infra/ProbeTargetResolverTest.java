package com.skillhub.infra;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ProbeTargetResolverTest {

    private InfraProperties properties;
    private ProbeTargetResolver resolver;

    @BeforeEach
    void setUp() {
        properties = new InfraProperties();
        properties.setAllowedHosts(List.of("users-service", "*.tpi.local"));
        properties.setAllowedPorts(List.of(8080, 9090));
        resolver = new ProbeTargetResolver(properties);
    }

    @Test
    void allowsApprovedHostPortSchemeAndPath() {
        var decision = resolver.resolve("users-service", 8080, false, "/actuator/health");
        assertThat(decision.allowed()).isTrue();
        assertThat(decision.target().uri().toString())
                .isEqualTo("http://users-service:8080/actuator/health");
    }

    @Test
    void allowsWildcardHostSuffix() {
        var decision = resolver.resolve("api.tpi.local", 9090, false, "/actuator/prometheus");
        assertThat(decision.allowed()).isTrue();
    }

    @Test
    void rejectsHostNotInAllowlist() {
        var decision = resolver.resolve("evil.example.com", 8080, false, "/actuator/health");
        assertThat(decision.allowed()).isFalse();
        assertThat(decision.rejectReason()).isEqualTo("host_not_allowlisted");
    }

    @Test
    void rejectsPortNotAllowedEvenForApprovedHost() {
        var decision = resolver.resolve("users-service", 1337, false, "/actuator/health");
        assertThat(decision.allowed()).isFalse();
        assertThat(decision.rejectReason()).isEqualTo("port_not_allowed");
    }

    @Test
    void rejectsSchemeNotAllowed() {
        properties.setAllowedSchemes(List.of("https"));
        var decision = resolver.resolve("users-service", 8080, false, "/actuator/health");
        assertThat(decision.allowed()).isFalse();
        assertThat(decision.rejectReason()).isEqualTo("scheme_not_allowed");
    }

    @Test
    void rejectsPathOutsideConfiguredActuatorPaths() {
        var decision = resolver.resolve("users-service", 8080, false, "/etc/passwd");
        assertThat(decision.allowed()).isFalse();
        assertThat(decision.rejectReason()).isEqualTo("path_not_allowed");
    }

    @Test
    void marksManagementMetadataAbsentInsteadOfGuessingPort() {
        var decision = resolver.resolve("users-service", null, false, "/actuator/health");
        assertThat(decision.allowed()).isFalse();
        assertThat(decision.rejectReason()).isEqualTo("management_metadata_absent");
    }

    @Test
    void emptyHostAllowlistRejectsEverything() {
        properties.setAllowedHosts(List.of());
        var decision = resolver.resolve("users-service", 8080, false, "/actuator/health");
        assertThat(decision.allowed()).isFalse();
        assertThat(decision.rejectReason()).isEqualTo("host_not_allowlisted");
    }

    @Test
    void allowsHostInsideAllowedCidr() {
        properties.setAllowedHosts(List.of("100.64.0.0/10"));
        var decision = resolver.resolve("100.64.1.5", 8080, false, "/actuator/health");
        assertThat(decision.allowed()).isTrue();
        assertThat(decision.target().uri().getHost()).isEqualTo("100.64.1.5");
    }

    @Test
    void allowsHostMatchingAddressPrefix() {
        properties.setAllowedHosts(List.of("100.64."));
        var decision = resolver.resolve("100.64.1.5", 8080, false, "/actuator/health");
        assertThat(decision.allowed()).isTrue();
        assertThat(decision.target().uri().getHost()).isEqualTo("100.64.1.5");
    }

    @Test
    void rejectsHostOutsideAllowedCidrWithHostNotAllowlisted() {
        properties.setAllowedHosts(List.of("100.64.0.0/10"));
        var decision = resolver.resolve("10.0.0.1", 8080, false, "/actuator/health");
        assertThat(decision.allowed()).isFalse();
        assertThat(decision.rejectReason()).isEqualTo("host_not_allowlisted");
    }
}
